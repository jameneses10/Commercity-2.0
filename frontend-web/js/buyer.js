import { api, currentUser, token, updateStoredUser } from './api.js';
import { money, showMessage, syncHeaderNotificationIcon, escapeHtml as escHtml } from './ui.js';

function path(){ return location.pathname.split('/').pop() || 'index.html'; }
function icon(name){ return `<img class="cc-icon" src="assets/icons/${name}" alt="">`; }
function safe(value,fallback=''){ return String(value ?? fallback); }
function localCart(){ try { return JSON.parse(localStorage.getItem('cc_cart_local') || '[]'); } catch { return []; } }
function localFavorites(){ try { return JSON.parse(localStorage.getItem('cc_favorites_local') || '[]'); } catch { return []; } }
function saveLocalFavorites(list){ localStorage.setItem('cc_favorites_local', JSON.stringify(list)); }

async function buyerSession(){
  if(!token()){
    const main=document.querySelector('main');
    if(main) main.insertAdjacentHTML('afterbegin','<section class="cc-card cc-soft-warning mb-5"><b>Sesión requerida.</b><p>Inicia sesión como comprador para consultar tus datos reales.</p><a class="cc-btn mt-3" href="login.html">Ir a login</a></section>');
    return null;
  }
  try{
    const data=await api.get('/auth/me');
    const user=data?.data?.user || data?.user;
    updateStoredUser(user);
    if(user?.rol==='vendedor'){ location.href='vendedor.html'; return null; }
    if(user?.rol==='administrador'){ location.href='admin.html'; return null; }
    return user;
  }catch(error){
    const main=document.querySelector('main');
    if(main) main.insertAdjacentHTML('afterbegin',`<section class="cc-card cc-soft-warning mb-5"><b>No pudimos validar la sesión.</b><p>${escHtml(safe(error?.message, 'Error desconocido'))}</p><a class="cc-btn mt-3" href="login.html">Volver a iniciar sesión</a></section>`);
    return null;
  }
}

function empty(iconName,title,text,action=''){
  return `<section class="cc-card cc-empty-state"><img class="cc-icon-lg" src="assets/icons/${iconName}" alt=""><h2 class="text-2xl font-bold">${title}</h2><p class="cc-muted">${text}</p>${action}</section>`;
}

function paymentStatus(o) { return safe(o.estado_pago || 'pendiente').toLowerCase(); }
function generalStatus(o) { return safe(o.estado_general || 'creado').toLowerCase(); }
function capitalize(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }

function orderCard(o){
  const id=o.id || o.numero || o.codigo || 'pendiente';
  const payStatus=paymentStatus(o);
  const genStatus=generalStatus(o);
  const date=o.created_at || o.fecha || o.fecha_pedido || '';
  const total=o.total || o.total_pagado || 0;
  return `<article class="cc-card cc-order-card" data-payment-status="${escHtml(payStatus)}" data-general-status="${escHtml(genStatus)}" data-filter-text="${escHtml(safe(id))} ${escHtml(genStatus)}"><div><span class="cc-chip ${genStatus==='cancelado'?'dark':genStatus==='entregado'?'blue':'orange'}">${escHtml(capitalize(genStatus))}</span><h2 class="text-2xl font-bold mt-3">Pedido #${escHtml(safe(id))}</h2><p class="cc-muted">${date ? new Date(date).toLocaleDateString('es-CO') : 'Fecha no disponible'} · Estado del pago: ${escHtml(capitalize(payStatus))}</p><p class="cc-muted">${escHtml(safe(o.resumen || o.tienda_nombre || 'Resumen disponible en detalle.'))}</p></div><div class="cc-order-meta"><b>${money(total)}</b><a class="cc-btn outline" href="pedido-detalle.html?id=${encodeURIComponent(safe(id))}">Ver detalle</a><a class="cc-btn secondary" href="chat.html">Contactar</a><a class="cc-btn" href="devoluciones.html">Devolución</a></div></article>`;
}

function bindOrderFilters(){
  const group=document.querySelector('[data-order-filters]');
  const box=document.querySelector('[data-orders-list], .cc-order-board');
  if(!group || !box) return;

  let state=box.querySelector('[data-dynamic-empty]');
  if(!state){
    state=document.createElement('div');
    state.dataset.dynamicEmpty='true';
    state.innerHTML=empty('cc-order-history.svg','No se encontraron resultados.','Cambia el filtro para ver otros pedidos.');
    state.classList.add('hidden');
    box.appendChild(state);
  }

  const apply=()=>{
    const cards=[...box.querySelectorAll('.cc-order-card')];
    if(!cards.length) return;
    const filter=group.querySelector('.active')?.dataset.orderFilter || 'all';
    let visible=0;
    cards.forEach(card=>{
      const payStatus=card.dataset.paymentStatus;
      const genStatus=card.dataset.generalStatus;
      const show=filter==='all' || (filter==='pendiente' && payStatus==='pendiente') || (filter==='pagado' && payStatus==='pagado') || (['enviado','entregado','cancelado'].includes(filter) && genStatus===filter);
      card.classList.toggle('hidden',!show); if(show) visible++;
    });
    if(!visible) state.classList.remove('hidden'); else state.classList.add('hidden');
  };
  group.querySelectorAll('[data-order-filter]').forEach(btn=>btn.addEventListener('click',()=>{ group.querySelectorAll('[data-order-filter]').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); apply(); }));
  apply();
}

async function initOrders(){
  const user=await buyerSession(); if(!user) return;
  const box=document.querySelector('[data-orders-list], .cc-order-board'); if(!box) return;
  box.innerHTML='<section class="cc-card cc-loading-card">Cargando pedidos reales...</section>';
  try{
    const data=await api.get('/orders/my-orders');
    const orders=data?.data?.orders || data?.orders || [];
    box.innerHTML=orders.length ? orders.map(orderCard).join('') : empty('cc-order-history.svg','Aún no tienes pedidos.','Cuando compres en CommerCity, tus pedidos reales aparecerán aquí.','<a class="cc-btn" href="productos.html">Explorar productos</a>');
  }catch(error){
    box.innerHTML=empty('cc-order-history.svg','No pudimos cargar pedidos.','La API respondió: '+escHtml(safe(error?.message, 'Error desconocido')),'<a class="cc-btn" href="productos.html">Seguir comprando</a>');
  }
  bindOrderFilters();
}

function addressCard(a){
  const id=a.id || a.direccion_id;
  return `<article class="cc-card cc-address-card" data-address-id="${escHtml(safe(id))}"><span class="cc-chip ${a.es_principal?'orange':'blue'}">${a.es_principal?'Principal':'Alterna'}</span><h2 class="text-2xl font-bold mt-3">${escHtml(safe(a.nombre_destinatario || a.alias || 'Dirección'))}</h2><p class="cc-muted">${escHtml(safe(a.departamento))}, ${escHtml(safe(a.ciudad))} · ${escHtml(safe(a.direccion))}</p><p><b>Teléfono:</b> ${escHtml(safe(a.telefono))}</p><p class="cc-muted">${escHtml(safe(a.barrio || a.codigo_postal || ''))} ${escHtml(safe(a.referencia || ''))}</p><div class="cc-card-actions-row"><button class="cc-btn outline" type="button" data-edit-address="${escHtml(safe(id))}">Editar</button><button class="cc-btn secondary" type="button" data-delete-address="${escHtml(safe(id))}">Eliminar</button><button class="cc-btn" type="button" data-main-address="${escHtml(safe(id))}">Marcar como principal</button></div></article>`;
}

async function loadAddresses(){
  const box=document.querySelector('[data-addresses-list]'); if(!box) return;
  box.innerHTML='<section class="cc-card cc-loading-card">Cargando direcciones reales...</section>';
  try{
    const data=await api.get('/addresses');
    const addresses=data?.data?.addresses || data?.addresses || data?.data || [];
    box.innerHTML=Array.isArray(addresses) && addresses.length ? addresses.map(addressCard).join('') : empty('cc-address-location.svg','No tienes direcciones guardadas.','Crea tu primera dirección para usarla en pedidos reales.');
  }catch(error){ box.innerHTML=empty('cc-address-location.svg','No pudimos cargar direcciones.',escHtml(safe(error?.message, 'Error desconocido'))); }
}

async function initAddresses(){
  const user=await buyerSession(); if(!user) return;
  await loadAddresses();
  const form=document.querySelector('[data-address-form]');
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    const raw=Object.fromEntries(new FormData(form));
    const body={departamento:raw.departamento, ciudad:raw.ciudad, direccion:raw.direccion, codigo_postal:raw.barrio || raw.codigo_postal || '', telefono:raw.telefono, es_principal:!!raw.es_principal};
    if(!body.departamento || !body.ciudad || !body.direccion || !body.telefono){ showMessage('#addressMsg','Completa departamento, ciudad, dirección y teléfono.'); return; }
    try{ await api.post('/addresses',body); showMessage('#addressMsg','Dirección creada con la API real.',true); form.reset(); await loadAddresses(); }
    catch(error){ showMessage('#addressMsg',error.message || 'No fue posible crear la dirección.'); }
  });
  document.addEventListener('click',async event=>{
    const del=event.target.closest('[data-delete-address]');
    const main=event.target.closest('[data-main-address]');
    if(del){ try{ await api.delete(`/addresses/${del.dataset.deleteAddress}`); showMessage('#addressMsg','Dirección eliminada.',true); await loadAddresses(); }catch(error){ showMessage('#addressMsg',error.message); } }
    if(main){ try{ await api.patch(`/addresses/${main.dataset.mainAddress}`,{es_principal:true}); showMessage('#addressMsg','Dirección marcada como principal.',true); await loadAddresses(); }catch(error){ showMessage('#addressMsg',error.message); } }
  });
}

function favoriteProduct(f){ return f.product || f.producto || f; }
function favoriteId(f){ const p=favoriteProduct(f); return f.producto_id || f.product_id || p.id || f.id; }
function favoriteCard(f, local=false){
  const p=favoriteProduct(f); const id=favoriteId(f);
  return `<article class="cc-card cc-favorite-card" data-favorite-id="${escHtml(safe(id))}"><img class="cc-icon-lg" src="assets/icons/cc-product-card.svg" alt=""><h2 class="text-2xl font-bold">${escHtml(safe(p.nombre,'Producto favorito'))}</h2><p class="cc-muted">${escHtml(safe(p.tienda_nombre,'Tienda CommerCity'))}</p><b class="cc-price">${money(p.precio_final || p.precio || 0)}</b><div class="cc-card-actions"><a class="cc-btn outline" href="producto-detalle.html?id=${encodeURIComponent(safe(id))}">Ver producto</a><button class="cc-btn" type="button" data-cart="${escHtml(safe(id))}">${icon('cc-shopping-cart.svg')}Agregar</button><button class="cc-btn secondary" type="button" data-remove-favorite="${escHtml(safe(id))}" data-local-favorite="${local?'true':'false'}">Quitar</button></div></article>`;
}
async function loadFavorites(){
  const box=document.querySelector('[data-favorites-list]'); if(!box) return;
  box.innerHTML='<section class="cc-card cc-loading-card">Cargando favoritos reales...</section>';
  try{
    const data=await api.get('/favorites');
    const favs=data?.data?.favorites || data?.favorites || [];
    box.innerHTML=favs.length ? favs.map(f=>favoriteCard(f)).join('') : empty('cc-favorites-wishlist.svg','No tienes favoritos reales.','Guarda productos desde el catálogo para verlos aquí.','<a class="cc-btn" href="productos.html">Explorar catálogo</a>');
  }catch(error){
    const local=localFavorites();
    box.innerHTML=local.length ? local.map(f=>favoriteCard(f,true)).join('') : empty('cc-favorites-wishlist.svg','Favoritos no disponibles.',`${escHtml(safe(error?.message, 'Error desconocido'))}. Se usará respaldo local cuando agregues productos.`,'<a class="cc-btn" href="productos.html">Explorar catálogo</a>');
  }
}
async function initFavorites(){
  await buyerSession();
  await loadFavorites();
  document.addEventListener('click',async event=>{
    const btn=event.target.closest('[data-remove-favorite]'); if(!btn) return;
    const id=btn.dataset.removeFavorite;
    if(btn.dataset.localFavorite==='true'){ saveLocalFavorites(localFavorites().filter(f=>String(f.id)!==String(id))); await loadFavorites(); return; }
    try{ await api.delete(`/favorites/${id}`); await loadFavorites(); }
    catch(error){ showMessage('#favoritesMsg',error.message || 'No fue posible quitar favorito.'); }
  });
}

function notificationType(n){ return safe(n.tipo || n.type || 'system').toLowerCase(); }
function notificationRead(n){ return Boolean(n.leida || n.read_at || n.leido || n.estado==='leida'); }
function notificationCard(n){
  const read=notificationRead(n); const type=notificationType(n);
  return `<article class="cc-card cc-notification-card ${read?'':'unread'}" data-kind="${escHtml(type)}" data-status="${read?'read':'unread'}" data-notification-id="${escHtml(safe(n.id))}"><span class="cc-status-dot ${read?'blue':'green'}"></span><div><b>${escHtml(safe(n.titulo,'Notificación'))}</b><p class="cc-muted">${escHtml(safe(n.mensaje,'Mensaje de CommerCity'))}</p><small>${n.created_at ? new Date(n.created_at).toLocaleString('es-CO') : 'Fecha no disponible'} · ${read?'Leída':'No leída'}</small><div class="cc-card-actions-row mt-3"><button class="cc-btn outline" data-read-notification="${escHtml(safe(n.id))}" type="button">Marcar leída</button></div></div></article>`;
}
function bindNotificationFilters(){
  const group=document.querySelector('[data-filter-group="notifications"]'); const box=document.querySelector('[data-notifications-list]'); if(!group||!box) return;
  const map={orders:['orders','pedido','pedidos'], pagos:['pagos','pago','payment'], envios:['envios','envio','shipment'], devoluciones:['devoluciones','devolucion','return'], system:['system','sistema']};
  const apply=()=>{ const filter=group.querySelector('.active')?.dataset.filter || 'all'; let visible=0; box.querySelectorAll('.cc-notification-card').forEach(card=>{ const kind=card.dataset.kind; const status=card.dataset.status; const show=filter==='all'||(filter==='unread'&&status==='unread')||(map[filter]||[filter]).includes(kind); card.classList.toggle('hidden',!show); if(show) visible++; }); document.querySelector('[data-empty-state]')?.classList.toggle('hidden',visible>0); };
  group.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{ group.querySelectorAll('[data-filter]').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); apply(); })); apply();
}
async function loadNotifications(){
  const box=document.querySelector('[data-notifications-list]'); if(!box) return;
  box.innerHTML='<section class="cc-card cc-loading-card">Cargando notificaciones reales...</section>';
  try{ const data=await api.get('/notifications'); const list=data?.data?.notifications || data?.notifications || []; box.innerHTML=list.length ? list.map(notificationCard).join('') : empty('cc-notifications.svg','No tienes notificaciones.','Los avisos reales de pedidos, pagos y sistema aparecerán aquí.'); syncHeaderNotificationIcon(list.filter(n=>!notificationRead(n)).length); }
  catch(error){ box.innerHTML=empty('cc-notifications.svg','No pudimos cargar notificaciones.',escHtml(safe(error?.message, 'Error desconocido'))); syncHeaderNotificationIcon(0); }
  bindNotificationFilters();
}
async function initNotifications(){
  await buyerSession(); await loadNotifications();
  document.addEventListener('click',async event=>{ const btn=event.target.closest('[data-read-notification]'); if(!btn) return; try{ await api.patch(`/notifications/${btn.dataset.readNotification}/read`,{}); await loadNotifications(); }catch(error){ console.warn(error.message); } });
  document.querySelector('[data-read-all]')?.addEventListener('click',async()=>{ try{ await api.patch('/notifications/read-all',{}); await loadNotifications(); }catch(error){ console.warn(error.message); } });
}

async function initDashboard(){
  const user=await buyerSession(); if(!user) return;
  document.querySelectorAll('[data-buyer-name]').forEach(el=>{ el.textContent=user.nombre || 'Comprador CommerCity'; });
  const stats={orders:0,favorites:0,addresses:0,notifications:0};
  try{ stats.orders=(await api.get('/orders/my-orders')).data.orders.length; }catch{}
  try{ stats.favorites=(await api.get('/favorites')).data.favorites.length; }catch{}
  try{ stats.addresses=(await api.get('/addresses')).data.addresses.length; }catch{}
  try{ stats.notifications=(await api.get('/notifications/unread-count')).data.unread_count || 0; }catch{}
  Object.entries(stats).forEach(([key,value])=>document.querySelectorAll(`[data-buyer-stat="${key}"]`).forEach(el=>{el.textContent=value;}));
}

const current=path();
if(current==='mis-pedidos.html') initOrders();
if(current==='direcciones.html') initAddresses();
if(current==='favoritos.html') initFavorites();
if(current==='notificaciones.html') initNotifications();
if(current==='comprador.html') initDashboard();
