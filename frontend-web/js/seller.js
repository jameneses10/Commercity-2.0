import { api, token, updateStoredUser } from './api.js';
import { money, showMessage } from './ui.js';
import { UPLOADS_BASE_URL } from './config.js';
import { processImageFileToWebP } from './image-converter.js';
let pendingStoreLogoWebP = null;
let pendingStoreBannerWebP = null;
let pendingProductWebP = null;


let rawPage = location.pathname.split('/').pop() || 'vendedor.html';
if (rawPage && !rawPage.includes('.')) rawPage += '.html';
const page = rawPage;
const sellerPages = new Set(['vendedor.html','vendedor-tienda.html','vendedor-productos.html','vendedor-producto-form.html','vendedor-pedidos.html','vendedor-envios.html','vendedor-resenas.html','vendedor-reputacion.html','vendedor-ganancias.html','vendedor-configuracion.html']);

function esc(value){ return String(value ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function icon(name, cls='cc-icon'){ return `<img class="${cls}" src="assets/icons/${name}" alt="">`; }
function empty(iconName, title, text, action=''){ return `<section class="cc-card cc-empty-state"><img class="cc-icon-lg" src="assets/icons/${iconName}" alt=""><h2 class="text-2xl font-bold">${esc(title)}</h2><p class="cc-muted">${esc(text)}</p>${action}</section>`; }
function loading(text='Cargando datos reales...'){ return `<section class="cc-card cc-loading-card">${esc(text)}</section>`; }
function normStatus(value){ return String(value || 'pendiente').toLowerCase().replace(/\s+/g,'-').replace('agotado','sin-stock').replace('oculto','pausado'); }
function imgUrl(value, fallback='assets/icons/cc-product-card.svg'){
  if(!value) return fallback;
  const s = String(value).trim();
  if(s.startsWith('//')) return fallback;
  if(s.startsWith('/uploads')) return `${UPLOADS_BASE_URL}${s.replace('/uploads','')}`;
  if(s.startsWith('/')) return `${UPLOADS_BASE_URL}/${s.replace(/^\/+/, '')}`;
  if(s.startsWith('./assets/') || s.startsWith('assets/')) return s;
  if(s.startsWith('http://') || s.startsWith('https://')) return s;
  if(s.startsWith('blob:')) return s;
  if(s.match(/^data:image\/(jpeg|png|webp);base64,/i)) return s;
  return fallback;
}
function main(){ return document.querySelector('main'); }
function productId(p){ return p.id || p.producto_id || p.product_id; }
function storeId(s){ return s?.id || s?.tienda_id || s?.store_id; }

async function sellerSession(){
  if(!token()){
    main()?.insertAdjacentHTML('afterbegin','<section class="cc-card cc-soft-warning mb-5"><b>SesiÃ³n de vendedor requerida.</b><p>Inicia sesiÃ³n para consultar datos reales de tu tienda.</p><a class="cc-btn mt-3" href="login.html">Ir a login</a></section>');
    return null;
  }
  try{
    const res=await api.get('/auth/me');
    const user=res?.data?.user || res?.user;
    updateStoredUser(user);
    if(user?.rol==='comprador'){ location.href='comprador.html'; return null; }
    if(user?.rol==='administrador'){ location.href='admin.html'; return null; }
    if(user?.rol!=='vendedor') throw new Error('La sesiÃ³n actual no corresponde a vendedor.');
    return user;
  }catch(error){
    main()?.insertAdjacentHTML('afterbegin',`<section class="cc-card cc-soft-warning mb-5"><b>No pudimos validar la sesiÃ³n.</b><p>${esc(error.message)}</p><a class="cc-btn mt-3" href="login.html">Volver a iniciar sesiÃ³n</a></section>`);
    return null;
  }
}
async function getStore(){ try{ return (await api.get('/stores/me')).data.store; }catch(error){ return { error }; } }
async function getStats(){ try{ return (await api.get('/seller/store/stats')).data; }catch(error){ return { error }; } }
async function getEarnings(){ try{ return (await api.get('/seller/store/earnings')).data; }catch(error){ return { error }; } }
async function getOrders(){ try{ return (await api.get('/seller/orders')).data.orders || []; }catch(error){ return { error }; } }
async function getShipments(){ try{ return (await api.get('/seller/shipments')).data.shipments || []; }catch(error){ return { error }; } }
async function getProducts(store){
  try{ const d=(await api.get('/seller/products')).data; return d.products || d.items || []; }
  catch(error){
    const id=storeId(store); if(!id) return { error };
    try{ const d=(await api.get(`/stores/${id}/products?limit=50`)).data; return d.products || d.items || []; }
    catch(fallbackError){ return { error:fallbackError }; }
  }
}
async function getReputation(store){
  try{ return (await api.get('/seller/reputation')).data; }
  catch(error){
    const id=storeId(store); if(!id) return { error:new Error('No hay tienda para consultar reputaciÃ³n.') };
    try{ return (await api.get(`/stores/${id}/reputation`)).data; }catch(fallbackError){ return { error:fallbackError }; }
  }
}
async function getCategories(){ try{ return (await api.get('/categories')).data.categories || []; }catch{ return []; } }

function bindFilters(root=document){
  root.querySelectorAll('[data-seller-filter-group]').forEach(group=>{
    const key=group.dataset.sellerFilterGroup;
    group.querySelectorAll('[data-filter]').forEach(btn=>{
      btn.addEventListener('click', () => {
        group.querySelectorAll('[data-filter]').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const filter=btn.dataset.filter;
        root.querySelectorAll(`[data-seller-item="${key}"]`).forEach(item=>{
          const status=item.dataset.status;
          const show=filter==='all' || status===filter || (filter==='activos' && status==='activo') || (filter==='pausados' && status==='pausado');
          item.hidden=!show;
        });
      });
    });
  });
}

document.addEventListener('change', async (e) => {
  const targetId = e.target?.id;

  // â”€â”€ Logo de Tienda â”€â”€
  if (targetId === 'storeLogoInput' || targetId === 'btnLogoInputSec') {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(2);
      showMessage('#storeMsg', `El logo excede los 5MB permitidos (Peso actual: ${mb}MB).`);
      e.target.value = '';
      return;
    }

    const logoImgs = document.querySelectorAll('[data-store-logo], #storeLogoImg');
    const tempUrl = URL.createObjectURL(file);
    logoImgs.forEach(img => {
      img.src = tempUrl;
      img.classList.remove('object-contain', 'p-1', 'p-2', 'p-3');
      img.classList.add('object-cover', 'w-full', 'h-full');
    });

    try {
      const res = await processImageFileToWebP(file, 5);
      logoImgs.forEach(img => { img.src = res.dataUrl; });
      showMessage('#storeMsg', `Logo de tienda actualizado en WebP (${res.webpName}, ${res.webpSizeMB}MB).`, true);
    } catch(err) {
      showMessage('#storeMsg', err.message);
    } finally {
      URL.revokeObjectURL(tempUrl);
      e.target.value = '';
    }
  }

  // â”€â”€ Banner de Tienda â”€â”€
  if (targetId === 'storeBannerInput' || targetId === 'btnBannerInputSec') {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(2);
      showMessage('#storeMsg', `El banner excede los 5MB permitidos (Peso actual: ${mb}MB).`);
      e.target.value = '';
      return;
    }

    const bannerImg = document.querySelector('[data-store-banner], #storeBannerImg');
    const bannerTxt = document.querySelector('[data-store-banner-text], #storeBannerTxt');
    const tempUrl = URL.createObjectURL(file);

    if (bannerImg) {
      bannerImg.src = tempUrl;
      bannerImg.classList.remove('hidden');
      bannerImg.classList.add('object-cover', 'w-full', 'h-full');
    }
    if (bannerTxt) bannerTxt.classList.add('hidden');

    try {
      const res = await processImageFileToWebP(file, 5);
      pendingStoreBannerWebP = res.file;
      if (bannerImg) bannerImg.src = res.dataUrl;
      showMessage('#storeMsg', `Banner de tienda actualizado en WebP (${res.webpName}, ${res.webpSizeMB}MB).`, true);
    } catch(err) {
      showMessage('#storeMsg', err.message);
    } finally {
      URL.revokeObjectURL(tempUrl);
      e.target.value = '';
    }
  }

  // â”€â”€ ImÃ¡genes de Producto â”€â”€
  if (targetId === 'productImagesInput') {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const previewBox = document.getElementById('productGalleryPreview');
    const uploadZoneIcon = document.getElementById('productUploadIcon') || document.querySelector('.cc-upload-zone img');
    let isFirst = true;

    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        const mb = (file.size / (1024 * 1024)).toFixed(2);
        showMessage('#productFormMsg', `Archivo "${file.name}" omitido: supera 5MB (${mb}MB).`);
        continue;
      }

      const tempUrl = URL.createObjectURL(file);

      if (isFirst && uploadZoneIcon) {
        uploadZoneIcon.src = tempUrl;
        uploadZoneIcon.classList.remove('w-12', 'h-12', 'cc-icon-lg');
        uploadZoneIcon.classList.add('w-28', 'h-28', 'object-cover', 'rounded-2xl', 'shadow-md', 'border-2', 'border-[#2276ff]');
        isFirst = false;
      }

      if (previewBox) {
        const card = document.createElement('div');
        card.className = 'relative group border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 aspect-square flex items-center justify-center shadow-sm';
        card.innerHTML = `
          <img src="${tempUrl}" class="w-full h-full object-cover" alt="Producto">
          <span class="absolute top-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow">WEBP</span>
        `;
        previewBox.appendChild(card);
      }

      try {
        const res = await processImageFileToWebP(file, 5);
        pendingProductWebP = res.file;
        showMessage('#productFormMsg', `Imagen "${file.name}" convertida a WebP con Ã©xito.`, true);
      } catch(err) {
        showMessage('#productFormMsg', err.message);
      }
    }
    e.target.value = '';
  }
});

function pageShell(title, chipIcon, chip, description, action=''){
  return `<div class="cc-section-title"><div><span class="cc-chip orange">${icon(chipIcon)} ${esc(chip)}</span><h1 class="text-4xl font-bold mt-3">${esc(title)}</h1><p class="cc-muted">${esc(description)}</p></div>${action}</div>`;
}
function orderCard(o){
  const id=o.id || o.pedido_id || o.numero || 'pedido'; const status=normStatus(o.estado || o.status || 'pendiente');
  return `<article class="cc-card cc-order-card" data-seller-item="orders" data-status="${esc(status)}" data-filter-text="${esc(JSON.stringify(o))}"><div><span class="cc-chip ${status==='cancelado'?'dark':status==='entregado'||status==='enviado'?'blue':'orange'}">${esc(status)}</span><h2>#${esc(id)} · ${esc(o.comprador_nombre || o.buyer_name || 'Comprador')}</h2><p class="cc-muted">${esc(o.created_at || o.fecha || 'Fecha no disponible')} · ${money(o.total || 0)} · ${esc(o.metodo_pago || 'Método pendiente')}</p><p class="cc-muted">${esc(o.productos_resumen || o.resumen || 'Detalle disponible desde pedido.')}</p></div><div class="cc-card-actions-row"><a class="cc-btn outline" href="pedido-detalle.html?id=${esc(id)}">Ver detalle</a><a class="cc-btn secondary" href="vendedor-envios.html">Gestionar envío</a></div></article>`;
}
function shipmentCard(s){
  const id=s.id || s.envio_id || s.codigo || 'envio'; const status=normStatus(s.estado || s.status || 'pendiente');
  const labels={pendiente:'Pendiente',preparado:'Preparado',en_camino:'En camino',entregado:'Entregado',cancelado:'Cancelado'};
  let action='<p class="cc-muted">Este envío no tiene acciones operativas disponibles.</p>';
  if(status==='pendiente') action=`<form class="cc-form mt-4" data-shipment-dispatch="${esc(id)}"><label class="cc-label">Transportadora<input class="cc-input" name="transportadora" maxlength="120" required></label><label class="cc-label">Número de guía<input class="cc-input" name="numero_guia" maxlength="120" required></label><button class="cc-btn" type="submit">Preparar envío</button></form>`;
  if(status==='preparado') action=`<div class="cc-card-actions-row"><button class="cc-btn" type="button" data-shipment-status="${esc(id)}" data-next-status="en_camino">Marcar en camino</button></div>`;
  if(status==='en_camino') action=`<div class="cc-card-actions-row"><button class="cc-btn outline" type="button" data-shipment-status="${esc(id)}" data-next-status="entregado">Marcar entregado</button></div>`;
  return `<article class="cc-card" data-seller-item="shipments" data-status="${esc(status)}" data-filter-text="${esc(JSON.stringify(s))}"><span class="cc-chip ${status==='entregado'?'blue':'orange'}">${esc(labels[status] || status)}</span><h2>${esc(s.codigo || s.guia || `Envío #${id}`)}</h2><p class="cc-muted">Pedido: ${esc(s.pedido_id || s.order_id || 'pendiente')} · Comprador: ${esc(s.comprador_nombre || 'No disponible')}</p><p class="cc-muted">${esc(s.direccion_resumen || s.direccion || 'Dirección protegida o no disponible.')}</p>${action}<div id="shipmentMsg-${esc(id)}" class="mt-3" aria-live="polite"></div></article>`;
}
function productRow(p){
  const id=productId(p);
  const status=normStatus(p.estado || p.status || 'activo');
  return `<tr data-seller-item="products" data-status="${esc(status)}"><td class="flex items-center gap-3"><img class="w-10 h-10 object-cover rounded-lg border" src="${esc(imgUrl(p.imagen || p.image_url || p.images?.[0]))}" alt=""><div><b class="font-bold text-slate-900 dark:text-white block">${esc(p.nombre || p.name || 'Producto')}</b><small class="text-xs text-slate-400">ID: ${esc(id)}</small></div></td><td>${esc(p.categoria || p.category || 'General')}</td><td class="font-bold text-[#fa8000]">${money(p.precio || p.price || 0)}</td><td>${esc(p.stock ?? 0)}</td><td><span class="cc-chip ${status==='activo'?'blue':'orange'}">${esc(status)}</span></td><td>${esc(p.ventas || p.sales_count || 0)}</td><td><a class="cc-btn outline px-3 py-1 text-xs min-h-[36px] inline-flex items-center justify-center" href="vendedor-producto-form.html?id=${id}">Editar</a></td></tr>`;
}

function earningRow(e){
  const status=normStatus(e.estado || e.status || 'pendiente');
  return `<tr data-seller-item="earnings" data-status="${esc(status)}"><td>${esc(e.fecha || e.created_at || '')}</td><td>${esc(e.pedido_id || e.order_id || '')}</td><td>${money(e.venta_total || e.total || 0)}</td><td>${money(e.comision || e.commission || 0)}</td><td>${money(e.neto || e.net || e.total_neto || 0)}</td><td><span class="cc-chip ${status==='pagado'?'blue':'orange'}">${esc(status)}</span></td></tr>`;
}

async function dashboard(user){
  const [store, statsData, earningsData, orders, shipments]=await Promise.all([getStore(),getStats(),getEarnings(),getOrders(),getShipments()]);
  const stats=statsData.stats || {}; const earnings=earningsData.earnings || [];
  const products=store.error?[]:await getProducts(store);
  main().querySelector('section.grid.gap-5')?.insertAdjacentHTML('afterbegin',`<section class="cc-card cc-api-summary"><h2 class="text-2xl font-bold">Hola, ${esc(user.nombre || 'vendedor')}</h2><p class="cc-muted">${store.error ? 'Tienda pendiente: '+esc(store.error.message) : 'Tienda real: '+esc(store.nombre)}</p></section>`);
  main().querySelectorAll('.cc-metric-card strong').forEach((el,i)=>{ const vals=[Array.isArray(products)?products.length:0,Array.isArray(orders)?orders.length:0,money((earnings[0]?.neto || earnings[0]?.total || stats.ventas_totales || 0)), stats.promedio_calificacion || stats.rating || '0']; if(vals[i]!==undefined) el.textContent=vals[i]; });
}


async function storePage(){
  const store = await getStore();
  if(!store.error){
    const form = document.querySelector('#sellerStoreForm');
    if(form){
      if(form.nombre) form.nombre.value = store.nombre || '';
      if(form.descripcion) form.descripcion.value = store.descripcion || '';
    }
    const bannerImg = document.querySelector('[data-store-banner], #storeBannerImg');
    if(bannerImg && store.banner){
      bannerImg.src = imgUrl(store.banner);
      bannerImg.classList.remove('hidden');
      bannerImg.classList.add('object-cover', 'w-full', 'h-full');
      const bannerTxt = document.querySelector('[data-store-banner-text], #storeBannerTxt');
      if (bannerTxt) bannerTxt.classList.add('hidden');
    }
    const logoImg = document.querySelector('.cc-upload-zone img');
    if(logoImg && store.logo){
      logoImg.src = imgUrl(store.logo);
      logoImg.classList.remove('w-12', 'h-12', 'cc-icon-lg');
      logoImg.classList.add('w-28', 'h-28', 'object-cover', 'rounded-2xl', 'shadow-md', 'border-2', 'border-[#2276ff]');
    }
  }

  document.querySelector('#sellerStoreForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    if(pendingStoreLogoWebP){ fd.delete('logo'); fd.append('logo', pendingStoreLogoWebP, pendingStoreLogoWebP.name); }
    if(pendingStoreBannerWebP){ fd.delete('banner'); fd.append('banner', pendingStoreBannerWebP, pendingStoreBannerWebP.name); }
    try{
      await api.patch('/stores/me',fd);
      showMessage('#storeMsg','Tienda actualizada.',true);
      pendingStoreLogoWebP = null;
      pendingStoreBannerWebP = null;
    }catch(error){
      showMessage('#storeMsg',error.message);
    }
  });
}


async function productsPage(){ const store=await getStore(); const products=store.error?{error:store.error}:await getProducts(store); const m=main(); m.innerHTML=pageShell('Mis productos','cc-products-management.svg','Inventario','Inventario real de la tienda conectado al backend.','<a class="cc-btn" href="vendedor-producto-form.html">Nuevo producto</a>')+`<section class="cc-card mb-5"><div class="cc-module-filters" data-seller-filter-group="products"><button class="cc-filter-pill active" data-filter="all" type="button">Todos</button><button class="cc-filter-pill" data-filter="activo" type="button">Activos</button><button class="cc-filter-pill" data-filter="pausado" type="button">Pausados</button><button class="cc-filter-pill" data-filter="sin-stock" type="button">Sin stock</button><button class="cc-filter-pill" data-filter="reportado" type="button">Reportados</button></div><label class="cc-label mt-4">Buscar producto<input class="cc-input" data-seller-search="products" placeholder="Nombre, categoría o estado"></label></section><section class="cc-table-wrap"><table class="cc-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Ventas</th><th>Acciones</th></tr></thead><tbody>${Array.isArray(products)&&products.length?products.map(productRow).join(''):''}</tbody></table></section>${Array.isArray(products)&&products.length?'':empty('cc-products-management.svg','Sin productos reales visibles.',products.error?.message || 'Crea productos reales desde el formulario.')}`; bindFilters(m); }


async function productFormPage(){
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if(id){
    const store = await getStore();
    if(!store.error){
      const res = await api.get('/seller/products').catch(()=>null);
      const prod = res?.data?.products?.find(p => productId(p) == id);
      if(prod){
        const form = document.querySelector('#sellerProductForm');
        if(form){
          if(form.nombre) form.nombre.value = prod.nombre || prod.name || '';
          if(form.descripcion) form.descripcion.value = prod.descripcion || prod.description || '';
          if(form.precio) form.precio.value = prod.precio || prod.price || '';
          if(form.stock) form.stock.value = prod.stock ?? '';
          if(form.categoria) form.categoria.value = prod.categoria || prod.category || '';
        }
        const img = imgUrl(prod.imagen || prod.image_url || prod.images?.[0]);
        const uploadZoneIcon = document.getElementById('productUploadIcon') || document.querySelector('.cc-upload-zone img');
        if(uploadZoneIcon && img){
          uploadZoneIcon.src = img;
          uploadZoneIcon.classList.remove('w-12', 'h-12', 'cc-icon-lg');
          uploadZoneIcon.classList.add('w-28', 'h-28', 'object-cover', 'rounded-2xl', 'shadow-md', 'border-2', 'border-[#2276ff]');
        }
      }
    }
  }

  document.querySelector('#sellerProductForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if(pendingProductWebP){
      fd.delete('imagen'); // Backend expects 'imagen' usually, let's make sure
      fd.append('imagen', pendingProductWebP, pendingProductWebP.name);
    }
    try{
      const res = id ? await api.patch(`/products/${id}`, fd) : await api.post('/products', fd);
      showMessage('#productFormMsg', res.message || 'Producto guardado.', true);
      pendingProductWebP = null;
    }catch(error){
      showMessage('#productFormMsg', error.message);
    }
  });
}


async function ordersPage(){ const orders=await getOrders(); const list=Array.isArray(orders)?orders:[]; main().innerHTML=pageShell('Pedidos recibidos','cc-order-history.svg','Operación','Pedidos reales asociados a la tienda.','<a class="cc-btn outline" href="vendedor-envios.html">Gestionar envíos</a>')+`<section class="cc-card mb-5"><div class="cc-module-filters" data-seller-filter-group="orders"><button class="cc-filter-pill active" data-filter="all" type="button">Todos</button><button class="cc-filter-pill" data-filter="pendiente" type="button">Pendientes</button><button class="cc-filter-pill" data-filter="pagado" type="button">Pagados</button><button class="cc-filter-pill" data-filter="preparacion" type="button">En preparación</button><button class="cc-filter-pill" data-filter="enviado" type="button">Enviados</button><button class="cc-filter-pill" data-filter="entregado" type="button">Entregados</button><button class="cc-filter-pill" data-filter="cancelado" type="button">Cancelados</button></div></section><section class="cc-module-list">${list.length?list.map(orderCard).join(''):empty('cc-order-history.svg','Sin pedidos recibidos.','Cuando compradores realicen pedidos a tu tienda, aparecerán aquí.')}</section>`; bindFilters(main()); }
async function shipmentsPage(){ const shipments=await getShipments(); const list=Array.isArray(shipments)?shipments:[]; main().innerHTML=pageShell('Gestión de envíos','cc-shipping-package.svg','Logística','Envíos reales del vendedor cuando existan.','<a class="cc-btn outline" href="vendedor-pedidos.html">Ver pedidos</a>')+`<section class="cc-card mb-5"><div class="cc-module-filters" data-seller-filter-group="shipments"><button class="cc-filter-pill active" data-filter="all" type="button">Todos</button><button class="cc-filter-pill" data-filter="pendiente" type="button">Pendiente</button><button class="cc-filter-pill" data-filter="preparado" type="button">Preparado</button><button class="cc-filter-pill" data-filter="en_camino" type="button">En camino</button><button class="cc-filter-pill" data-filter="entregado" type="button">Entregado</button><button class="cc-filter-pill" data-filter="cancelado" type="button">Cancelado</button></div></section><section class="cc-grid cols-2">${list.length?list.map(shipmentCard).join(''):empty('cc-shipping-package.svg','Sin envíos reales.','Los envíos se crearán cuando existan pedidos despachables.')}</section>`; bindFilters(main()); }
async function reviewsPage(){ const response=await api.get('/seller/reviews').catch(()=>({data:{reviews:[]}})); const reviews=response.data.reviews||[]; main().innerHTML=pageShell('Reseñas recibidas','cc-rating-star-review.svg','Opiniones','Reseñas reales de productos de tu tienda.','<a class="cc-btn outline" href="vendedor-reputacion.html">Ver reputación</a>')+`<section class="cc-card mb-5"><div class="cc-module-filters" data-seller-filter-group="reviews"><button class="cc-filter-pill active" data-filter="all" type="button">Todas</button><button class="cc-filter-pill" data-filter="positiva" type="button">Positivas</button><button class="cc-filter-pill" data-filter="media" type="button">Medias</button><button class="cc-filter-pill" data-filter="baja" type="button">Bajas</button></div></section><section class="cc-grid cols-2">${reviews.length?reviews.map(r=>{const n=Number(r.estrellas||r.calificacion||0); const st=n>=4?'positiva':n>=3?'media':'baja'; return `<article class="cc-card cc-review-card" data-seller-item="reviews" data-status="${st}"><span class="cc-chip blue">${esc(st)}</span><h2>${esc(r.producto_nombre||'Producto')}</h2><p class="cc-muted">Comprador: ${esc(r.comprador_nombre||'Comprador')}</p><p class="cc-stars">${'★'.repeat(Math.max(0,n))}${'☆'.repeat(Math.max(0,5-n))}</p><p>${esc(r.comentario||'Sin comentario')}</p></article>`}).join(''):empty('cc-rating-star-review.svg','Sin reseñas reales.','Cuando compradores califiquen tus productos, aparecerán aquí.')}</section>`; bindFilters(main()); }
async function reputationPage(){ const store=await getStore(); const rep=store.error?{error:store.error}:await getReputation(store); const r=rep.reputation || rep.stats || rep; main().innerHTML=pageShell('Reputación de vendedor','cc-rating-star-review.svg','Confianza','Indicadores reales o calculados desde datos disponibles.','<a class="cc-btn outline" href="vendedor-resenas.html">Ver reseñas</a>')+`<section class="cc-grid cols-4"><article class="cc-card cc-metric-card"><b>Nivel actual</b><strong>${esc(r.nivel||r.level||'Inicial')}</strong><span>Backend real</span></article><article class="cc-card cc-metric-card"><b>Calificación</b><strong>${esc(r.promedio_calificacion||r.rating||0)}</strong><span>Promedio</span></article><article class="cc-card cc-metric-card"><b>Reseñas</b><strong>${esc(r.total_resenas||r.total_reviews||0)}</strong><span>Opiniones</span></article><article class="cc-card cc-metric-card"><b>Cumplimiento</b><strong>${esc(r.cumplimiento_envios||r.fulfillment||0)}%</strong><span>Envíos</span></article></section><section class="cc-card mt-5"><h2 class="text-2xl font-bold">Estado de reputación</h2><p class="cc-muted">${esc(rep.error?.message || 'Reputación consultada desde endpoint de tienda.')}</p></section>`; }
async function earningsPage(){ const [data, commData]=await Promise.all([getEarnings(), api.get('/seller/commissions').catch(()=>({data:{commissions:[]}}))]); const commissions=commData.data.commissions||[]; const earnings=commissions.length?commissions.map(c=>({fecha:c.created_at,pedido_id:c.pedido_id,venta_total:c.valor_venta,comision:c.valor_comision,neto:c.valor_vendedor,estado:c.estado})):data.earnings||[]; const total=earnings.reduce((a,e)=>a+Number(e.neto||e.total||0),0); main().innerHTML=pageShell('Ganancias y comisiones','cc-commission.svg','Finanzas','Resumen financiero real cuando exista historial.','<a class="cc-btn outline" href="vendedor.html">Panel vendedor</a>')+`<section class="cc-grid cols-4"><article class="cc-card cc-metric-card"><b>Registros</b><strong>${earnings.length}</strong><span>API real</span></article><article class="cc-card cc-metric-card"><b>Neto estimado</b><strong>${money(total)}</strong><span>Según registros</span></article><article class="cc-card cc-metric-card"><b>Comisiones</b><strong>${money(earnings.reduce((a,e)=>a+Number(e.comision||0),0))}</strong><span>CommerCity</span></article><article class="cc-card cc-metric-card"><b>Estado</b><strong>${data.error?'Pendiente':'Real'}</strong><span>${esc(data.error?.message||'Conectado')}</span></article></section><section class="cc-card mt-5"><div class="cc-module-filters" data-seller-filter-group="earnings"><button class="cc-filter-pill active" data-filter="all" type="button">Mes actual</button><button class="cc-filter-pill" data-filter="pendiente" type="button">Pendientes</button><button class="cc-filter-pill" data-filter="pagada" type="button">Pagadas</button><button class="cc-filter-pill" data-filter="revisada" type="button">Revisadas</button></div></section><section class="cc-table-wrap mt-5"><table class="cc-table"><thead><tr><th>Fecha</th><th>Pedido</th><th>Venta</th><th>Comisión</th><th>Neta</th><th>Estado</th></tr></thead><tbody>${earnings.length?earnings.map(earningRow).join(''):''}</tbody></table></section>${earnings.length?'':empty('cc-commission.svg','Sin ganancias registradas.','Cuando haya pedidos pagados, aparecerán ganancias y comisiones reales.')}`; bindFilters(main()); }
async function configPage(user){ const [store, bank]=await Promise.all([getStore(), api.get('/seller/bank-account').catch(e=>({error:e}))]); main().innerHTML=pageShell('Configuración de vendedor','cc-settings-general.svg','Configuración','Datos reales de sesión, tienda y cuenta bancaria cuando existan.','<a class="cc-btn outline" href="vendedor.html">Volver al panel</a>')+`<section class="cc-grid cols-2"><article class="cc-card"><h2>Datos de vendedor</h2><p><b>Nombre:</b> ${esc(user.nombre)}</p><p><b>Correo:</b> ${esc(user.correo)}</p><p><b>Rol:</b> ${esc(user.rol)}</p></article><article class="cc-card"><h2>Tienda</h2><p><b>Nombre:</b> ${esc(store.nombre || 'Pendiente')}</p><p><b>Estado:</b> ${esc(store.estado || store.error?.message || 'No disponible')}</p><a class="cc-btn outline mt-3" href="vendedor-tienda.html">Editar tienda</a></article><article class="cc-card"><h2>Cuenta bancaria</h2><p class="cc-muted">${esc(bank.error?.message || 'Cuenta bancaria real consultada.')}</p></article><article class="cc-card"><h2>Seguridad</h2><a class="cc-btn" href="reset-password.html">Cambiar contraseña</a></article></section>`; }

function bindVisualActions(){
  document.addEventListener('click',async e=>{
    const v=e.target.closest('[data-product-visibility]');
    if(v){ try{ await api.patch(`/products/${v.dataset.productVisibility}/visibility`,{estado:v.dataset.nextStatus}); v.textContent='Actualizado'; }catch(error){ v.textContent='Pendiente API'; console.warn(error.message); } }
    const s=e.target.closest('[data-shipment-status]');
    if(s){
      const id=s.dataset.shipmentStatus;
      s.disabled=true;
      try{
        await api.patch(`/shipments/${id}/status`,{estado:s.dataset.nextStatus});
        await shipmentsPage();
      }catch(error){
        s.disabled=false;
        showMessage(`#shipmentMsg-${id}`,error.message || 'No fue posible actualizar el envío.');
        console.warn(error.message);
      }
    }
  });
  document.addEventListener('submit',async e=>{
    const form=e.target.closest('[data-shipment-dispatch]');
    if(!form) return;
    e.preventDefault();
    const id=form.dataset.shipmentDispatch;
    const controls=form.querySelectorAll('input,button');
    const body=Object.fromEntries(new FormData(form));
    controls.forEach(control=>{control.disabled=true;});
    try{
      await api.patch(`/shipments/${id}/dispatch`,{transportadora:String(body.transportadora || '').trim(),numero_guia:String(body.numero_guia || '').trim()});
      await shipmentsPage();
    }catch(error){
      controls.forEach(control=>{control.disabled=false;});
      showMessage(`#shipmentMsg-${id}`,error.message || 'No fue posible preparar el envío.');
      console.warn(error.message);
    }
  });
}

async function init(){
  if(!sellerPages.has(page)) return;
  const user=await sellerSession();
  bindVisualActions();
  if(page==='vendedor.html') await dashboard(user);
  if(page==='vendedor-tienda.html') await storePage();
  if(page==='vendedor-productos.html') await productsPage();
  if(page==='vendedor-producto-form.html') await productFormPage();
  if(page==='vendedor-pedidos.html') await ordersPage();
  if(page==='vendedor-envios.html') await shipmentsPage();
  if(page==='vendedor-resenas.html') await reviewsPage();
  if(page==='vendedor-reputacion.html') await reputationPage();
  if(page==='vendedor-ganancias.html') await earningsPage();
  if(page==='vendedor-configuracion.html') await configPage(user);
}
init();
