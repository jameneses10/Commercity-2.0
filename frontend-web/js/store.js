import { api } from './api.js';
import { escapeHtml, money } from './ui.js';
import { UPLOADS_BASE_URL } from './config.js';

const LEVEL_LABELS = { platino: 'Platino', oro: 'Oro', regular: 'Regular' };

function imageUrl(v, fb = 'assets/icons/cc-product-card.svg') {
  if (!v) return fb;
  const s = String(v);
  if (s.startsWith('/uploads')) return `${UPLOADS_BASE_URL}${s.replace('/uploads', '')}`;
  if (s.startsWith('/')) return `${UPLOADS_BASE_URL}/${s.replace(/^\/+/, '')}`;
  return s;
}

function reviewCountLabel(total) {
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return 'Sin reseñas todavía';
  if (n === 1) return '1 reseña';
  return `${n} reseñas`;
}

function productCardPublic(p) {
  const id = p.id ?? p.producto_id ?? '';
  const name = p.nombre || 'Producto CommerCity';
  const category = p.categoria_nombre || 'Marketplace';
  const price = Number(p.precio_final ?? p.precio ?? 0) || 0;
  const img = imageUrl(p.imagen_url);
  const safeId = escapeHtml(id);
  return `<article class="cc-product">
    <a class="cc-product-media" href="producto-detalle.html?id=${safeId}" aria-label="Ver ${escapeHtml(name)}">
      <img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">
    </a>
    <div class="cc-product-body">
      <span class="cc-chip">${escapeHtml(category)}</span>
      <h3 class="cc-h3">${escapeHtml(name)}</h3>
      <p class="cc-price">${escapeHtml(money(price))}</p>
      <a class="cc-btn outline" href="producto-detalle.html?id=${safeId}">Ver producto</a>
    </div>
  </article>`;
}

function setText(el, value) { if (el) el.textContent = value; }
function show(el) { el?.classList.remove('hidden'); }
function hide(el) { el?.classList.add('hidden'); }

async function loadStoreProfile() {
  const root = document.querySelector('[data-store-page]');
  if (!root) return;

  const loading = root.querySelector('[data-store-loading]');
  const errorBox = root.querySelector('[data-store-error]');
  const errorTitle = root.querySelector('[data-store-error-title]');
  const errorMessage = root.querySelector('[data-store-error-message]');
  const content = root.querySelector('[data-store-content]');

  function fail(title, message) {
    hide(loading);
    hide(content);
    setText(errorTitle, title);
    setText(errorMessage, message);
    show(errorBox);
  }

  const rawId = new URLSearchParams(location.search).get('id');
  if (!rawId || !/^[1-9]\d*$/.test(rawId)) {
    fail('Tienda no especificada.', 'Abre este perfil desde el catálogo o el listado de tiendas para consultar una tienda real.');
    return;
  }
  const id = rawId;

  let store;
  try {
    const res = await api.get(`/stores/${encodeURIComponent(id)}`);
    store = res.data?.store || res.data || res.store;
    if (!store || !store.id) throw new Error('Respuesta de tienda inválida.');
  } catch (error) {
    if (error?.status === 404) {
      fail('Tienda no encontrada.', 'La tienda solicitada no existe o ya no está disponible.');
    } else {
      fail('No pudimos cargar esta tienda.', error?.message || 'Ocurrió un error al consultar la tienda.');
    }
    return;
  }

  hide(loading);
  hide(errorBox);
  show(content);

  setText(root.querySelector('[data-store-name]'), store.nombre || 'Tienda CommerCity');
  setText(root.querySelector('[data-store-description]'), store.descripcion || 'Esta tienda aún no agregó una descripción.');
  const logo = root.querySelector('[data-store-logo]');
  if (logo) logo.src = imageUrl(store.logo_url, 'assets/icons/cc-store.svg');

  const [reputationResult, productsResult] = await Promise.allSettled([
    api.get(`/stores/${encodeURIComponent(id)}/reputation`),
    api.get(`/stores/${encodeURIComponent(id)}/products`),
  ]);

  renderReputation(root, reputationResult);
  renderProducts(root, productsResult);
}

function renderReputation(root, result) {
  const reputationEl = root.querySelector('[data-store-reputation]');
  const levelEl = root.querySelector('[data-store-level]');
  const countEl = root.querySelector('[data-store-review-count]');
  const errorEl = root.querySelector('[data-store-reputation-error]');

  const data = result.status === 'fulfilled' ? (result.value.data || result.value) : null;
  const rawPromedio = data ? data.reputacion_promedio : undefined;
  const validPromedio =
    (typeof rawPromedio === 'number' && Number.isFinite(rawPromedio)) ||
    (typeof rawPromedio === 'string' && rawPromedio.trim() !== '' && Number.isFinite(Number(rawPromedio)));
  const promedio = validPromedio ? Number(rawPromedio) : NaN;
  const nivel = data ? data.nivel_reputacion : undefined;
  const total = data ? data.total_resenas : undefined;
  const validNivel = Object.prototype.hasOwnProperty.call(LEVEL_LABELS, nivel);

  if (result.status !== 'fulfilled' || !data || !validPromedio || !validNivel) {
    setText(reputationEl, '');
    setText(levelEl, '');
    setText(countEl, '');
    show(errorEl);
    return;
  }

  hide(errorEl);
  setText(reputationEl, promedio.toFixed(2));
  setText(levelEl, LEVEL_LABELS[nivel]);
  setText(countEl, reviewCountLabel(total));
}

function renderProducts(root, result) {
  const box = root.querySelector('[data-store-products]');
  const emptyEl = root.querySelector('[data-store-products-empty]');
  const errorEl = root.querySelector('[data-store-products-error]');
  if (!box) return;

  if (result.status !== 'fulfilled') {
    box.innerHTML = '';
    hide(emptyEl);
    show(errorEl);
    return;
  }

  hide(errorEl);
  const payload = result.value.data || result.value;
  const products = Array.isArray(payload?.products) ? payload.products : [];

  if (!products.length) {
    box.innerHTML = '';
    show(emptyEl);
    return;
  }

  hide(emptyEl);
  box.innerHTML = products.map(productCardPublic).join('');
}

loadStoreProfile();
