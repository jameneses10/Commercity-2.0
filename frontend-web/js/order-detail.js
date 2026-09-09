import { api } from './api.js';
import { escapeHtml, money } from './ui.js';

function capitalize(s) {
  if (typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const shipmentStatusLabels = {
  pendiente: 'Pendiente',
  preparado: 'Preparado',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado'
};

function renderOrderPackages({ shipments, shipmentReadState, shipmentBlock, shipmentLabel, carrierRow, guideRow }) {
  if (carrierRow) {
    carrierRow.hidden = true;
    carrierRow.classList.add('hidden');
  }
  if (guideRow) {
    guideRow.hidden = true;
    guideRow.classList.add('hidden');
  }

  if (!shipmentBlock || !shipmentLabel) return;

  shipmentBlock.querySelector('[data-order-packages]')?.remove();

  if (shipmentReadState === 'unavailable') {
    shipmentLabel.textContent = 'Información de paquetes no disponible.';
    return;
  }

  if (shipments.length === 0) {
    shipmentLabel.textContent = 'Los paquetes aún no han sido generados.';
    return;
  }

  if (shipments.length === 1) {
    const [onlyShipment] = shipments;
    shipmentLabel.textContent = shipmentStatusLabels[onlyShipment?.estado] || 'No disponible';
  } else {
    shipmentLabel.textContent = `${shipments.length} paquetes`;
  }

  const packageList = document.createElement('div');
  packageList.dataset.orderPackages = '';
  packageList.className = 'mt-3 space-y-3';

  shipments.forEach((shipment, index) => {
    const storeName = String(shipment?.tienda_nombre || '').trim() || 'Tienda';
    const carrier = String(shipment?.transportadora || '').trim() || 'No disponible';
    const guide = String(shipment?.numero_guia || '').trim() || 'Guía aún no asignada';

    const packageEntry = document.createElement('div');
    packageEntry.className = 'rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm space-y-1';

    const identity = document.createElement('strong');
    identity.className = 'block font-bold text-slate-900 dark:text-white';
    identity.textContent = `Paquete ${index + 1} · ${storeName}`;

    const carrierText = document.createElement('p');
    carrierText.className = 'cc-muted text-xs';
    carrierText.textContent = `Transportadora: ${carrier}`;

    const guideText = document.createElement('p');
    guideText.className = 'cc-muted text-xs';
    guideText.textContent = `Guía: ${guide}`;

    const statusText = document.createElement('p');
    statusText.className = 'cc-muted text-xs';
    statusText.textContent = `Estado: ${shipmentStatusLabels[shipment?.estado] || 'No disponible'}`;

    packageEntry.append(identity, statusText, carrierText, guideText);
    packageList.append(packageEntry);
  });

  shipmentBlock.append(packageList);
}

function computeEligibleReturnItems(details, shipments) {
  const deliveredTiendaIds = new Set(
    (shipments || [])
      .filter(shipment => shipment && shipment.estado === 'entregado')
      .map(shipment => Number(shipment.tienda_id))
  );
  return (details || []).filter(detail => detail && deliveredTiendaIds.has(Number(detail.tienda_id)));
}

function disableReturnTrigger(trigger) {
  if (!trigger) return;
  trigger.setAttribute('aria-disabled', 'true');
  trigger.style.opacity = '0.5';
  trigger.style.pointerEvents = 'none';
}

function setupReturnRequest({ orderId, orderDetails, shipments }) {
  const trigger = document.querySelector('[data-request-return]');
  const formBlock = document.querySelector('[data-return-form]');
  const select = document.querySelector('[data-return-item-select]');
  const motivoInput = document.querySelector('[data-return-motivo]');
  const submitBtn = document.querySelector('[data-return-submit]');
  const cancelBtn = document.querySelector('[data-return-cancel]');
  const messageEl = document.querySelector('[data-return-message]');

  if (!trigger || !formBlock || !select || !motivoInput || !submitBtn || !messageEl) return;

  const eligibleItems = computeEligibleReturnItems(orderDetails, shipments);

  if (!eligibleItems.length) {
    disableReturnTrigger(trigger);
    formBlock.hidden = true;
    trigger.addEventListener('click', event => event.preventDefault());
    return;
  }

  select.innerHTML = eligibleItems.map(item => {
    const label = `${item.producto_nombre || 'Producto'} · ${item.tienda_nombre || 'Tienda'}`;
    return `<option value="${item.id}">${escapeHtml(label)}</option>`;
  }).join('');

  let submitted = false;

  trigger.addEventListener('click', event => {
    event.preventDefault();
    if (submitted) return;
    formBlock.hidden = !formBlock.hidden;
    messageEl.textContent = '';
  });

  cancelBtn?.addEventListener('click', () => {
    formBlock.hidden = true;
    messageEl.textContent = '';
  });

  submitBtn.addEventListener('click', async () => {
    if (submitted) return;
    const selectedId = parseInt(select.value, 10);
    const motivo = String(motivoInput.value || '').trim();

    if (!selectedId || !eligibleItems.some(item => Number(item.id) === selectedId)) {
      messageEl.textContent = 'Selecciona un producto válido para devolver.';
      return;
    }
    if (motivo.length < 3 || motivo.length > 160) {
      messageEl.textContent = 'El motivo debe tener entre 3 y 160 caracteres.';
      return;
    }

    submitBtn.disabled = true;
    messageEl.textContent = '';

    try {
      await api.post('/returns', {
        pedido_id: orderId,
        motivo,
        items: [{ pedido_detalle_id: selectedId }]
      });
      submitted = true;
      messageEl.textContent = 'Solicitud de devolución creada correctamente.';
      submitBtn.textContent = 'Solicitud enviada';
      if (cancelBtn) cancelBtn.hidden = true;
    } catch (error) {
      submitBtn.disabled = false;
      messageEl.textContent = (error && error.message) || 'No fue posible crear la solicitud de devolución.';
    }
  });
}

function sanitizeFilenamePart(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '');
}

function buildComprobanteDownloadHtml(comprobante) {
  const fechaStr = comprobante.fecha ? new Date(comprobante.fecha).toLocaleString('es-CO') : 'No disponible';
  const productos = Array.isArray(comprobante.productos) ? comprobante.productos : [];
  const rows = productos.map(p => `
    <tr>
      <td>${escapeHtml(p.nombre)}</td>
      <td style="text-align:center">${escapeHtml(String(p.cantidad))}</td>
      <td style="text-align:right">${escapeHtml(money(p.precio_unitario))}</td>
      <td style="text-align:right">${escapeHtml(money(p.subtotal))}</td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Comprobante ${escapeHtml(comprobante.numero)}</title>
<style>
body{font-family:Arial,sans-serif;color:#1e293b;padding:24px;max-width:640px;margin:0 auto}
h1{color:#fa8000;font-size:20px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{padding:8px;border-bottom:1px solid #e2e8f0;font-size:13px}
th{text-align:left;color:#64748b;text-transform:uppercase;font-size:11px}
.cc-total{font-size:18px;font-weight:bold;color:#fa8000;text-align:right;margin-top:12px}
</style>
</head>
<body>
<h1>CommerCity &mdash; Comprobante de compra</h1>
<p><b>N&uacute;mero:</b> ${escapeHtml(comprobante.numero)}</p>
<p><b>Fecha:</b> ${escapeHtml(fechaStr)}</p>
<p><b>Comprador:</b> ${escapeHtml(comprobante.comprador && comprobante.comprador.nombre)}</p>
<p><b>Estado del pago:</b> ${escapeHtml(comprobante.estado_pago)}</p>
<table>
<thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p class="cc-total">Total: ${escapeHtml(money(comprobante.total))}</p>
</body>
</html>`;
}

function downloadComprobante(comprobante) {
  const html = buildComprobanteDownloadHtml(comprobante);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeNumero = sanitizeFilenamePart(comprobante.numero) || 'comprobante';
  const a = document.createElement('a');
  a.href = url;
  a.download = `comprobante-${safeNumero}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderReceipt(comprobante) {
  const section = document.querySelector('[data-receipt-section]');
  const unavailable = document.querySelector('[data-receipt-unavailable]');
  if (!section) return;
  if (unavailable) unavailable.classList.add('hidden');

  const numeroEl = document.querySelector('[data-receipt-numero]');
  if (numeroEl) numeroEl.textContent = comprobante.numero || '';

  const fechaEl = document.querySelector('[data-receipt-fecha]');
  if (fechaEl) fechaEl.textContent = comprobante.fecha ? new Date(comprobante.fecha).toLocaleString('es-CO') : 'No disponible';

  const compradorEl = document.querySelector('[data-receipt-comprador]');
  if (compradorEl) compradorEl.textContent = (comprobante.comprador && comprobante.comprador.nombre) || 'No disponible';

  const estadoEl = document.querySelector('[data-receipt-estado-pago]');
  if (estadoEl) estadoEl.textContent = capitalize(comprobante.estado_pago || '');

  const itemsEl = document.querySelector('[data-receipt-items]');
  if (itemsEl) {
    const productos = Array.isArray(comprobante.productos) ? comprobante.productos : [];
    itemsEl.innerHTML = productos.map(p => `
      <tr>
        <td class="py-3 px-2">${escapeHtml(p.nombre)}</td>
        <td class="py-3 px-2 text-center">${escapeHtml(String(p.cantidad))}</td>
        <td class="py-3 px-2 text-right">${money(p.precio_unitario)}</td>
        <td class="py-3 px-2 text-right font-bold text-[#fa8000]">${money(p.subtotal)}</td>
      </tr>
    `).join('');
  }

  const totalEl = document.querySelector('[data-receipt-total]');
  if (totalEl) totalEl.textContent = money(comprobante.total || 0);

  section.classList.remove('hidden');

  const downloadBtn = document.querySelector('[data-receipt-download]');
  if (downloadBtn) downloadBtn.onclick = () => downloadComprobante(comprobante);
}

async function loadReceipt(id) {
  const unavailable = document.querySelector('[data-receipt-unavailable]');
  try {
    const data = await api.get(`/orders/${id}/comprobante`);
    const comprobante = (data && data.data && data.data.comprobante) || (data && data.comprobante);
    if (!comprobante) return;
    renderReceipt(comprobante);
  } catch (error) {
    if (error && error.status === 404) {
      if (unavailable) unavailable.classList.remove('hidden');
    } else {
      console.error('Error al cargar comprobante:', error);
      if (unavailable) {
        unavailable.textContent = 'No fue posible cargar el comprobante.';
        unavailable.classList.remove('hidden');
      }
    }
  }
}

async function initOrderDetail() {
  const loading = document.getElementById('orderDetailLoading');
  const errorBox = document.getElementById('orderDetailError');
  const contentBox = document.getElementById('orderDetailContent');
  const title = document.querySelector('[data-order-number]');

  function showError(titleText, msgText, topTitle) {
    if (loading) loading.classList.add('hidden');
    if (contentBox) contentBox.classList.add('hidden');
    if (errorBox) {
      errorBox.classList.remove('hidden');
      const errTitle = errorBox.querySelector('[data-error-title]');
      if (errTitle) errTitle.textContent = titleText;
      const errMsg = errorBox.querySelector('[data-error-message]');
      if (errMsg && msgText) errMsg.textContent = msgText;
    }
    if (title) title.textContent = topTitle || titleText;
  }

  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  const id = parseInt(idParam, 10);

  if (!idParam || isNaN(id) || id <= 0) {
    return showError('Pedido inválido', 'El identificador del pedido no es válido.');
  }

  try {
    const data = await api.get(`/orders/${id}`);
    const order = data?.data?.order || data?.order;
    if (!order) throw new Error('Estructura de datos inválida.');

    let addressStr = 'No disponible';
    if (order.direccion_id) {
      try {
        const addressData = await api.get('/addresses');
        const addresses = addressData?.data?.addresses || addressData?.addresses || [];
        const match = addresses.find(a => a.id === order.direccion_id);
        if (match) {
          addressStr = `${match.direccion || ''} - ${match.ciudad || ''}`.replace(/^-|-$/g,'').trim() || 'No disponible';
        }
      } catch (e) {
        console.error('Error al cargar dirección:', e);
      }
    }

    let orderShipments = [];
    let shipmentReadState = 'ok';

    try {
      const shipData = await api.get('/shipments/my-shipments');
      let shipments = shipData?.data?.shipments || shipData?.shipments || [];
      if (!Array.isArray(shipments)) shipments = [];
      orderShipments = shipments.filter(
        shipment => shipment && String(shipment.pedido_id) === String(id)
      );
    } catch (e) {
      shipmentReadState = 'unavailable';
      console.error('Error al cargar envíos:', e);
    }

    if (title) title.textContent = `Pedido #${order.id}`;

    const labelId = document.querySelector('[data-order-id-label]');
    if (labelId) labelId.textContent = `#${order.id}`;

    const dateVal = order.created_at || order.fecha;
    const dateStr = dateVal ? new Date(dateVal).toLocaleDateString('es-CO') : 'Fecha no disponible';
    const labelDate = document.querySelector('[data-order-date]');
    if (labelDate) labelDate.textContent = dateStr;
    const timeDate = document.querySelector('[data-order-timeline-date]');
    if (timeDate) timeDate.textContent = dateStr;

    const labelGen = document.querySelector('[data-order-general-status]');
    if (labelGen) labelGen.textContent = capitalize(order.estado_general || 'Pendiente');

    const labelPay = document.querySelector('[data-order-payment-status]');
    if (labelPay) {
      const pStat = order.estado_pago || 'pendiente';
      labelPay.innerHTML = `<span class="cc-chip ${pStat === 'pagado' ? 'blue' : 'orange'} text-xs font-semibold px-2.5 py-1 bg-slate-50 rounded-full border">Estado del pago: ${capitalize(pStat)}</span>`;
    }

    const labelTotal = document.querySelector('[data-order-total]');
    if (labelTotal) labelTotal.textContent = money(order.total || 0);

    const labelAddr = document.querySelector('[data-order-address]');
    if (labelAddr) labelAddr.textContent = escapeHtml(addressStr);

    renderOrderPackages({
      shipments: orderShipments,
      shipmentReadState,
      shipmentBlock: document.querySelector('[data-order-shipment-block]'),
      shipmentLabel: document.querySelector('[data-order-shipment]'),
      carrierRow: document.querySelector('[data-order-carrier-row]'),
      guideRow: document.querySelector('[data-order-guide-row]')
    });

    const itemsBox = document.querySelector('[data-order-items]');
    if (itemsBox) {
      const items = order.details || order.items || [];
      if (items.length) {
        itemsBox.innerHTML = items.map(it => `
          <tr>
            <td class="py-3 px-2 font-medium text-slate-900 dark:text-white flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <img class="cc-icon w-5 h-5 text-slate-500" src="assets/icons/cc-product-card.svg" alt="">
              </div>
              <div class="flex flex-col">
                <span>${escapeHtml(it.producto_nombre || 'Producto')}</span>
                ${it.tienda_nombre ? `<span class="text-xs text-slate-500">${escapeHtml(it.tienda_nombre)}</span>` : ''}
              </div>
            </td>
            <td class="py-3 px-2 text-center">${escapeHtml(String(it.cantidad || 1))}</td>
            <td class="py-3 px-2 text-right">${money(it.precio_unitario || 0)}</td>
            <td class="py-3 px-2 text-right font-bold text-[#fa8000]">${money(it.subtotal || 0)}</td>
          </tr>
        `).join('');
      } else {
        itemsBox.innerHTML = `<tr><td colspan="4" class="text-center py-4">No hay productos en el detalle.</td></tr>`;
      }
    }

    setupReturnRequest({ orderId: id, orderDetails: order.details || order.items || [], shipments: orderShipments });

    if (loading) loading.classList.add('hidden');
    if (contentBox) contentBox.classList.remove('hidden');

    await loadReceipt(id);

  } catch (error) {
    if (error.statusCode === 403 || error.status === 403 || (error.message && error.message.includes('403'))) {
      showError('No tiene permisos para ver este pedido.', 'El pedido no pertenece a la cuenta actual.', 'Acceso denegado');
    } else if (error.statusCode === 404 || error.status === 404 || (error.message && error.message.includes('404'))) {
      showError('Pedido no encontrado.', 'El pedido no existe o fue eliminado.', 'Pedido no encontrado');
    } else {
      showError('No fue posible cargar el pedido.', error.message, 'No fue posible cargar el pedido');
    }
  }
}

document.addEventListener('DOMContentLoaded', initOrderDetail);
