import { api, clearSession } from './api.js';
import { showMessage } from './ui.js';

let currentModalAction = null;
let modalContainer = null;

function createModal() {
  if (modalContainer) return;
  modalContainer = document.createElement('div');
  modalContainer.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 hidden';
  modalContainer.setAttribute('role', 'dialog');
  modalContainer.setAttribute('aria-modal', 'true');
  modalContainer.setAttribute('aria-labelledby', 'modalTitle');
  modalContainer.innerHTML = `
    <div class="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-xl border border-slate-200 dark:border-slate-800 relative">
      <h2 id="modalTitle" class="text-xl font-bold mb-4 text-slate-900 dark:text-white Poppins"></h2>
      <div id="modalExplanation" class="text-sm text-slate-700 dark:text-slate-300 mb-4 space-y-2"></div>
      <div id="modalExtraContent" class="mb-4 hidden"></div>
      <div class="flex items-center gap-3 mt-6 justify-end">
        <button id="modalCancelBtn" class="cc-btn outline px-4 py-2 text-sm font-bold rounded-xl transition-all border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300" type="button">Cancelar</button>
        <button id="modalConfirmBtn" class="cc-btn px-4 py-2 text-sm font-bold rounded-xl transition-all text-white" type="button"></button>
      </div>
    </div>
  `;
  document.body.appendChild(modalContainer);

  modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) closeModal();
  });

  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalConfirmBtn').addEventListener('click', handleConfirm);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalContainer.classList.contains('hidden')) {
      closeModal();
    }
  });
}

function showModal(config) {
  createModal();
  document.getElementById('modalTitle').textContent = config.title;

  const expDiv = document.getElementById('modalExplanation');
  expDiv.innerHTML = '';
  config.explanation.forEach(pText => {
    const p = document.createElement('p');
    p.textContent = pText;
    expDiv.appendChild(p);
  });

  const extraDiv = document.getElementById('modalExtraContent');
  if (config.extraHtml) {
    extraDiv.innerHTML = config.extraHtml;
    extraDiv.classList.remove('hidden');
  } else {
    extraDiv.innerHTML = '';
    extraDiv.classList.add('hidden');
  }

  const confirmBtn = document.getElementById('modalConfirmBtn');
  confirmBtn.textContent = config.confirmText;
  confirmBtn.className = `cc-btn px-4 py-2 text-sm font-bold rounded-xl transition-all text-white ${config.confirmClass}`;
  confirmBtn.disabled = false;

  currentModalAction = config.action;
  modalContainer.classList.remove('hidden');
  document.getElementById('modalCancelBtn').focus();
}

function closeModal() {
  if (modalContainer) {
    modalContainer.classList.add('hidden');
    currentModalAction = null;

    // Return focus to appropriate button if possible
    const btn = document.querySelector('[data-deactivate-account]');
    if (btn) btn.focus();
  }
}

async function handleConfirm() {
  if (!currentModalAction) return;
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const originalText = confirmBtn.textContent;

  try {
    confirmBtn.disabled = true;
    await currentModalAction();
  } catch (err) {
    console.error(err);
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalText;
    }
  }
}

async function loadAccountStatus() {
  const statusContent = document.getElementById('accountStatusContent');
  const btnDeactivate = document.querySelector('[data-deactivate-account]');
  const btnDelete = document.querySelector('[data-delete-request]');

  if (!statusContent) return;

  try {
    const response = await api.get('/account/settings');
    const acc = response.data?.account_status;
    if (!acc) throw new Error('No se encontraron los datos de estado de la cuenta.');

    // Status resolution
    let estadoReq = 'Sin solicitud';
    if (acc.solicitud_eliminacion_estado === 'pendiente') estadoReq = 'Pendiente de revisión';
    else if (acc.solicitud_eliminacion_estado === 'rechazada') estadoReq = 'Solicitud rechazada';
    else if (acc.solicitud_eliminacion_estado === 'aprobada') estadoReq = 'Solicitud aprobada';

    // Format date
    let fechaReq = '';
    if (acc.solicitud_eliminacion_fecha) {
      fechaReq = new Date(acc.solicitud_eliminacion_fecha).toLocaleDateString();
    }

    // HTML Build
    statusContent.innerHTML = '';

    // Block 1: Basic Status
    const divBasic = document.createElement('div');
    divBasic.className = 'grid grid-cols-1 md:grid-cols-2 gap-4';
    divBasic.innerHTML = `
      <div><span class="font-bold">Estado:</span> <span id="st-estado"></span></div>
      <div><span class="font-bold">Rol:</span> <span id="st-rol"></span></div>
      <div><span class="font-bold">Solicitud de eliminación:</span> <span id="st-sol"></span></div>
      ${acc.solicitud_eliminacion_fecha ? `<div><span class="font-bold">Solicitada el:</span> <span id="st-fecha"></span></div>` : ''}
    `;
    statusContent.appendChild(divBasic);

    document.getElementById('st-estado').textContent = acc.estado;
    document.getElementById('st-rol').textContent = acc.rol;
    document.getElementById('st-sol').textContent = estadoReq;
    if (acc.solicitud_eliminacion_fecha) {
      document.getElementById('st-fecha').textContent = fechaReq;
    }

    // Block 2: Pending Operations
    const pending = acc.pending_operations || { total: 0 };
    const divOps = document.createElement('div');
    divOps.className = 'mt-4 bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700';
    divOps.innerHTML = `
      <h3 class="font-bold mb-2">Operaciones pendientes</h3>
      <ul class="list-disc list-inside mb-2">
        <li>Pedidos pendientes: <span id="op-ped"></span></li>
        <li>Envíos pendientes: <span id="op-env"></span></li>
        <li>Devoluciones pendientes: <span id="op-dev"></span></li>
        <li>Reembolsos pendientes: <span id="op-rem"></span></li>
      </ul>
      <p class="font-bold">Total: <span id="op-tot"></span></p>
    `;
    statusContent.appendChild(divOps);

    document.getElementById('op-ped').textContent = pending.pedidos || 0;
    document.getElementById('op-env').textContent = pending.envios || 0;
    document.getElementById('op-dev').textContent = pending.devoluciones || 0;
    document.getElementById('op-rem').textContent = pending.reembolsos || 0;
    document.getElementById('op-tot').textContent = pending.total || 0;

    // Block 3: Messages
    const divMsg = document.createElement('div');
    divMsg.className = 'mt-4';
    if (pending.total === 0) {
      divMsg.innerHTML = '<p class="text-emerald-600 dark:text-emerald-400 font-bold">No tienes operaciones pendientes que impidan desactivar temporalmente tu cuenta.</p>';
    } else {
      divMsg.innerHTML = '<p class="text-rose-600 dark:text-rose-400 font-bold">No puedes desactivar temporalmente tu cuenta mientras estas operaciones continúen pendientes.</p><p class="text-sm mt-1 cc-muted">Cuando los procesos finalicen podrás volver a intentar la desactivación.</p>';
    }

    if (acc.solicitud_eliminacion_estado === 'pendiente') {
      const pReq = document.createElement('p');
      pReq.className = 'text-amber-600 dark:text-amber-400 font-bold mt-2';
      pReq.textContent = 'Tu solicitud de eliminación está pendiente de revisión administrativa.';
      divMsg.appendChild(pReq);
    } else if (acc.solicitud_eliminacion_estado === 'rechazada') {
      const pReq = document.createElement('p');
      pReq.className = 'text-slate-600 dark:text-slate-400 font-bold mt-2';
      pReq.textContent = 'Tu solicitud anterior fue rechazada. Puedes enviar una nueva solicitud si lo deseas.';
      divMsg.appendChild(pReq);
    } else if (acc.solicitud_eliminacion_estado === 'ninguna') {
      const pReq = document.createElement('p');
      pReq.className = 'text-slate-600 dark:text-slate-400 mt-2';
      pReq.textContent = 'No tienes solicitudes de eliminación activas.';
      divMsg.appendChild(pReq);
    }

    statusContent.appendChild(divMsg);

    // Update Deactivate Button
    if (btnDeactivate) {
      if (!acc.can_deactivate) {
        btnDeactivate.disabled = true;
        btnDeactivate.setAttribute('aria-disabled', 'true');
        btnDeactivate.title = 'Finaliza tus operaciones pendientes antes de desactivar la cuenta.';
      } else {
        btnDeactivate.disabled = false;
        btnDeactivate.removeAttribute('aria-disabled');
        btnDeactivate.title = '';
      }
    }

    // Update Delete Request Button
    if (btnDelete) {
      if (acc.solicitud_eliminacion_estado === 'pendiente' || acc.solicitud_eliminacion_estado === 'aprobada' || acc.anonimizado) {
        btnDelete.disabled = true;
        btnDelete.textContent = acc.solicitud_eliminacion_estado === 'pendiente' ? 'Solicitud pendiente' : 'Cuenta procesada';
      } else {
        btnDelete.disabled = false;
        btnDelete.textContent = 'Solicitar eliminación';
      }
    }

  } catch (err) {
    statusContent.textContent = 'No fue posible cargar el estado actual de la cuenta.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadAccountStatus();

  const btnDeactivate = document.querySelector('[data-deactivate-account]');
  const btnDelete = document.querySelector('[data-delete-request]');

  if (btnDeactivate) {
    btnDeactivate.addEventListener('click', () => {
      showModal({
        title: '¿Desactivar temporalmente tu cuenta?',
        explanation: [
          'Tu cuenta quedará inactiva y se cerrará tu sesión.',
          'Podrás reactivarla posteriormente utilizando tu correo y contraseña.',
          'Si eres vendedor y tu tienda está activa, la tienda será pausada automáticamente.'
        ],
        confirmText: 'Sí, desactivar mi cuenta',
        confirmClass: 'bg-rose-600 hover:bg-rose-700 danger',
        action: async () => {
          document.getElementById('modalConfirmBtn').textContent = 'Desactivando...';
          try {
            await api.patch('/account/deactivate', {});
            showMessage('#accountDangerMsg', 'Cuenta desactivada correctamente. Cerrando sesión...', true);
            closeModal();
            setTimeout(() => {
              clearSession();
              window.location.href = 'login.html';
            }, 1000);
          } catch (err) {
            closeModal();
            showMessage('#accountDangerMsg', err.message, false);
            await loadAccountStatus();
          }
        }
      });
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', () => {
      showModal({
        title: '¿Solicitar la eliminación de tu cuenta?',
        explanation: [
          'Esta acción no elimina tu cuenta inmediatamente. La solicitud será enviada para revisión administrativa.',
          'Si la solicitud es aprobada, tus datos personales serán anonimizados, pero CommerCity conservará los registros históricos necesarios para pedidos, pagos, envíos y auditoría.',
          'Mientras la solicitud esté pendiente podrás continuar utilizando tu cuenta según las reglas actuales de la plataforma.'
        ],
        extraHtml: `
          <label class="block mt-2">
            <span class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Motivo de la solicitud (opcional)</span>
            <textarea id="deleteReasonInput" class="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#fa8000] text-sm resize-none" rows="3" maxlength="500"></textarea>
          </label>
        `,
        confirmText: 'Sí, enviar solicitud',
        confirmClass: 'bg-rose-800 hover:bg-rose-900 danger-strong',
        action: async () => {
          document.getElementById('modalConfirmBtn').textContent = 'Enviando...';
          const reasonInput = document.getElementById('deleteReasonInput');
          const motivo = reasonInput ? reasonInput.value.trim() : '';

          try {
            const body = { confirmar_eliminacion: true };
            if (motivo) {
              body.motivo = motivo;
            }
            await api.post('/account/delete-request', body);
            closeModal();
            showMessage('#accountDangerMsg', 'Solicitud de eliminación enviada correctamente. Quedó pendiente de revisión administrativa.', true);
            await loadAccountStatus();
          } catch (err) {
            closeModal();
            showMessage('#accountDangerMsg', err.message, false);
          }
        }
      });
    });
  }
});
