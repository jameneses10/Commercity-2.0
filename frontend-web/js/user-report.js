// Reporte de usuarios (vendedores o compradores) contra el endpoint publicado
// POST /users/:id/report. Los limites del cliente reflejan createUserReportValidator:
// motivo 3..120, descripcion opcional hasta 1000.
import { api, token, currentUser } from './api.js';

export const USER_REPORT_MOTIVO_MIN = 3;
export const USER_REPORT_MOTIVO_MAX = 120;
export const USER_REPORT_DESCRIPCION_MAX = 1000;
export const USER_REPORT_REASONS = [
  'Incumplimiento de politicas',
  'Contenido ofensivo o abusivo',
  'Fraude o estafa',
  'Suplantacion de identidad',
  'Spam o publicidad no solicitada',
  'Otro motivo'
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[character]));
}

export function isSelf(userId) {
  const me = currentUser();
  return Boolean(me && String(me.id) === String(userId));
}

// Devuelve '' cuando no hay a quien reportar o cuando seria autorreporte,
// para no ofrecer una accion que el servidor rechazaria con 400.
export function userReportSection(userId, { titulo, descripcion } = {}) {
  if (userId === null || userId === undefined || String(userId).trim() === '') return '';
  if (isSelf(userId)) return '';
  const options = USER_REPORT_REASONS.map(reason => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`).join('');
  const heading = escapeHtml(titulo || 'Reportar usuario');
  const hint = escapeHtml(descripcion || 'Indica un motivo especifico si este usuario incumple las politicas.');
  return `<section class="cc-card mt-5" data-user-report="${escapeHtml(userId)}">`
    + `<div class="cc-section-title"><div><h2 class="text-2xl font-bold">${heading}</h2><p class="cc-muted">${hint}</p></div></div>`
    + `<label class="cc-label mt-3">Motivo<select class="cc-input" data-user-report-reason>${options}</select></label>`
    + `<label class="cc-label mt-3">Detalle (opcional)<textarea class="cc-input" rows="3" maxlength="${USER_REPORT_DESCRIPCION_MAX}" data-user-report-description placeholder="Agrega informacion que ayude a revisar el reporte"></textarea></label>`
    + `<div class="cc-card-actions-row mt-3"><button class="cc-btn" type="button" data-user-report-submit>Enviar reporte</button></div>`
    + `<p class="cc-muted mt-3" data-user-report-status aria-live="polite"></p></section>`;
}

export async function submitUserReport(root) {
  const status = root.querySelector('[data-user-report-status]');
  const button = root.querySelector('[data-user-report-submit]');
  const setStatus = text => { if (status) status.textContent = text; };
  if (!token()) { setStatus('Inicia sesion para reportar a este usuario.'); return false; }
  const userId = root.dataset.userReport;
  const motivo = String(root.querySelector('[data-user-report-reason]')?.value ?? '').trim();
  const descripcion = String(root.querySelector('[data-user-report-description]')?.value ?? '').trim();
  if (motivo.length < USER_REPORT_MOTIVO_MIN || motivo.length > USER_REPORT_MOTIVO_MAX) {
    setStatus(`El motivo debe tener entre ${USER_REPORT_MOTIVO_MIN} y ${USER_REPORT_MOTIVO_MAX} caracteres.`);
    return false;
  }
  if (descripcion.length > USER_REPORT_DESCRIPCION_MAX) {
    setStatus(`El detalle no puede superar ${USER_REPORT_DESCRIPCION_MAX} caracteres.`);
    return false;
  }
  if (button) button.disabled = true;
  setStatus('Enviando reporte...');
  try {
    await api.post(`/users/${encodeURIComponent(userId)}/report`, descripcion ? { motivo, descripcion } : { motivo });
    setStatus('Reporte enviado. El equipo administrativo lo revisara.');
    const description = root.querySelector('[data-user-report-description]');
    if (description) description.value = '';
    return true;
  } catch (error) {
    const code = Number(error?.status ?? error?.statusCode ?? 0);
    if (code === 409) setStatus('Ya reportaste a este usuario anteriormente.');
    else if (code === 400) setStatus(error?.message || 'No es posible reportar a este usuario.');
    else if (code === 401 || code === 403) setStatus('Inicia sesion como usuario valido para reportar.');
    else if (code === 404) setStatus('El usuario reportado no esta disponible.');
    else setStatus(`No fue posible enviar el reporte. ${error?.message || ''}`.trim());
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

export function bindUserReports(scope = document) {
  scope.querySelectorAll('[data-user-report]').forEach(root => {
    const button = root.querySelector('[data-user-report-submit]');
    if (!button || button.dataset.userReportBound === 'true') return;
    button.dataset.userReportBound = 'true';
    button.addEventListener('click', () => submitUserReport(root));
  });
}
