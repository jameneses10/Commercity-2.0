const STORAGE_KEY = 'cc_payment_result';

function getElements() {
    return {
        root: document.querySelector('[data-payment-result-root]'),
        empty: document.querySelector('[data-payment-result-empty]'),
        status: document.querySelector('[data-payment-result-status]'),
        order: document.querySelector('[data-payment-result-order]'),
        message: document.querySelector('[data-payment-result-message]'),
        shipments: document.querySelector('[data-payment-result-shipments]')
    };
}

function readResult() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

function isValidResult(result) {
    if (!result) return false;

    // pedido_id válido
    const orderId = Number(result.pedido_id);
    if (!Number.isInteger(orderId) || orderId <= 0) return false;

    // estado
    if (result.estado !== 'aprobado') return false;

    // mensaje string
    if (typeof result.mensaje !== 'string') return false;

    // envios_creados >= 0
    const shipments = Number(result.envios_creados);
    if (!Number.isInteger(shipments) || shipments < 0) return false;

    return true;
}

function showEmptyState(elements) {
    if (elements.root) elements.root.style.display = 'none';
    if (elements.empty) elements.empty.style.display = '';
}

function showResult(elements, result) {
    if (elements.empty) elements.empty.style.display = 'none';

    if (elements.order) {
        elements.order.textContent = `Pedido #${result.pedido_id}`;
    }

    if (elements.status) {
        elements.status.textContent = '¡Pago realizado con éxito!';
    }

    if (elements.message) {
        elements.message.textContent = result.mensaje || 'Tu pago sandbox fue aprobado correctamente.';
    }

    if (elements.shipments) {
        elements.shipments.textContent = `Envíos generados: ${result.envios_creados}`;
    }

    if (elements.root) elements.root.style.display = '';
}

function init() {
    const elements = getElements();
    // Guard: si no están los elementos principales, salir.
    if (!elements.root || !elements.empty) return;

    const result = readResult();

    if (isValidResult(result)) {
        showResult(elements, result);
    } else {
        showEmptyState(elements);
    }
}

init();
