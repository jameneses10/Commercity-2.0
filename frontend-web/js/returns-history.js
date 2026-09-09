import { api } from './api.js';
import { money } from './ui.js';

const STATUS_LABELS = {
  solicitada: 'Solicitada',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  producto_recibido: 'Producto recibido',
  reembolso_simulado: 'Reembolso simulado',
  cerrada: 'Cerrada'
};

function statusLabel(estado) {
  return STATUS_LABELS[estado] || 'Estado no disponible';
}

function formatDate(value) {
  if (!value) return 'Fecha no disponible';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Fecha no disponible';
  return parsed.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

function clearContainer(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

function renderLoading(container) {
  clearContainer(container);
  const card = document.createElement('article');
  card.className = 'cc-card cc-order-card';
  const text = document.createElement('p');
  text.className = 'cc-muted';
  text.textContent = 'Cargando tu historial de devoluciones…';
  card.appendChild(text);
  container.appendChild(card);
}

function renderEmpty(container) {
  clearContainer(container);
  const card = document.createElement('article');
  card.className = 'cc-card cc-order-card';
  const title = document.createElement('h2');
  title.className = 'text-xl font-bold';
  title.textContent = 'Aún no tienes solicitudes de devolución o reembolso.';
  const text = document.createElement('p');
  text.className = 'cc-muted text-sm mt-1';
  text.textContent = 'Cuando solicites una devolución desde el detalle de un pedido, aparecerá aquí.';
  card.appendChild(title);
  card.appendChild(text);
  container.appendChild(card);
}

function renderErrorState(container) {
  clearContainer(container);
  const card = document.createElement('article');
  card.className = 'cc-card cc-order-card';
  const title = document.createElement('h2');
  title.className = 'text-xl font-bold';
  title.textContent = 'No fue posible cargar tu historial de devoluciones.';
  const text = document.createElement('p');
  text.className = 'cc-muted text-sm mt-1';
  text.textContent = 'Intenta nuevamente más tarde.';
  card.appendChild(title);
  card.appendChild(text);
  container.appendChild(card);
}

function buildEntryCard(entry) {
  const article = document.createElement('article');
  article.className = 'cc-card cc-order-card';

  const info = document.createElement('div');

  const chip = document.createElement('span');
  chip.className = 'cc-chip orange';
  chip.textContent = statusLabel(entry.estado);
  info.appendChild(chip);

  const title = document.createElement('h2');
  title.className = 'text-xl font-bold mt-2';
  title.textContent = `Solicitud #${entry.numero_solicitud || ''}`;
  info.appendChild(title);

  if (entry.motivo) {
    const motivo = document.createElement('p');
    motivo.className = 'cc-muted text-sm mt-1';
    motivo.textContent = entry.motivo;
    info.appendChild(motivo);
  }

  const meta = document.createElement('p');
  meta.className = 'cc-muted text-sm mt-1';
  meta.textContent = `${money(entry.monto_estimado)} · ${formatDate(entry.creado_en)}`;
  info.appendChild(meta);

  article.appendChild(info);
  return article;
}

function renderEntries(container, returns) {
  clearContainer(container);
  returns.forEach((entry) => container.appendChild(buildEntryCard(entry)));
}

async function initReturnsHistory() {
  const container = document.querySelector('[data-returns-history-list]');
  if (!container) return;

  renderLoading(container);

  let returns;
  try {
    const response = await api.get('/returns/my-returns');
    returns = response?.data?.returns || response?.returns || [];
  } catch (error) {
    renderErrorState(container);
    return;
  }

  if (!Array.isArray(returns) || !returns.length) {
    renderEmpty(container);
    return;
  }

  renderEntries(container, returns);
}

document.addEventListener('DOMContentLoaded', initReturnsHistory);
