import { api, token } from './api.js';
import { showMessage, money, syncHeaderStatusIcons, escapeHtml as esc } from './ui.js';

let apiCart = null;
const pendingCartItems = new Set();
let clearingCart = false;
let validatingCart = false;
function localCart(){ try { return JSON.parse(localStorage.getItem('cc_cart_local') || '[]'); } catch { return []; } }
function saveCart(list){ localStorage.setItem('cc_cart_local', JSON.stringify(list)); }
function toCents(value){ return Math.round(Number(value) * 100); }
function localSubtotal(list){ return list.reduce((sum,item)=>sum + toCents(Number(item.precio || 0) * Number(item.cantidad || 1)),0) / 100; }

/** Genera el HTML de una línea de producto del carrito */
function cartLineHtml(item, fromApi) {
  const id = esc(item.id);
  const price = Number(item.precio || item.precio_unitario || 0);
  const qty = Number(item.cantidad || 1);
  const subtotalVal = Number(item.subtotal || price * qty);
  const sourceLabel = fromApi ? 'Sincronizado con tu cuenta' : 'Carrito local';
  return `<article class="cc-cart-line p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-4">
    <div class="cc-cart-line-info flex-1">
      <span class="cc-cart-line-name text-base font-bold text-slate-900 dark:text-white block">${esc(item.nombre)}</span>
      <span class="cc-body-sm cc-muted text-xs text-slate-500">${sourceLabel} · Stock: ${esc(item.stock ?? 'Disponible')}</span>
      <div class="cc-cart-qty mt-2 flex items-center gap-2">
        <button class="cc-qty-btn min-h-[44px] min-w-[44px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold rounded-lg flex items-center justify-center text-lg active:scale-95 transition-all" type="button" data-cart-dec="${id}" aria-label="Reducir cantidad">−</button>
        <span class="cc-qty-val font-bold text-base px-2" aria-live="polite">${qty}</span>
        <button class="cc-qty-btn min-h-[44px] min-w-[44px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold rounded-lg flex items-center justify-center text-lg active:scale-95 transition-all" type="button" data-cart-inc="${id}" aria-label="Aumentar cantidad">+</button>
      </div>
    </div>
    <strong class="cc-cart-line-price text-lg font-bold text-[#fa8000] Inter">${money(subtotalVal)}</strong>
    <button class="cc-btn outline min-h-[44px] px-3 py-2 border border-rose-300 text-rose-600 hover:bg-rose-50 rounded-xl text-sm font-semibold transition-all" type="button" data-remove-cart="${id}">Quitar</button>
  </article>`;
}

/** Genera un bloque de grupo por tienda */
function vendorGroupHtml(storeName, items, fromApi) {
  const groupSubtotal = items.reduce((s, i) => s + Number(i.subtotal || (Number(i.precio || i.precio_unitario || 0) * Number(i.cantidad || 1))), 0);
  const shippingEstimate = 12000;
  return `<section class="cc-cart-vendor-group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm mb-6">
    <header class="cc-cart-vendor-header flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-slate-800">
      <div class="flex items-center gap-2">
        <svg class="w-5 h-5 text-[#2276ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <span class="cc-cart-vendor-name font-bold text-base text-slate-900 dark:text-white Poppins">${esc(storeName)}</span>
      </div>
      <span class="cc-chip green text-xs font-semibold px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 rounded-full border border-emerald-200 dark:border-emerald-800">Envío disponible</span>
    </header>
    <div class="cc-cart-vendor-body">
      <div class="cc-cart-list flex flex-col gap-3">
        ${items.map(i => cartLineHtml(i, fromApi)).join('')}
      </div>
    </div>
    <footer class="cc-cart-vendor-footer mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-sm">
      <div class="cc-order-line flex items-center gap-2"><span class="text-slate-500">Subtotal tienda:</span><b class="text-slate-900 dark:text-white font-bold">${money(groupSubtotal)}</b></div>
      <div class="cc-order-line flex items-center gap-2"><span class="text-slate-500">Envío estimado:</span><b class="text-slate-900 dark:text-white font-bold">${money(shippingEstimate)}</b></div>
    </footer>
  </section>`;
}

function renderItems(items, fromApi=false){
  const listBox = document.querySelector('[data-cart-list]');
  const empty = document.querySelector('[data-cart-empty]');
  const subtotal = fromApi ? Number(apiCart?.total || 0) : localSubtotal(items);

  if(empty) empty.classList.toggle('hidden', items.length > 0);

  if(listBox){
    if(items.length === 0){
      listBox.innerHTML = '';
    } else {
      // Agrupar por tienda
      const groups = {};
      items.forEach(item => {
        const key = item.tienda_nombre || item.store_name || item.tienda_id || 'Tienda CommerCity';
        if(!groups[key]) groups[key] = [];
        groups[key].push(item);
      });

      const hasMultipleStores = Object.keys(groups).length > 1;
      if(hasMultipleStores || (fromApi && Object.keys(groups).length >= 1)){
        // Render agrupado por tienda
        listBox.innerHTML = Object.entries(groups)
          .map(([storeName, storeItems]) => vendorGroupHtml(storeName, storeItems, fromApi))
          .join('');
      } else {
        // Render flat (carrito local sin datos de tienda)
        listBox.innerHTML = items.map(i => cartLineHtml(i, fromApi)).join('');
      }
    }
  }

  document.querySelectorAll('[data-cart-subtotal]').forEach(el => { el.textContent = money(subtotal); });
  document.querySelectorAll('[data-cart-total]').forEach(el => { el.textContent = money(subtotal); });
  syncHeaderStatusIcons();
}

async function loadApiCart({announce=true}={}){
  apiCart = (await api.get('/cart')).data;
  renderItems(apiCart.items || [], true);
  if(announce) showMessage('#cartMsg', 'Carrito sincronizado con tu cuenta.', true);
}
function renderLocal(){ renderItems(localCart(), false); }
async function renderCart(){ if(token()){ try { await loadApiCart(); return; } catch(error) { showMessage('#cartMsg', `${error.message} Se mantiene carrito local sin sesión.`); } } renderLocal(); }

async function validateCart(){
  if (validatingCart) return;
  const items = token() && apiCart
    ? (apiCart.items || []).map(i => ({producto_id: i.producto_id, cantidad: i.cantidad}))
    : localCart().map(i => ({producto_id: Number(i.id), cantidad: Number(i.cantidad || 1)}));
  if(!items.length){ showMessage('#cartMsg', 'Agrega productos antes de validar el carrito.'); return; }
  validatingCart = true;
  try {
    const validation = (await api.post('/cart/validate', {items})).data || {};
    const invalidItems = Array.isArray(validation.invalid_items) ? validation.invalid_items : [];
    const priceChanges = Array.isArray(validation.price_changes) ? validation.price_changes : [];
    const issues = [...invalidItems, ...priceChanges];
    if(issues.length) {
      const message = issues.map(item => String(item.reason || 'El carrito requiere revisión.')).join(' ');
      showMessage('#cartMsg', message);
      if(token()) {
        try {
          await loadApiCart({announce:false});
          showMessage('#cartMsg', message);
        } catch(refreshError) {
          showMessage('#cartMsg', `${message} ${refreshError.message || 'No fue posible actualizar los valores del carrito.'}`);
        }
      }
      return;
    }
    showMessage('#cartMsg', 'Carrito validado con la API real.', true);
  } catch(error) {
    showMessage('#cartMsg', `${error.message} El carrito se mantiene sin perder productos.`);
  } finally {
    validatingCart = false;
  }
}

async function removeItem(id){
  const safeId = String(id);
  if (pendingCartItems.has(safeId)) return;
  pendingCartItems.add(safeId);
  try {
    if(token()){ await api.delete(`/cart/items/${safeId}`); await loadApiCart(); return; }
    const list = localCart().filter(item => String(item.id) !== safeId); saveCart(list); renderLocal();
  } finally {
    pendingCartItems.delete(safeId);
  }
}

async function changeQty(id, delta){
  const safeId = String(id);
  if (pendingCartItems.has(safeId)) return;
  pendingCartItems.add(safeId);
  try {
    if(token()){
      const item = (apiCart?.items || []).find(i => String(i.id) === safeId); if(!item) return;
      const cantidad = Math.max(1, Number(item.cantidad || 1) + delta);
      await api.patch(`/cart/items/${safeId}`, {cantidad}); await loadApiCart(); return;
    }
    const list = localCart(); const item = list.find(i => String(i.id) === safeId); if(!item) return;
    item.cantidad = Math.max(1, Number(item.cantidad || 1) + delta); saveCart(list); renderLocal();
  } finally {
    pendingCartItems.delete(safeId);
  }
}

async function clearCart(){
  if (clearingCart) return;
  clearingCart = true;
  try {
    if(token()){ await api.delete('/cart'); await loadApiCart(); return; }
    saveCart([]); renderLocal();
  } finally {
    clearingCart = false;
  }
}

export function initCart(){
  renderCart();
  document.querySelector('#validateCart')?.addEventListener('click', validateCart);
  document.addEventListener('click', async event => {
    const remove = event.target.closest('[data-remove-cart]');
    const inc = event.target.closest('[data-cart-inc]');
    const dec = event.target.closest('[data-cart-dec]');
    const clear = event.target.closest('[data-clear-cart]');
    try {
      if(remove) await removeItem(remove.dataset.removeCart);
      if(inc) await changeQty(inc.dataset.cartInc, 1);
      if(dec) await changeQty(dec.dataset.cartDec, -1);
      if(clear) await clearCart();
    } catch(error) { showMessage('#cartMsg', error.message); }
  });
}
initCart();
