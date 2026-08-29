import { api } from './api.js';
import { escapeHtml, money } from './ui.js';

function capitalize(s) {
  if (typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

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
    shipmentLabel.textContent = capitalize(onlyShipment?.estado || 'No disponible');
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

    packageEntry.append(identity, carrierText, guideText);
    packageList.append(packageEntry);
  });

  shipmentBlock.append(packageList);
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

    if (loading) loading.classList.add('hidden');
    if (contentBox) contentBox.classList.remove('hidden');

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
