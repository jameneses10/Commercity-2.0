import { api, token, updateStoredUser } from './api.js';
import { money, showMessage } from './ui.js';
import { exportSheetsToExcel, objectRows, tableRows } from './report-export.js';
import { userReportSection, bindUserReports } from './user-report.js';
import { UPLOADS_BASE_URL } from './config.js';
import { processImageFileToWebP } from './image-converter.js';
let pendingStoreLogoWebP = null;
let pendingStoreBannerWebP = null;
let pendingProductWebP = null;


let rawPage = location.pathname.split('/').pop() || 'vendedor.html';
if (rawPage && !rawPage.includes('.')) rawPage += '.html';
const page = rawPage;
const sellerPages = new Set(['vendedor.html','vendedor-tienda.html','vendedor-productos.html','vendedor-producto-form.html','vendedor-pedidos.html','vendedor-envios.html','vendedor-devoluciones.html','vendedor-resenas.html','vendedor-reputacion.html','vendedor-ganancias.html','vendedor-reportes.html','vendedor-configuracion.html']);
const RETURN_STATUS_LABELS = { solicitada:'Solicitada', en_revision:'En revisión', aprobada:'Aprobada', rechazada:'Rechazada', producto_recibido:'Producto recibido', reembolso_simulado:'Reembolso simulado', cerrada:'Cerrada' };
function returnStatusLabel(estado){ return RETURN_STATUS_LABELS[estado] || 'Estado no disponible'; }
const RETURN_ACTIONABLE_STATES = new Set(['solicitada','en_revision']);

function esc(value){ return String(value ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function icon(name, cls='cc-icon'){ return `<img class="${cls}" src="assets/icons/${name}" alt="">`; }
function empty(iconName, title, text, action=''){ return `<section class="cc-card cc-empty-state"><img class="cc-icon-lg" src="assets/icons/${iconName}" alt=""><h2 class="text-2xl font-bold">${esc(title)}</h2><p class="cc-muted">${esc(text)}</p>${action}</section>`; }
function loading(text='Cargando datos reales...'){ return `<section class="cc-card cc-loading-card">${esc(text)}</section>`; }
function normStatus(value){ return String(value || 'pendiente').toLowerCase().replace(/\s+/g,'-').replace('agotado','sin-stock').replace('oculto','pausado'); }
function formatPercent(value){ if(value==null || (typeof value==='string' && value.trim()==='')) return ''; const n=Number(value); if(!Number.isFinite(n)) return ''; return `${Math.round(n*100)/100}%`; }
function sellerSharePercent(commissionPercent){ if(commissionPercent==null || (typeof commissionPercent==='string' && commissionPercent.trim()==='')) return null; const n=Number(commissionPercent); if(!Number.isFinite(n)) return null; return Math.round((100-n)*100)/100; }
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
async function getSellerReturns(){ try{ return (await api.get('/seller/returns')).data.returns || []; }catch(error){ return { error }; } }
async function updateSellerReturn(id, payload){ return api.patch(`/seller/returns/${id}/status`, payload); }
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
function returnCard(r){
  const estado=r.estado || 'solicitada';
  const id=r.id;
  const respuesta=r.respuesta_vendedor;
  const respuestaBlock=(respuesta && String(respuesta).trim()) ? `<p class="cc-muted"><b>Tu respuesta:</b> ${esc(respuesta)}</p>` : '';
  const actions=RETURN_ACTIONABLE_STATES.has(estado) ? `<div class="cc-card-actions-row"><button class="cc-btn" type="button" data-return-approve="${esc(id)}">Aprobar</button><button class="cc-btn outline" type="button" data-return-reject="${esc(id)}">Rechazar</button><button class="cc-btn secondary" type="button" data-return-request-info="${esc(id)}">Solicitar información adicional</button></div><form class="cc-form mt-3" data-return-info-form="${esc(id)}" hidden><label class="cc-label">Información solicitada<textarea class="cc-input" name="respuesta_vendedor" maxlength="2000" required></textarea></label><div class="cc-card-actions-row"><button class="cc-btn" type="submit">Enviar solicitud</button><button class="cc-btn outline" type="button" data-return-info-cancel>Cancelar</button></div></form>` : '';
  return `<article class="cc-card cc-order-card" data-seller-item="returns" data-status="${esc(estado)}" data-return-id="${esc(id)}"><div><span class="cc-chip orange">${esc(returnStatusLabel(estado))}</span><h2>Solicitud #${esc(r.numero_solicitud || '')}</h2><p class="cc-muted">Pedido: ${esc(r.pedido_id || 'pendiente')} · ${money(r.monto_estimado || 0)} · ${esc(r.creado_en ? new Date(r.creado_en).toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'}) : 'Fecha no disponible')}</p><p class="cc-muted">${esc(r.motivo || 'Motivo no especificado')}</p>${respuestaBlock}</div>${actions}<div id="returnMsg-${esc(id)}" class="mt-3" aria-live="polite"></div></article>`;
}
function productRatingValue(p){ const total=Number(p.total_resenas ?? p.total_reviews ?? 0); if(!Number.isFinite(total)||total<=0) return null; const avg=Number(p.calificacion_promedio ?? p.rating ?? 0); return Number.isFinite(avg)&&avg>0?{avg,total}:null; }
function productRatingCell(p){ const rating=productRatingValue(p); if(!rating) return `<td><span class="cc-muted">Sin reseñas</span></td>`; return `<td><b>${esc(rating.avg.toFixed(2))}</b> <span class="cc-stars">${'★'.repeat(Math.floor(rating.avg))}${'☆'.repeat(Math.max(0,5-Math.floor(rating.avg)))}</span><small class="text-xs text-slate-400 block">${esc(rating.total)} reseña${rating.total===1?'':'s'}</small></td>`; }
function productsRatingSummary(products){ const rated=(Array.isArray(products)?products:[]).map(productRatingValue).filter(Boolean); if(!rated.length) return {rated:0,reviews:0,average:null}; const reviews=rated.reduce((a,r)=>a+r.total,0); const average=rated.reduce((a,r)=>a+r.avg*r.total,0)/reviews; return {rated:rated.length,reviews,average}; }
function productsRatingSummarySection(products){ const s=productsRatingSummary(products); return `<section class="cc-grid cols-3 mb-5" data-products-rating-summary><article class="cc-card cc-metric-card"><b>Calificación promedio</b><strong>${s.average===null?'Sin datos':esc(s.average.toFixed(2))}</strong><span>${s.average===null?'Aún sin reseñas':'Ponderada por reseñas'}</span></article><article class="cc-card cc-metric-card"><b>Productos calificados</b><strong>${esc(s.rated)}</strong><span>Con al menos una reseña</span></article><article class="cc-card cc-metric-card"><b>Reseñas totales</b><strong>${esc(s.reviews)}</strong><span>Sobre tus productos</span></article></section>`; }
function productRow(p){
  const id=productId(p);
  const status=normStatus(p.estado || p.status || 'activo');
  return `<tr data-seller-item="products" data-status="${esc(status)}"><td class="flex items-center gap-3"><img class="w-10 h-10 object-cover rounded-lg border" src="${esc(imgUrl(p.imagen || p.image_url || p.images?.[0]))}" alt="" loading="lazy" decoding="async"><div><b class="font-bold text-slate-900 dark:text-white block">${esc(p.nombre || p.name || 'Producto')}</b><small class="text-xs text-slate-400">ID: ${esc(id)}</small></div></td><td>${esc(p.categoria || p.category || 'General')}</td><td class="font-bold text-[#fa8000]">${money(p.precio || p.price || 0)}</td><td>${esc(p.stock ?? 0)}</td><td><span class="cc-chip ${status==='activo'?'blue':'orange'}">${esc(status)}</span></td><td>${esc(p.ventas || p.sales_count || 0)}</td>${productRatingCell(p)}<td><a class="cc-btn outline px-3 py-1 text-xs min-h-[36px] inline-flex items-center justify-center" href="vendedor-producto-form.html?id=${id}">Editar</a></td></tr>`;
}

function earningRow(e){
  const status=normStatus(e.estado || e.status || 'pendiente');
  const sellerShare=sellerSharePercent(e.porcentaje_comision);
  const commissionPctText=sellerShare!==null?` <span class="text-xs text-slate-400">(${esc(formatPercent(e.porcentaje_comision))})</span>`:'';
  const sellerPctText=sellerShare!==null?` <span class="text-xs text-emerald-600 font-semibold">(${esc(formatPercent(sellerShare))})</span>`:'';
  return `<tr data-seller-item="earnings" data-status="${esc(status)}"><td>${esc(e.fecha || e.created_at || '')}</td><td>${esc(e.pedido_id || e.order_id || '')}</td><td>${money(e.venta_total || e.total || 0)}</td><td>${money(e.comision || e.commission || 0)}${commissionPctText}</td><td>${money(e.neto || e.net || e.total_neto || 0)}${sellerPctText}</td><td><span class="cc-chip ${status==='pagado'?'blue':'orange'}">${esc(status)}</span></td></tr>`;
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


async function productsPage(){ const store=await getStore(); const products=store.error?{error:store.error}:await getProducts(store); const m=main(); m.innerHTML=pageShell('Mis productos','cc-products-management.svg','Inventario','Inventario real de la tienda conectado al backend.','<a class="cc-btn" href="vendedor-producto-form.html">Nuevo producto</a>')+`${Array.isArray(products)?productsRatingSummarySection(products):''}<section class="cc-card mb-5"><div class="cc-module-filters" data-seller-filter-group="products"><button class="cc-filter-pill active" data-filter="all" type="button">Todos</button><button class="cc-filter-pill" data-filter="activo" type="button">Activos</button><button class="cc-filter-pill" data-filter="pausado" type="button">Pausados</button><button class="cc-filter-pill" data-filter="sin-stock" type="button">Sin stock</button><button class="cc-filter-pill" data-filter="reportado" type="button">Reportados</button></div><label class="cc-label mt-4">Buscar producto<input class="cc-input" data-seller-search="products" placeholder="Nombre, categoría o estado"></label></section><section class="cc-table-wrap"><table class="cc-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Ventas</th><th>Calificación</th><th>Acciones</th></tr></thead><tbody>${Array.isArray(products)&&products.length?products.map(productRow).join(''):''}</tbody></table></section>${Array.isArray(products)&&products.length?'':empty('cc-products-management.svg','Sin productos reales visibles.',products.error?.message || 'Crea productos reales desde el formulario.')}`; bindFilters(m); }


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
async function returnsPage(){ const returns=await getSellerReturns(); const list=Array.isArray(returns)?returns:[]; main().innerHTML=pageShell('Devoluciones','cc-return-request.svg','Posventa','Solicitudes de devolución reales relacionadas con productos de tu tienda.')+`<section class="cc-module-list" data-seller-returns-list>${list.length?list.map(returnCard).join(''):empty('cc-return-request.svg','Sin solicitudes de devolución.','Cuando un comprador solicite una devolución de tu tienda, aparecerá aquí.')}</section>`; const returnsList=document.querySelector('[data-seller-returns-list]'); if(returnsList) bindReturnActions(returnsList); }
async function reviewsPage(){ const response=await api.get('/seller/reviews').catch(()=>({data:{reviews:[]}})); const reviews=response.data.reviews||[]; main().innerHTML=pageShell('Reseñas recibidas','cc-rating-star-review.svg','Opiniones','Reseñas reales de productos de tu tienda.','<a class="cc-btn outline" href="vendedor-reputacion.html">Ver reputación</a>')+`<section class="cc-card mb-5"><div class="cc-module-filters" data-seller-filter-group="reviews"><button class="cc-filter-pill active" data-filter="all" type="button">Todas</button><button class="cc-filter-pill" data-filter="positiva" type="button">Positivas</button><button class="cc-filter-pill" data-filter="media" type="button">Medias</button><button class="cc-filter-pill" data-filter="baja" type="button">Bajas</button></div></section><section class="cc-grid cols-2">${reviews.length?reviews.map(r=>{const n=Number(r.estrellas||r.calificacion||0); const st=n>=4?'positiva':n>=3?'media':'baja'; return `<article class="cc-card cc-review-card" data-seller-item="reviews" data-status="${st}"><span class="cc-chip blue">${esc(st)}</span><h2>${esc(r.producto_nombre||'Producto')}</h2><p class="cc-muted">Comprador: ${esc(r.comprador_nombre||'Comprador')}</p><p class="cc-stars">${'★'.repeat(Math.max(0,n))}${'☆'.repeat(Math.max(0,5-n))}</p><p>${esc(r.comentario||'Sin comentario')}</p>${userReportSection(r.comprador_id,{titulo:'Reportar a este comprador',descripcion:'Indica un motivo especifico si este comprador incumple las politicas.'})}</article>`}).join(''):empty('cc-rating-star-review.svg','Sin reseñas reales.','Cuando compradores califiquen tus productos, aparecerán aquí.')}</section>`; bindFilters(main()); bindUserReports(main()); }
async function reputationPage(){ const store=await getStore(); const rep=store.error?{error:store.error}:await getReputation(store); const r=rep.reputation || rep.stats || rep; main().innerHTML=pageShell('Reputación de vendedor','cc-rating-star-review.svg','Confianza','Indicadores reales o calculados desde datos disponibles.','<a class="cc-btn outline" href="vendedor-resenas.html">Ver reseñas</a>')+`<section class="cc-grid cols-4"><article class="cc-card cc-metric-card"><b>Nivel actual</b><strong>${esc(r.nivel||r.level||'Inicial')}</strong><span>Backend real</span></article><article class="cc-card cc-metric-card"><b>Calificación</b><strong>${esc(r.promedio_calificacion||r.rating||0)}</strong><span>Promedio</span></article><article class="cc-card cc-metric-card"><b>Reseñas</b><strong>${esc(r.total_resenas||r.total_reviews||0)}</strong><span>Opiniones</span></article><article class="cc-card cc-metric-card"><b>Cumplimiento</b><strong>${esc(r.cumplimiento_envios||r.fulfillment||0)}%</strong><span>Envíos</span></article></section><section class="cc-card mt-5"><h2 class="text-2xl font-bold">Estado de reputación</h2><p class="cc-muted">${esc(rep.error?.message || 'Reputación consultada desde endpoint de tienda.')}</p></section>`; }
function sellerBalances(commissions){
  const list=Array.isArray(commissions)?commissions:[];
  let pendiente=0, pagado=0;
  for(const c of list){
    const neto=Number(c.valor_vendedor||0);
    if(c.estado==='pendiente') pendiente+=neto;
    else if(c.estado==='pagada') pagado+=neto;
  }
  return { pendiente, pagado };
}
function renderEarningsBankSummary(bank){
  if(bank?.error){ return `<h2>Cuenta bancaria</h2><p class="cc-muted">No fue posible consultar la cuenta bancaria simulada.</p>`; }
  const bankAccount=bank?.data?.bank_account || null;
  if(!bankAccount){ return `<h2>Cuenta bancaria</h2><p class="cc-muted">No has registrado una cuenta bancaria simulada.</p><a class="cc-btn outline mt-3" href="vendedor-configuracion.html">Configurar cuenta</a>`; }
  const tipoLabel=Object.fromEntries(bankAccountTipos())[bankAccount.tipo_cuenta] || bankAccount.tipo_cuenta;
  const notice=bankAccount.academic_notice || 'Cuenta bancaria simulada para fines académicos.';
  return `<h2>Cuenta bancaria</h2><p class="cc-muted">${esc(notice)}</p><p><b>Banco:</b> ${esc(bankAccount.banco)}</p><p><b>Tipo de cuenta:</b> ${esc(tipoLabel)}</p><p><b>Número de cuenta simulado:</b> ${esc(bankAccount.numero_cuenta_simulado)}</p><p><b>Titular:</b> ${esc(bankAccount.titular)}</p>`;
}
const SALES_REPORT_LIMIT=20;
const SALES_REPORT_PERIODS=new Set(['daily','weekly','monthly']);
const SALES_REPORT_MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const salesReportState={period:'daily',page:1,limit:SALES_REPORT_LIMIT,rowCount:0,loading:false};
function salesReportSection(){
  return `<section class="cc-card mt-5" data-sales-report><div class="cc-section-title"><div><h2 class="text-2xl font-bold">Reporte de ventas</h2><p class="cc-muted">Ventas pagadas agrupadas por período.</p></div></div><div class="cc-module-filters" data-sales-report-periods><button class="cc-filter-pill active" data-sales-report-period="daily" type="button">Diario</button><button class="cc-filter-pill" data-sales-report-period="weekly" type="button">Semanal</button><button class="cc-filter-pill" data-sales-report-period="monthly" type="button">Mensual</button></div><p class="cc-muted mt-3" data-sales-report-status aria-live="polite">Cargando reporte diario...</p><section class="cc-table-wrap mt-5"><table class="cc-table"><thead><tr><th>Período</th><th>Ventas</th><th>Ventas brutas</th><th>Comisión</th><th>Neto vendedor</th></tr></thead><tbody data-sales-report-rows><tr><td colspan="5">Cargando...</td></tr></tbody></table></section><nav class="cc-card-actions-row mt-3" data-sales-report-pagination aria-label="Paginación del reporte de ventas"><button class="cc-btn outline" data-sales-report-page="previous" type="button" disabled>Anterior</button><span data-sales-report-page-label aria-live="polite">Página 1</span><button class="cc-btn outline" data-sales-report-page="next" type="button" disabled>Siguiente</button></nav></section>`;
}
function salesReportPeriodLabel(value,period){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value??''));
  if(!match) return String(value||'Período no disponible');
  const [,year,month,day]=match;
  const calendarLabel=`${day}/${month}/${year}`;
  if(period==='weekly') return `Semana del ${calendarLabel}`;
  if(period==='monthly') return `${SALES_REPORT_MONTHS[Number(month)-1]||month} ${year}`;
  return calendarLabel;
}
async function getSalesReport(period,page,limit=SALES_REPORT_LIMIT){
  const params=new URLSearchParams({period,page:String(page),limit:String(limit)});
  return (await api.get(`/seller/store/earnings?${params.toString()}`)).data;
}
function updateSalesReportControls(root){
  root.querySelectorAll('[data-sales-report-period]').forEach(button=>{
    button.classList.toggle('active',button.dataset.salesReportPeriod===salesReportState.period);
    button.disabled=salesReportState.loading;
  });
  const previous=root.querySelector('[data-sales-report-page="previous"]');
  const next=root.querySelector('[data-sales-report-page="next"]');
  if(previous) previous.disabled=salesReportState.loading||salesReportState.page===1;
  if(next) next.disabled=salesReportState.loading||salesReportState.rowCount<salesReportState.limit;
  const pageLabel=root.querySelector('[data-sales-report-page-label]');
  if(pageLabel) pageLabel.textContent=`Página ${salesReportState.page}`;
}
function renderSalesReportRows(root,rows){
  const tbody=root.querySelector('[data-sales-report-rows]');
  if(!tbody) return;
  tbody.innerHTML=rows.length?rows.map(row=>`<tr><td><b>${esc(salesReportPeriodLabel(row.period_start,salesReportState.period))}</b></td><td>${esc(row.sales_count??0)}</td><td>${money(row.gross_total||0)}</td><td>${money(row.commission_total||0)}</td><td>${money(row.seller_net_total||0)}</td></tr>`).join(''):'<tr><td colspan="5"><b>Sin ventas para esta página.</b><p class="cc-muted">No existen períodos pagados para mostrar.</p></td></tr>';
}
async function loadSalesReport(period=salesReportState.period,page=salesReportState.page){
  const root=document.querySelector('[data-sales-report]');
  if(!root||salesReportState.loading||!SALES_REPORT_PERIODS.has(period)) return;
  salesReportState.period=period;
  salesReportState.page=Math.max(1,Number.parseInt(page,10)||1);
  salesReportState.loading=true;
  const status=root.querySelector('[data-sales-report-status]');
  if(status) status.textContent='Cargando reporte de ventas...';
  updateSalesReportControls(root);
  try{
    const data=await getSalesReport(salesReportState.period,salesReportState.page,salesReportState.limit);
    const rows=Array.isArray(data?.report_rows)?data.report_rows:[];
    salesReportState.period=SALES_REPORT_PERIODS.has(data?.period)?data.period:salesReportState.period;
    salesReportState.page=Math.max(1,Number.parseInt(data?.pagination?.page,10)||salesReportState.page);
    salesReportState.rowCount=rows.length;
    renderSalesReportRows(root,rows);
    if(status) status.textContent=`${rows.length} período${rows.length===1?'':'s'} en esta página.`;
  }catch(error){
    salesReportState.rowCount=0;
    const tbody=root.querySelector('[data-sales-report-rows]');
    if(tbody) tbody.innerHTML=`<tr><td colspan="5"><b>No fue posible cargar el reporte.</b><p class="cc-muted">${esc(error.message)}</p></td></tr>`;
    if(status) status.textContent='Error al cargar el reporte de ventas.';
  }finally{
    salesReportState.loading=false;
    updateSalesReportControls(root);
  }
}
function bindSalesReport(){
  const root=document.querySelector('[data-sales-report]');
  root?.addEventListener('click',event=>{
    const periodButton=event.target.closest('[data-sales-report-period]');
    if(periodButton){ loadSalesReport(periodButton.dataset.salesReportPeriod,1); return; }
    const pageButton=event.target.closest('[data-sales-report-page]');
    if(!pageButton) return;
    const nextPage=pageButton.dataset.salesReportPage==='previous'?salesReportState.page-1:salesReportState.page+1;
    loadSalesReport(salesReportState.period,nextPage);
  });
}
const TOP_PRODUCTS_LIMIT=10;
const topProductsState={loading:false};
function topProductsSection(){
  return `<section class="cc-card mt-5" data-top-products><div class="cc-section-title"><div><h2 class="text-2xl font-bold">Productos más vendidos</h2><p class="cc-muted">Ranking por unidades vendidas en pedidos pagados.</p></div></div><p class="cc-muted mt-3" data-top-products-status aria-live="polite">Cargando productos más vendidos...</p><section class="cc-grid cols-4 mt-3" data-top-products-summary></section><section class="cc-table-wrap mt-5"><table class="cc-table"><thead><tr><th>#</th><th>Producto</th><th>Unidades vendidas</th><th>Participación</th><th>Total vendido</th><th>Stock actual</th></tr></thead><tbody data-top-products-rows><tr><td colspan="6">Cargando...</td></tr></tbody></table></section></section>`;
}
async function getTopProducts(){
  return (await api.get('/seller/store/sold-products')).data;
}
function topProductsRanking(products){
  const sold=(Array.isArray(products)?products:[]).filter(p=>Number(p?.cantidad_vendida||0)>0);
  sold.sort((a,b)=>Number(b.cantidad_vendida||0)-Number(a.cantidad_vendida||0)||String(a.nombre??'').localeCompare(String(b.nombre??'')));
  const unitsTotal=sold.reduce((acc,p)=>acc+Number(p.cantidad_vendida||0),0);
  const revenueTotal=sold.reduce((acc,p)=>acc+Number(p.total_vendido||0),0);
  return {rows:sold.slice(0,TOP_PRODUCTS_LIMIT),soldCount:sold.length,unitsTotal,revenueTotal};
}
function topProductsShare(units,unitsTotal){
  if(!unitsTotal) return '0%';
  return `${Math.round((Number(units||0)/unitsTotal)*1000)/10}%`;
}
function renderTopProductsSummary(root,ranking){
  const summary=root.querySelector('[data-top-products-summary]');
  if(!summary) return;
  const leader=ranking.rows[0];
  summary.innerHTML=`<article class="cc-card cc-metric-card"><b>Productos con ventas</b><strong>${esc(ranking.soldCount)}</strong><span>Con pedidos pagados</span></article><article class="cc-card cc-metric-card"><b>Unidades vendidas</b><strong>${esc(ranking.unitsTotal)}</strong><span>Total acumulado</span></article><article class="cc-card cc-metric-card"><b>Total vendido</b><strong>${money(ranking.revenueTotal)}</strong><span>Ingresos brutos</span></article><article class="cc-card cc-metric-card"><b>Producto líder</b><strong>${esc(leader?.nombre||'Sin datos')}</strong><span>${leader?`${esc(leader.cantidad_vendida||0)} unidades · ${esc(topProductsShare(leader.cantidad_vendida,ranking.unitsTotal))}`:'Aún sin ventas'}</span></article>`;
}
function renderTopProductsRows(root,ranking){
  const tbody=root.querySelector('[data-top-products-rows]');
  if(!tbody) return;
  tbody.innerHTML=ranking.rows.length?ranking.rows.map((p,index)=>`<tr><td><b>${index+1}</b></td><td><b>${esc(p.nombre||'Producto')}</b><small class="text-xs text-slate-400 block">ID: ${esc(p.id??'')}</small></td><td>${esc(p.cantidad_vendida||0)}</td><td>${esc(topProductsShare(p.cantidad_vendida,ranking.unitsTotal))}</td><td>${money(p.total_vendido||0)}</td><td>${esc(p.stock??0)}</td></tr>`).join(''):'<tr><td colspan="6"><b>Sin productos vendidos.</b><p class="cc-muted">Cuando existan pedidos pagados, aquí verás el ranking de productos más vendidos.</p></td></tr>';
}
async function loadTopProducts(){
  const root=document.querySelector('[data-top-products]');
  if(!root||topProductsState.loading) return;
  topProductsState.loading=true;
  const status=root.querySelector('[data-top-products-status]');
  if(status) status.textContent='Cargando productos más vendidos...';
  try{
    const data=await getTopProducts();
    const ranking=topProductsRanking(data?.products);
    renderTopProductsSummary(root,ranking);
    renderTopProductsRows(root,ranking);
    if(status) status.textContent=ranking.rows.length?`Top ${ranking.rows.length} de ${ranking.soldCount} producto${ranking.soldCount===1?'':'s'} con ventas.`:'Todavía no hay productos vendidos.';
  }catch(error){
    const summary=root.querySelector('[data-top-products-summary]');
    if(summary) summary.innerHTML='';
    const tbody=root.querySelector('[data-top-products-rows]');
    if(tbody) tbody.innerHTML=`<tr><td colspan="6"><b>No fue posible cargar el ranking.</b><p class="cc-muted">${esc(error.message)}</p></td></tr>`;
    if(status) status.textContent='Error al cargar los productos más vendidos.';
  }finally{
    topProductsState.loading=false;
  }
}
const stockAlertsState={loading:false};
function stockAlertsSection(){
  return `<section class="cc-card mt-5" data-stock-alerts><div class="cc-section-title"><div><h2 class="text-2xl font-bold">Stock bajo y agotado</h2><p class="cc-muted">Consulta de productos que requieren reposición.</p></div></div><p class="cc-muted mt-3" data-stock-alerts-status aria-live="polite">Cargando consulta de stock...</p><section class="cc-grid cols-2 mt-3" data-stock-alerts-summary></section><h3 class="text-xl font-bold mt-5">Productos agotados</h3><section class="cc-table-wrap mt-3"><table class="cc-table"><thead><tr><th>Producto</th><th>Stock</th><th>Estado</th><th>Precio</th></tr></thead><tbody data-stock-alerts-out><tr><td colspan="4">Cargando...</td></tr></tbody></table></section><h3 class="text-xl font-bold mt-5" data-stock-alerts-low-title>Productos con stock bajo</h3><section class="cc-table-wrap mt-3"><table class="cc-table"><thead><tr><th>Producto</th><th>Stock</th><th>Estado</th><th>Precio</th></tr></thead><tbody data-stock-alerts-low><tr><td colspan="4">Cargando...</td></tr></tbody></table></section></section>`;
}
async function getStockAlerts(){
  return (await api.get('/seller/store/out-of-stock-products')).data;
}
function stockAlertRow(product){
  return `<tr><td><b>${esc(product.nombre||'Producto')}</b><small class="text-xs text-slate-400 block">ID: ${esc(product.id??'')}</small></td><td>${esc(product.stock??0)}</td><td><span class="cc-chip ${Number(product.stock||0)===0?'dark':'orange'}">${esc(product.estado||'no disponible')}</span></td><td>${money(product.precio||0)}</td></tr>`;
}
function renderStockAlertsTable(root,selector,products,emptyText){
  const tbody=root.querySelector(selector);
  if(!tbody) return;
  tbody.innerHTML=products.length?products.map(stockAlertRow).join(''):`<tr><td colspan="4"><b>${esc(emptyText)}</b></td></tr>`;
}
async function loadStockAlerts(){
  const root=document.querySelector('[data-stock-alerts]');
  if(!root||stockAlertsState.loading) return;
  stockAlertsState.loading=true;
  const status=root.querySelector('[data-stock-alerts-status]');
  if(status) status.textContent='Cargando consulta de stock...';
  try{
    const data=await getStockAlerts();
    const outOfStock=Array.isArray(data?.products)?data.products:[];
    const lowStock=Array.isArray(data?.low_stock_products)?data.low_stock_products:[];
    const threshold=Number.isFinite(Number(data?.low_stock_threshold))?Number(data.low_stock_threshold):null;
    const lowTitle=root.querySelector('[data-stock-alerts-low-title]');
    if(lowTitle) lowTitle.textContent=threshold!==null?`Productos con stock bajo (1 a ${threshold} unidades)`:'Productos con stock bajo';
    const summary=root.querySelector('[data-stock-alerts-summary]');
    if(summary) summary.innerHTML=`<article class="cc-card cc-metric-card"><b>Agotados</b><strong>${esc(outOfStock.length)}</strong><span>Sin stock disponible</span></article><article class="cc-card cc-metric-card"><b>Stock bajo</b><strong>${esc(lowStock.length)}</strong><span>${threshold!==null?`Hasta ${esc(threshold)} unidades`:'Requieren reposición'}</span></article>`;
    renderStockAlertsTable(root,'[data-stock-alerts-out]',outOfStock,'Sin productos agotados.');
    renderStockAlertsTable(root,'[data-stock-alerts-low]',lowStock,'Sin productos con stock bajo.');
    if(status) status.textContent=`${outOfStock.length} agotado${outOfStock.length===1?'':'s'} y ${lowStock.length} con stock bajo.`;
  }catch(error){
    const summary=root.querySelector('[data-stock-alerts-summary]');
    if(summary) summary.innerHTML='';
    ['[data-stock-alerts-out]','[data-stock-alerts-low]'].forEach(selector=>{
      const tbody=root.querySelector(selector);
      if(tbody) tbody.innerHTML=`<tr><td colspan="4"><b>No fue posible cargar la consulta de stock.</b><p class="cc-muted">${esc(error.message)}</p></td></tr>`;
    });
    if(status) status.textContent='Error al cargar la consulta de stock.';
  }finally{
    stockAlertsState.loading=false;
  }
}
async function earningsPage(){
  const [data,commData,bank]=await Promise.all([getEarnings(),api.get('/seller/commissions').catch(()=>({data:{commissions:[]}})),api.get('/seller/bank-account').catch(e=>({error:e}))]);
  const commissions=commData.data.commissions||[];
  const earnings=commissions.length?commissions.map(c=>({fecha:c.created_at,pedido_id:c.pedido_id,venta_total:c.valor_venta,comision:c.valor_comision,neto:c.valor_vendedor,estado:c.estado,porcentaje_comision:c.porcentaje_comision})):data.earnings||[];
  const total=earnings.reduce((a,e)=>a+Number(e.neto||e.total||0),0);
  const balances=sellerBalances(commissions);
  main().innerHTML=pageShell('Ganancias y comisiones','cc-commission.svg','Finanzas','Resumen financiero real cuando exista historial.','<a class="cc-btn outline" href="vendedor.html">Panel vendedor</a>')+`<section class="cc-grid cols-4"><article class="cc-card cc-metric-card"><b>Registros</b><strong>${earnings.length}</strong><span>API real</span></article><article class="cc-card cc-metric-card"><b>Neto estimado</b><strong>${money(total)}</strong><span>Según registros</span></article><article class="cc-card cc-metric-card"><b>Comisiones</b><strong>${money(earnings.reduce((a,e)=>a+Number(e.comision||0),0))}</strong><span>CommerCity</span></article><article class="cc-card cc-metric-card"><b>Estado</b><strong>${data.error?'Pendiente':'Real'}</strong><span>${esc(data.error?.message||'Conectado')}</span></article><article class="cc-card cc-metric-card"><b>Saldo pendiente</b><strong>${money(balances.pendiente)}</strong><span>Comisiones pendientes</span></article><article class="cc-card cc-metric-card"><b>Saldo pagado</b><strong>${money(balances.pagado)}</strong><span>Comisiones pagadas</span></article></section><section class="cc-card mt-5">${renderEarningsBankSummary(bank)}</section><section class="cc-card mt-5"><div class="cc-module-filters" data-seller-filter-group="earnings"><button class="cc-filter-pill active" data-filter="all" type="button">Mes actual</button><button class="cc-filter-pill" data-filter="pendiente" type="button">Pendientes</button><button class="cc-filter-pill" data-filter="pagada" type="button">Pagadas</button><button class="cc-filter-pill" data-filter="revisada" type="button">Revisadas</button></div></section><section class="cc-table-wrap mt-5"><table class="cc-table"><thead><tr><th>Fecha</th><th>Pedido</th><th>Venta</th><th>Comisión</th><th>Neta</th><th>Estado</th></tr></thead><tbody>${earnings.length?earnings.map(earningRow).join(''):''}</tbody></table></section>${earnings.length?'':empty('cc-commission.svg','Sin ganancias registradas.','Cuando haya pedidos pagados, aparecerán ganancias y comisiones reales.')}${salesReportSection()}${topProductsSection()}${stockAlertsSection()}`;
  bindFilters(main());
  bindSalesReport();
  await loadSalesReport('daily',1);
  await loadTopProducts();
  await loadStockAlerts();
}
function bankAccountTipos(){ return [['ahorros','Ahorros'],['corriente','Corriente'],['nequi','Nequi'],['daviplata','Daviplata'],['simulada','Simulada']]; }
function renderBankCard(bank){
  if(bank?.error){ return `<h2>Cuenta bancaria</h2><p class="cc-muted">${esc(bank.error.message || 'No fue posible consultar la cuenta bancaria simulada.')}</p>`; }
  const bankAccount=bank?.data?.bank_account || null;
  const notice=bankAccount?.academic_notice || 'Cuenta bancaria simulada para fines académicos. No uses datos reales.';
  const selectedTipo=bankAccount?.tipo_cuenta || 'simulada';
  const options=bankAccountTipos().map(([v,l])=>`<option value="${v}"${v===selectedTipo?' selected':''}>${l}</option>`).join('');
  return `<h2>Cuenta bancaria</h2><p class="cc-muted">${esc(notice)}</p><form id="sellerBankAccountForm" class="cc-form mt-3"><label class="cc-label">Banco<input class="cc-input" name="banco" required minlength="2" maxlength="120" value="${esc(bankAccount?.banco || '')}"></label><label class="cc-label">Tipo de cuenta<select class="cc-input" name="tipo_cuenta" required>${options}</select></label><label class="cc-label">Número de cuenta simulado<input class="cc-input" name="numero_cuenta_simulado" required minlength="4" maxlength="80" value="${esc(bankAccount?.numero_cuenta_simulado || '')}"></label><p class="cc-muted text-xs">Usa únicamente datos de prueba. No ingreses información bancaria real.</p><label class="cc-label">Titular<input class="cc-input" name="titular" required minlength="2" maxlength="160" value="${esc(bankAccount?.titular || '')}"></label><button class="cc-btn mt-3" type="submit">${bankAccount ? 'Actualizar información bancaria' : 'Registrar información bancaria'}</button><div id="bankAccountMsg" class="mt-3" aria-live="polite"></div></form>`;
}
function bindBankAccountForm(bank){
  const card=document.querySelector('#sellerBankCard');
  const form=card?.querySelector('#sellerBankAccountForm');
  if(!form) return;
  const bankAccount=bank?.data?.bank_account || null;
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const payload={
      banco:String(fd.get('banco') || '').trim(),
      tipo_cuenta:String(fd.get('tipo_cuenta') || ''),
      numero_cuenta_simulado:String(fd.get('numero_cuenta_simulado') || '').trim(),
      titular:String(fd.get('titular') || '').trim()
    };
    const controls=form.querySelectorAll('input,select,button');
    controls.forEach(c=>{c.disabled=true;});
    try{
      if(bankAccount){ await api.patch('/seller/bank-account', payload); }
      else { await api.post('/seller/bank-account', payload); }
      const fresh=await api.get('/seller/bank-account').catch(err=>({error:err}));
      if(card){ card.innerHTML=renderBankCard(fresh); bindBankAccountForm(fresh); }
      showMessage('#bankAccountMsg', bankAccount ? 'Información bancaria simulada actualizada correctamente.' : 'Información bancaria simulada registrada correctamente.', true);
    }catch(error){
      controls.forEach(c=>{c.disabled=false;});
      showMessage('#bankAccountMsg', error.message || 'No fue posible guardar la información bancaria.');
    }
  });
}
async function configPage(user){ const [store, bank]=await Promise.all([getStore(), api.get('/seller/bank-account').catch(e=>({error:e}))]); main().innerHTML=pageShell('Configuración de vendedor','cc-settings-general.svg','Configuración','Datos reales de sesión, tienda y cuenta bancaria cuando existan.','<a class="cc-btn outline" href="vendedor.html">Volver al panel</a>')+`<section class="cc-grid cols-2"><article class="cc-card"><h2>Datos de vendedor</h2><p><b>Nombre:</b> ${esc(user.nombre)}</p><p><b>Correo:</b> ${esc(user.correo)}</p><p><b>Rol:</b> ${esc(user.rol)}</p></article><article class="cc-card"><h2>Tienda</h2><p><b>Nombre:</b> ${esc(store.nombre || 'Pendiente')}</p><p><b>Estado:</b> ${esc(store.estado || store.error?.message || 'No disponible')}</p><a class="cc-btn outline mt-3" href="vendedor-tienda.html">Editar tienda</a></article><article class="cc-card" id="sellerBankCard">${renderBankCard(bank)}</article><article class="cc-card"><h2>Seguridad</h2><a class="cc-btn" href="reset-password.html">Cambiar contraseña</a></article></section>`; bindBankAccountForm(bank); }

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

async function submitReturnAction(button, id, payload){
  const card=button.closest('[data-return-id]');
  const controls=card ? card.querySelectorAll('button') : [button];
  controls.forEach(c=>{c.disabled=true;});
  try{
    await updateSellerReturn(id, payload);
    await returnsPage();
  }catch(error){
    controls.forEach(c=>{c.disabled=false;});
    showMessage(`#returnMsg-${id}`, error.message || 'No fue posible actualizar la solicitud.');
  }
}
function bindReturnActions(container){
  container.addEventListener('click', async e=>{
    const approveBtn=e.target.closest('[data-return-approve]');
    if(approveBtn){ await submitReturnAction(approveBtn, approveBtn.dataset.returnApprove, { estado:'aprobada' }); return; }
    const rejectBtn=e.target.closest('[data-return-reject]');
    if(rejectBtn){ await submitReturnAction(rejectBtn, rejectBtn.dataset.returnReject, { estado:'rechazada' }); return; }
    const infoBtn=e.target.closest('[data-return-request-info]');
    if(infoBtn){
      const form=infoBtn.closest('[data-return-id]')?.querySelector('[data-return-info-form]');
      if(form){ form.hidden=false; form.querySelector('textarea')?.focus(); }
      return;
    }
    const cancelBtn=e.target.closest('[data-return-info-cancel]');
    if(cancelBtn){
      const form=cancelBtn.closest('[data-return-info-form]');
      if(form){ form.hidden=true; const ta=form.querySelector('textarea'); if(ta) ta.value=''; }
      return;
    }
  });
  container.addEventListener('submit', async e=>{
    const form=e.target.closest('[data-return-info-form]');
    if(!form) return;
    e.preventDefault();
    const id=form.dataset.returnInfoForm;
    const textarea=form.querySelector('textarea[name="respuesta_vendedor"]');
    const text=String(textarea?.value || '').trim();
    if(!text){ showMessage(`#returnMsg-${id}`, 'Debes indicar qué información adicional necesitas.'); return; }
    const controls=form.querySelectorAll('textarea,button');
    controls.forEach(c=>{c.disabled=true;});
    try{
      await updateSellerReturn(id, { estado:'en_revision', respuesta_vendedor:text });
      await returnsPage();
    }catch(error){
      controls.forEach(c=>{c.disabled=false;});
      showMessage(`#returnMsg-${id}`, error.message || 'No fue posible enviar la solicitud de información.');
    }
  });
}

const storePerformanceState={loading:false};
function storePerformanceSection(){
  return `<section class="cc-card mt-5" data-store-performance><div class="cc-section-title"><div><h2 class="text-2xl font-bold">Desempeño de la tienda</h2><p class="cc-muted">Indicadores acumulados de ventas pagadas y catálogo.</p></div></div><p class="cc-muted mt-3" data-store-performance-status aria-live="polite">Cargando desempeño de la tienda...</p><section class="cc-grid cols-4 mt-3" data-store-performance-metrics></section></section>`;
}
function storePerformanceMetrics(stats){
  const num=value=>{ const parsed=Number(value); return Number.isFinite(parsed)?parsed:0; };
  const orders=num(stats?.total_pedidos);
  const gross=num(stats?.ventas_brutas);
  const units=num(stats?.total_productos_vendidos);
  const net=num(stats?.ganancia_vendedor_90);
  const commission=num(stats?.comision_plataforma_10);
  const average=orders>0?gross/orders:null;
  return [
    ['Pedidos pagados',esc(orders),'Pedidos con pago confirmado'],
    ['Ventas brutas',money(gross),'Total facturado'],
    ['Unidades vendidas',esc(units),'Productos despachados'],
    ['Ticket promedio',average===null?'Sin datos':money(average),average===null?'Aún sin pedidos':'Ventas brutas por pedido'],
    ['Ganancia neta',money(net),'Neto del vendedor'],
    ['Comisión plataforma',money(commission),'Retenido por CommerCity'],
    ['Catálogo activo',`${esc(num(stats?.productos_activos))} / ${esc(num(stats?.total_productos))}`,'Productos activos del total'],
    ['Productos agotados',esc(num(stats?.productos_agotados)),'Requieren reposición']
  ];
}
function renderStorePerformance(root,stats){
  const grid=root.querySelector('[data-store-performance-metrics]');
  if(!grid) return;
  grid.innerHTML=storePerformanceMetrics(stats).map(([label,value,hint])=>`<article class="cc-card cc-metric-card"><b>${esc(label)}</b><strong>${value}</strong><span>${esc(hint)}</span></article>`).join('');
}
async function loadStorePerformance(){
  const root=document.querySelector('[data-store-performance]');
  if(!root||storePerformanceState.loading) return;
  storePerformanceState.loading=true;
  const status=root.querySelector('[data-store-performance-status]');
  if(status) status.textContent='Cargando desempeño de la tienda...';
  try{
    const data=await getStats();
    if(data?.error) throw data.error;
    renderStorePerformance(root,data?.stats||{});
    if(status) status.textContent='Indicadores acumulados de la tienda.';
  }catch(error){
    const grid=root.querySelector('[data-store-performance-metrics]');
    if(grid) grid.innerHTML='';
    if(status) status.textContent=`No fue posible cargar el desempeño de la tienda. ${error?.message||''}`.trim();
  }finally{
    storePerformanceState.loading=false;
  }
}
async function exportSellerReports(){
  const root=document.querySelector('[data-seller-report-export]');
  const status=root?.querySelector('[data-seller-report-export-status]');
  try{
    if(status) status.textContent='Generando archivo de Excel...';
    const [statsData,salesReport,sold,stock]=await Promise.all([
      getStats(),
      getSalesReport(salesReportState.period,salesReportState.page,salesReportState.limit).catch(()=>({report_rows:[]})),
      getTopProducts().catch(()=>({products:[]})),
      getStockAlerts().catch(()=>({products:[],low_stock_products:[]}))
    ]);
    const stats=statsData?.stats||{};
    exportSheetsToExcel([
      {name:'Desempeno de tienda',rows:[['Indicador','Valor'],...objectRows(stats,[['Pedidos pagados','total_pedidos'],['Ventas brutas','ventas_brutas'],['Unidades vendidas','total_productos_vendidos'],['Ganancia neta','ganancia_vendedor_90'],['Comision plataforma','comision_plataforma_10'],['Productos totales','total_productos'],['Productos activos','productos_activos'],['Productos agotados','productos_agotados']])]},
      {name:`Ventas ${salesReportState.period}`,rows:tableRows(salesReport?.report_rows,[['Periodo','period_start'],['Ventas','sales_count'],['Ventas brutas','gross_total'],['Comision','commission_total'],['Neto vendedor','seller_net_total']])},
      {name:'Productos vendidos',rows:tableRows(sold?.products,[['Producto','nombre'],['Unidades vendidas','cantidad_vendida'],['Total vendido','total_vendido'],['Stock','stock']])},
      {name:'Agotados',rows:tableRows(stock?.products,[['Producto','nombre'],['Stock','stock'],['Estado','estado'],['Precio','precio']])},
      {name:'Stock bajo',rows:tableRows(stock?.low_stock_products,[['Producto','nombre'],['Stock','stock'],['Estado','estado'],['Precio','precio']])}
    ],'reportes-vendedor');
    if(status) status.textContent='Archivo de Excel generado con los datos de la seccion Reportes.';
  }catch(error){
    if(status) status.textContent=`No fue posible exportar los reportes. ${error?.message||''}`.trim();
  }
}
function sellerReportExportSection(){
  return `<section class="cc-card mt-5" data-seller-report-export><div class="cc-section-title"><div><h2 class="text-2xl font-bold">Exportar reportes</h2><p class="cc-muted">Genera un archivo de Excel con los reportes de esta seccion.</p></div></div><div class="cc-card-actions-row mt-3"><button class="cc-btn" type="button" data-seller-report-export-run>Exportar a Excel</button></div><p class="cc-muted mt-3" data-seller-report-export-status aria-live="polite">El archivo usa los mismos datos mostrados en esta seccion.</p></section>`;
}
function bindSellerReportExport(){
  document.querySelector('[data-seller-report-export-run]')?.addEventListener('click',()=>exportSellerReports());
}
async function reportsPage(){
  main().innerHTML=pageShell('Reportes','cc-reports-analytics.svg','Reportes','Ventas por período, productos vendidos, stock y desempeño de la tienda.','<a class="cc-btn outline" href="vendedor-ganancias.html">Ganancias</a>')+storePerformanceSection()+salesReportSection()+topProductsSection()+stockAlertsSection()+sellerReportExportSection();
  bindSalesReport();
  await loadStorePerformance();
  await loadSalesReport('daily',1);
  await loadTopProducts();
  await loadStockAlerts();
  bindSellerReportExport();
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
  if(page==='vendedor-devoluciones.html') await returnsPage();
  if(page==='vendedor-resenas.html') await reviewsPage();
  if(page==='vendedor-reputacion.html') await reputationPage();
  if(page==='vendedor-ganancias.html') await earningsPage();
  if(page==='vendedor-reportes.html') await reportsPage();
  if(page==='vendedor-configuracion.html') await configPage(user);
}
init();
