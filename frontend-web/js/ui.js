import { api, token, currentUser, clearSession } from './api.js';
import { UPLOADS_BASE_URL } from './config.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Inyectar favicon dinámicamente en todas las vistas
function ensureFavicon() {
  if (typeof document === 'undefined') return;
  let link = document.querySelector('link[rel*="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/webp';
    document.head.appendChild(link);
  }
  link.href = 'favicon.webp';
}
ensureFavicon();

export const money = (value)=> new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value)||0);
const notificationSvg = (className='cc-header-icon-svg', attrs='') => `<svg class="${className}" data-icon-name="cc-notification-bell.svg" ${attrs} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 16.8l-1-1.9c-.5-.9-.7-1.9-.7-2.9v-1.2c0-2.7-1.8-4.8-4.3-4.8s-4.3 2.1-4.3 4.8V12c0 1-.2 2-.7 2.9l-1 1.9c-.3.6.1 1.2.8 1.2h10.4c.7 0 1.1-.6.8-1.2z"></path><path d="M10 20c.4.7 1.1 1 2 1s1.6-.3 2-1"></path><path d="M12 6V3.5"></path></svg>`;
const chatAlertSvg = (className='cc-header-icon-svg', attrs='') => `<svg class="${className}" data-icon-name="cc-chat-messages-alert.svg" ${attrs} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="24" height="24" fill="none"></rect><path d="M6.485 18.519a9.891 9.891 0 0 1-4.876.981c-.285 0-.584-.006-.887-.018a.739.739 0 0 1-.65-.432.738.738 0 0 1 .085-.775 11.192 11.192 0 0 0 2.072-3.787A9.751 9.751 0 1 1 10.751 19.5a9.661 9.661 0 0 1-4.266-.981ZM6.808 17a8.247 8.247 0 1 0-3.139-3.015.75.75 0 0 1 .092.535A10.189 10.189 0 0 1 2.2 17.99a7.2 7.2 0 0 0 3.816-.947.745.745 0 0 1 .431-.136.756.756 0 0 1 .361.093Zm-.057-4.5a.75.75 0 0 1 0-1.5h7a.75.75 0 0 1 0 1.5Zm0-4a.75.75 0 0 1 0-1.5h5a.75.75 0 1 1 0 1.5Z" transform="translate(1.249 2.25)" fill="currentColor"></path><circle cx="18.5" cy="5.5" r="3.25" fill="#ff6359"></circle></svg>`;
function iconTone(name){
  if(/favorite|wishlist|refund|return/.test(name)) return 'cc-icon-tone-red';
  if(/address|location|shipping|delivery/.test(name)) return 'cc-icon-tone-green';
  if(/rating|review|star/.test(name)) return 'cc-icon-tone-yellow';
  if(/cart|checkout|payment|credit/.test(name)) return 'cc-icon-tone-orange';
  if(/user|profile|avatar|account/.test(name)) return 'cc-icon-tone-blue';
  return 'cc-icon-tone-neutral';
}
export function uiIcon(name,{className='cc-icon', attrs=''}={}){ const tone=iconTone(name); if(name==='cc-chat-messages-alert.svg') return chatAlertSvg(`cc-ui-icon cc-ui-icon-svg ${tone} ${className}`, attrs); if(name==='cc-notification-bell.svg') return notificationSvg(`cc-ui-icon cc-ui-icon-svg ${tone} ${className}`, attrs); return `<span class="cc-ui-icon cc-ui-icon-mask ${tone} ${className}" style="--cc-icon-url:url('/assets/icons/${name}')" data-icon-name="${name}" ${attrs} aria-hidden="true"></span>`; }
export function setUiIcon(target, iconName, options={}){
  const { className='cc-icon', selector='.cc-ui-icon,.cc-header-icon,.cc-header-icon-svg,img[src*="assets/icons/"]', attrs='' }=options;
  const current=target?.matches?.(selector) ? target : target?.querySelector?.(selector);
  if(!current) return null;
  if(current.getAttribute('data-icon-name')===iconName) return current;
  const template=document.createElement('template');
  template.innerHTML=uiIcon(iconName,{className,attrs}).trim();
  const next=template.content.firstElementChild;
  if(!next) return current;
  next.setAttribute('data-icon-name',iconName);
  current.replaceWith(next);
  return next;
}
export const icon = (name, label='') => uiIcon(name);
function accountHref(user){ if(!user) return 'login.html'; if(user.rol==='administrador') return 'admin.html'; if(user.rol==='vendedor') return 'vendedor.html'; return 'comprador.html'; }
function headerIcon(icon, attrs=''){
  if(icon==='cc-chat-messages-alert.svg') return chatAlertSvg('cc-header-icon-svg', attrs);
  return `<span class="cc-header-icon" style="--cc-icon-url:url('/assets/icons/${icon}')" data-icon-name="${icon}" ${attrs} aria-hidden="true"></span>`;
}
function iconButton({ href, icon, label, active=false, extra='', iconAttrs='' }){
  const cls = `cc-icon-btn${active ? ' active' : ''}`;
  if (href) return `<a class="${cls}" href="${href}" title="${label}" aria-label="${label}" ${extra}>${headerIcon(icon, iconAttrs)}</a>`;
  return `<button class="${cls}" type="button" title="${label}" aria-label="${label}" ${extra}>${headerIcon(icon, iconAttrs)}</button>`;
}
export function applyTheme(){
  const mode=localStorage.getItem('cc_theme') || 'day';
  document.body.classList.toggle('cc-night', mode==='night');
  document.querySelectorAll('[data-theme-toggle] .cc-header-icon').forEach(icon=>{
    icon.style.setProperty('--cc-icon-url', `url('/assets/icons/${mode==='night' ? 'cc-light-mode.svg' : 'cc-dark-mode.svg'}')`);
  });
}
export function toggleTheme(){ const next=document.body.classList.contains('cc-night')?'day':'night'; localStorage.setItem('cc_theme',next); applyTheme(); }
export function header(active='home'){
  const user=currentUser(); const account=accountHref(user);
  const sessionActions = user
    ? `${iconButton({href:account, icon:'cc-user-profile.svg', label:'Mi cuenta'})}${iconButton({icon:'cc-logout.svg', label:'Cerrar sesión', extra:'data-logout'})}`
    : iconButton({href:'login.html', icon:'cc-login.svg', label:'Ingresar'});
  return `
<header class="cc-header" role="banner">
  <div class="cc-container cc-header-row">

    <!-- ── Logo + Marca ── -->
    <a class="cc-brand" href="index.html" aria-label="CommerCity — Ir al inicio">
      <img class="cc-logo" src="assets/img/Logo - Commercity.webp" alt="Logo CommerCity" width="54" height="54">
      <span>
        <span class="cc-brand-word">
          <span class="cc-brand-commer">Commer</span><span class="cc-brand-city">City</span>
        </span>
        <span class="cc-slogan">Conectando compras, creando oportunidades</span>
      </span>
    </a>

    <!-- ── Barra de búsqueda ── -->
    <form class="cc-search" action="productos.html" role="search" aria-label="Búsqueda de productos">
      <span class="cc-ui-icon cc-ui-icon-mask cc-icon-tone-neutral cc-icon cc-search-icon"
            style="--cc-icon-url:url('/assets/icons/cc-search.svg')"
            data-icon-name="cc-search.svg" aria-hidden="true"></span>
      <input
        name="q"
        type="search"
        autocomplete="off"
        aria-label="Buscar productos, tiendas o categorías"
        placeholder="Buscar productos, tiendas o categorías…"
      >
    </form>

    <!-- ── Navegación principal ── -->
    <nav class="cc-nav" aria-label="Navegación principal">
      ${iconButton({href:'productos.html', icon:'cc-menu-categories.svg', label:'Catálogo', active:active==='productos'||active==='categorias'})}

      <!-- Carrito con badge -->
      <span class="cc-icon-btn-wrap" aria-label="Carrito">
        ${iconButton({href:'carrito.html', icon:'cc-shopping-cart.svg', label:'Carrito', active:active==='carrito', iconAttrs:'data-header-cart-icon'})}
        <span class="cc-nav-badge" data-header-cart-badge aria-hidden="true"></span>
      </span>

      <!-- Chat -->
      ${iconButton({href:'chat.html', icon:'cc-chat-messages.svg', label:'Mensajes', iconAttrs:'data-header-chat-icon'})}

      <!-- Soporte -->
      ${iconButton({href:'soporte.html', icon:'cc-support-incident-resolution.svg', label:'Soporte'})}

      <!-- Notificaciones con badge -->
      <span class="cc-icon-btn-wrap" aria-label="Notificaciones">
        ${iconButton({href:'notificaciones.html', icon:'cc-notifications.svg', label:'Notificaciones', iconAttrs:'data-header-notification-icon'})}
        <span class="cc-nav-badge" data-header-notification-badge aria-hidden="true"></span>
      </span>

      <!-- Modo claro/oscuro -->
      ${iconButton({icon:'cc-dark-mode.svg', label:'Cambiar modo visual', extra:'data-theme-toggle'})}

      <!-- Sesión -->
      ${sessionActions}
    </nav>

  </div>
</header>`;}


export function initHomeCarousel(){
  const carousel=document.querySelector('[data-carousel]');
  if(!carousel) return;
  const slides=Array.from(carousel.querySelectorAll('[data-carousel-slide]'));
  const dots=Array.from(carousel.querySelectorAll('[data-carousel-dot]'));
  const prev=carousel.querySelector('[data-carousel-prev]');
  const next=carousel.querySelector('[data-carousel-next]');
  let current=0;
  let timer=null;
  const show=(index)=>{
    current=(index+slides.length)%slides.length;
    slides.forEach((slide,i)=>{
      slide.classList.toggle('active',i===current);
      slide.setAttribute('aria-hidden',i===current?'false':'true');
    });
    dots.forEach((dot,i)=>{
      dot.classList.toggle('active',i===current);
      dot.setAttribute('aria-selected',i===current?'true':'false');
    });
  };
  const restart=()=>{
    if(timer) window.clearInterval(timer);
    timer=window.setInterval(()=>show(current+1),5000);
  };
  prev?.addEventListener('click',()=>{show(current-1);restart();});
  next?.addEventListener('click',()=>{show(current+1);restart();});
  dots.forEach((dot,i)=>dot.addEventListener('click',()=>{show(i);restart();}));
  carousel.addEventListener('keydown',(event)=>{
    if(event.key==='ArrowLeft'){show(current-1);restart();}
    if(event.key==='ArrowRight'){show(current+1);restart();}
  });
  show(0);
  restart();
}

export function footer(){
  const year = new Date().getFullYear();
  return `
<footer class="cc-footer" role="contentinfo">
  <div class="cc-container">

    <!-- ── Cuerpo del footer: 3 columnas ── -->
    <div class="cc-footer-body">

      <!-- Columna 1: Identidad de marca -->
      <div class="cc-footer-col cc-footer-brand">
        <a href="index.html" class="cc-footer-logo-link" aria-label="CommerCity — Inicio">
          <img src="assets/img/Logo - Commercity.webp" alt="Logo CommerCity" class="cc-footer-logo" width="48" height="48">
          <span class="cc-brand-word cc-footer-brand-word">
            <span class="cc-brand-commer">Commer</span><span class="cc-brand-city">City</span>
          </span>
        </a>
        <p class="cc-footer-tagline">
          Marketplace académico y comercial donde compradores, vendedores y administradores se conectan con seguridad.
        </p>
        <div class="cc-footer-chips">
          <span class="cc-footer-chip"> Pagos sandbox</span>
          <span class="cc-footer-chip"> Tiendas verificadas</span>
        </div>
      </div>

      <!-- Columna 2: Ayuda -->
      <div class="cc-footer-col">
        <h3 class="cc-footer-heading">Ayuda</h3>
        <nav aria-label="Links de ayuda">
          <ul class="cc-footer-links">
            <li><a href="help.html">Centro de ayuda</a></li>
            <li><a href="soporte.html">Soporte técnico</a></li>
            <li><a href="terms.html">Términos de uso</a></li>
            <li><a href="privacy.html">Política de privacidad</a></li>
            <li><a href="recovery-password.html">Recuperar acceso</a></li>
          </ul>
        </nav>
      </div>

      <!-- Columna 3: Navegación -->
      <div class="cc-footer-col">
        <h3 class="cc-footer-heading">Explorar</h3>
        <nav aria-label="Links de exploración">
          <ul class="cc-footer-links">
            <li><a href="productos.html">Catálogo de productos</a></li>
            <li><a href="categorias.html">Categorías</a></li>
            <li><a href="carrito.html">Mi carrito</a></li>
            <li><a href="chat.html">Mensajes</a></li>
            <li><a href="notificaciones.html">Notificaciones</a></li>
          </ul>
        </nav>
      </div>

    </div><!-- /cc-footer-body -->

    <!-- ── Barra de copyright ── -->
    <div class="cc-footer-bar">
      <p class="cc-footer-copy">
        &copy; ${year} <strong>CommerCity</strong> &mdash; Proyecto ADSO-35. Todos los derechos reservados.
      </p>
      <p class="cc-footer-legal">
        <a href="terms.html">Términos</a>
        <span class="cc-footer-sep" aria-hidden="true">·</span>
        <a href="privacy.html">Privacidad</a>
      </p>
    </div>

  </div>
</footer>`;}

function iconNameFromSrc(src=''){ const clean=String(src).split('?')[0].split('#')[0]; return clean.substring(clean.lastIndexOf('/')+1); }
function replaceIconImage(img){
  if(img.dataset.uiIconNormalized==='true' || img.closest('.cc-brand') || img.classList.contains('cc-logo')) return;
  const src=img.getAttribute('src') || '';
  if(!src.includes('assets/icons/')) return;
  const name=iconNameFromSrc(src);
  const className=img.className || (img.classList.contains('cc-icon-lg') ? 'cc-icon-lg' : 'cc-icon');
  const wrapper=img.closest('.cc-product-media') ? ' cc-product-placeholder-icon' : '';
  const html=uiIcon(name,{className:`${className}${wrapper}`});
  const template=document.createElement('template');
  template.innerHTML=html.trim();
  const node=template.content.firstElementChild;
  if(!node) return;
  node.setAttribute('data-ui-icon-normalized','true');
  img.replaceWith(node);
}
export function normalizeInterfaceIcons(root=document){
  root.querySelectorAll?.('img[src*="assets/icons/"]').forEach(replaceIconImage);
  if(!window.__ccIconNormalizer){
    window.__ccIconNormalizer=new MutationObserver(mutations=>mutations.forEach(m=>m.addedNodes.forEach(node=>{
      if(node.nodeType!==1) return;
      if(node.matches?.('img[src*="assets/icons/"]')) replaceIconImage(node);
      node.querySelectorAll?.('img[src*="assets/icons/"]').forEach(replaceIconImage);
    })));
    window.__ccIconNormalizer.observe(document.body,{childList:true,subtree:true});
  }
}
function localCartItems(){ try { return JSON.parse(localStorage.getItem('cc_cart_local') || '[]'); } catch { return []; } }
function cartTotalFromItems(items=[]){ return items.reduce((total,item)=>total + Number(item.cantidad || item.quantity || 0),0); }
export async function currentCartTotal(){
  if(token()){
    try{
      const data=await api.get('/cart');
      return cartTotalFromItems(data?.data?.items || data?.items || []);
    }catch{}
  }
  return cartTotalFromItems(localCartItems());
}
export async function syncHeaderCartIcon(total){
  const resolved=typeof total==='number' ? total : await currentCartTotal();
  document.querySelectorAll('[data-header-cart-icon]').forEach(icon=>setUiIcon(icon, resolved>0 ? 'cc-contains-shopping-cart.svg' : 'cc-shopping-cart.svg', {className:'cc-header-icon', attrs:'data-header-cart-icon'}));
  // Actualizar badge visual
  document.querySelectorAll('[data-header-cart-badge]').forEach(badge=>{
    badge.textContent = resolved > 99 ? '99+' : (resolved > 0 ? resolved : '');
    badge.classList.toggle('cc-nav-badge--visible', resolved > 0);
  });
  return resolved;
}
export function syncHeaderChatIcon(unreadChatCount=0){
  document.querySelectorAll('[data-header-chat-icon]').forEach(icon=>setUiIcon(icon, Number(unreadChatCount)>0 ? 'cc-chat-messages-alert.svg' : 'cc-chat-messages.svg', {className:'cc-header-icon', attrs:'data-header-chat-icon'}));
  return Number(unreadChatCount)||0;
}
export async function unreadNotificationCount(){
  if(!token() || !currentUser()) return 0;
  try{
    const data=await api.get('/notifications/unread-count');
    return Number(data?.data?.unread_count || data?.unread_count || 0);
  }catch{return 0;}
}
export async function syncHeaderNotificationIcon(count){
  const resolved=typeof count==='number' ? count : await unreadNotificationCount();
  document.querySelectorAll('[data-header-notification-icon]').forEach(icon=>setUiIcon(icon, resolved>0 ? 'cc-notification-alert.svg' : 'cc-notifications.svg', {className:'cc-header-icon', attrs:'data-header-notification-icon'}));
  // Actualizar badge visual
  document.querySelectorAll('[data-header-notification-badge]').forEach(badge=>{
    badge.textContent = resolved > 99 ? '99+' : (resolved > 0 ? resolved : '');
    badge.classList.toggle('cc-nav-badge--visible', resolved > 0);
  });
  return resolved;
}
export async function syncHeaderStatusIcons(){
  syncHeaderChatIcon(0);
  const [cartTotal, notificationTotal]=await Promise.all([syncHeaderCartIcon(), syncHeaderNotificationIcon()]);
  return {cartTotal, unreadChatCount:0, unreadNotificationCount:notificationTotal};
}
export function mountShell(active){ applyTheme(); document.body.insertAdjacentHTML('afterbegin', header(active)); document.body.insertAdjacentHTML('beforeend', footer()); bindHeaderActions(); normalizeInterfaceIcons(); applyTheme(); syncHeaderStatusIcons(); }
export function bindHeaderActions(){ document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.addEventListener('click',toggleTheme)); document.querySelectorAll('[data-logout]').forEach(b=>b.addEventListener('click',()=>{clearSession(); location.href='login.html';})); }
export function productCard(p){
  const id=p.id || p.producto_id || p.product_id || 0;
  const name=p.nombre || p.name || 'Producto CommerCity';
  const category=p.categoria_nombre || p.category_name || p.categoria || p.categoria_slug || 'Marketplace';
  const store=p.tienda_nombre || p.store_name || p.vendedor_nombre || 'Tienda CommerCity';
  const price=Number(p.precio_final || p.precio || p.price || 0) || 0;
  const rating=Number(p.calificacion_promedio || p.rating || 0) || 0;
  const firstImage=Array.isArray(p.imagenes) ? p.imagenes[0] : null;
  const rawImage=p.imagen_url || p.image_url || firstImage?.url || firstImage?.ruta || 'assets/icons/cc-product-card.svg';
  const imageStr=String(rawImage).startsWith('/uploads') ? `${UPLOADS_BASE_URL}${String(rawImage).replace('/uploads','')}` : String(rawImage).startsWith('/') ? `${UPLOADS_BASE_URL}/${String(rawImage).replace(/^\/+/, '')}` : String(rawImage);

  const safeId = escapeHtml(id);
  const safeName = escapeHtml(name);
  const safeCategory = escapeHtml(category);
  const safeStore = escapeHtml(store);
  const safeImage = (/^(javascript|vbscript|data):/i.test(imageStr.trim())) ? 'assets/icons/cc-product-card.svg' : escapeHtml(imageStr.trim());
  const isIcon = safeImage.includes('assets/icons/');
  const ratingHtml = rating > 0 ? `<span class="cc-stars" aria-label="Calificación ${escapeHtml(rating)} de 5" style="font-size:0.8125rem;letter-spacing:1px">${'★'.repeat(Math.round(rating))}${'☆'.repeat(5-Math.round(rating))}</span>` : '';

  return `<article class="cc-product cc-product-card-strict flex flex-col justify-between h-full" tabindex="0">
    <div class="cc-product-media cc-product-media-square relative overflow-hidden bg-slate-100 dark:bg-slate-800">
      <img ${isIcon?`src="${safeImage}"`:`src="${safeImage}" data-src="${safeImage}"`} alt="${safeName}" class="w-full h-full object-cover" loading="lazy" decoding="async">
      <div class="cc-product-quick-overlay" aria-hidden="true">
        <a class="cc-btn cc-product-view min-h-[44px] px-3 text-xs font-bold" href="producto-detalle.html?id=${safeId}" tabindex="-1">Ver detalle</a>
      </div>
    </div>
    <div class="cc-product-body p-4 flex flex-col flex-1 gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="cc-chip text-xs px-2 py-0.5">${safeCategory}</span>
        ${ratingHtml}
      </div>
      <h3 class="cc-h3 text-base font-bold text-slate-900 dark:text-white line-clamp-2 mt-1 leading-snug">${safeName}</h3>
      <p class="cc-muted text-xs">${safeStore}</p>
      <p class="cc-price text-xl font-bold text-[#fa8000] mt-1">${escapeHtml(money(price))}</p>
      <div class="cc-product-actions mt-auto pt-2 flex items-center gap-2">
        <a class="cc-btn cc-product-view min-h-[44px] px-3 flex-1 flex items-center justify-center text-sm font-bold" href="producto-detalle.html?id=${safeId}">Ver</a>
        <button class="cc-btn cc-product-add min-h-[44px] px-3 flex-1 flex items-center justify-center text-sm font-bold gap-1" data-cart="${safeId}" aria-label="Añadir ${safeName} al carrito">
          <span class="cc-btn-icon"><span class="cc-ui-icon cc-ui-icon-mask cc-icon-tone-orange cc-icon" style="--cc-icon-url:url('/assets/icons/cc-add-shopping-cart.svg')" data-icon-name="cc-add-shopping-cart.svg" data-product-cart-icon aria-hidden="true"></span></span>Añadir
        </button>
        <button class="cc-product-favorite min-h-[44px] min-w-[44px] flex items-center justify-center" data-favorite="${safeId}" type="button" aria-label="Agregar ${safeName} a favoritos" title="Agregar a favoritos" aria-pressed="false">
          <span class="cc-ui-icon cc-ui-icon-mask cc-icon-tone-red cc-icon" style="--cc-icon-url:url('/assets/icons/cc-favorites-wishlist.svg')" data-icon-name="cc-favorites-wishlist.svg" data-product-favorite-icon aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </article>`;
}

/** Genera skeletons de product card para mostrar durante la carga */
export function productSkeleton(count=4){
  return Array.from({length:count},()=>
    `<div class="cc-product cc-product-skeleton" aria-hidden="true" aria-busy="true">
      <div class="cc-product-media cc-skeleton"></div>
      <div class="cc-product-body">
        <div class="cc-skeleton cc-skeleton-title"></div>
        <div class="cc-skeleton cc-skeleton-price"></div>
        <div class="cc-skeleton cc-skeleton-sub"></div>
        <div class="cc-skeleton cc-skeleton-btn"></div>
      </div>
    </div>`
  ).join('');
}
export function showMessage(target, message, ok=false){
  const el=document.querySelector(target);
  if(!el) return;
  el.innerHTML = '';
  const alert = document.createElement('div');
  alert.className = `cc-alert ${ok?'ok':'bad'}`;
  alert.textContent = String(message ?? '');
  el.appendChild(alert);
}
export function showToast(messageOrOpts, ok=false){
  // Soporte para llamada legacy showToast('texto') y nueva showToast({title,message,type,duration})
  const opts = typeof messageOrOpts === 'string'
    ? { message: messageOrOpts, type: ok ? 'ok' : 'info', duration: 3500 }
    : messageOrOpts;
  const { title='', message='', type='info', duration=4000 } = opts;

  let region = document.querySelector('.cc-toast-region');
  if(!region){
    region = document.createElement('div');
    region.className = 'cc-toast-region';
    region.setAttribute('aria-label', 'Notificaciones del sistema');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }

  const icons = { ok:'✅', danger:'❌', bad:'❌', warn:'⚠️', info:'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `cc-toast ${type}`;
  toast.setAttribute('role', 'alert');
  const iconSpan = document.createElement('span');
  iconSpan.className = 'cc-toast-icon';
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.textContent = icons[type] || 'ℹ️';
  toast.appendChild(iconSpan);

  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'cc-toast-body';
  if (title) {
    const titleP = document.createElement('p');
    titleP.className = 'cc-toast-title';
    titleP.textContent = String(title);
    bodyDiv.appendChild(titleP);
  }
  if (message) {
    const msgP = document.createElement('p');
    msgP.className = 'cc-toast-msg';
    msgP.textContent = String(message);
    bodyDiv.appendChild(msgP);
  }
  toast.appendChild(bodyDiv);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'cc-toast-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Cerrar notificación');
  closeBtn.textContent = '×';
  toast.appendChild(closeBtn);

  const dismiss = () => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  toast.querySelector('.cc-toast-close').addEventListener('click', dismiss);
  region.appendChild(toast);
  if(duration > 0) window.setTimeout(dismiss, duration);
  return toast;
}

export function guardRole(allowed=[]){ const user=currentUser(); if(!user){ location.href='login.html'; return null; } if(allowed.length && !allowed.includes(user.rol)){ location.href='index.html'; return null; } return user; }
export function bindLogout(){ document.querySelectorAll('[data-logout]').forEach(b=>b.addEventListener('click',()=>{clearSession(); location.href='login.html';})); }
