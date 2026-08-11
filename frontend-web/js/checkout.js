import { api, currentUser, token } from './api.js';
import { escapeHtml, money } from './ui.js';

let context = {
    direccion_id: null,
    valid_items: [],
    total: 0,
    valid: false
};

const root = document.querySelector('[data-checkout-root]');
const addressSelect = document.querySelector('[data-checkout-address]');
const addressEmpty = document.querySelector('[data-checkout-address-empty]');
const itemsContainer = document.querySelector('[data-checkout-items]');
const subtotalEl = document.querySelector('[data-checkout-subtotal]');
const totalEl = document.querySelector('[data-checkout-total]');
const emptyCartMsg = document.querySelector('[data-checkout-empty]');
const submitBtn = document.querySelector('[data-payment-submit]');

let addressesData = [];

export async function revalidateCheckout() {
    try {
        const cartReq = await api.get('/cart');
        const cartItems = cartReq.data?.items || [];
        if(!cartItems.length) {
            context.valid = false;
            return context;
        }
        const validateReq = await api.post('/cart/validate', { items: cartItems });
        const validation = validateReq.data;

        context.valid_items = validation.valid_items || [];
        context.total = validation.total || 0;
        context.valid = (context.valid_items.length > 0 && validation.invalid_items.length === 0 && context.direccion_id);

        return context;
    } catch(err) {
        context.valid = false;
        return context;
    }
}

export function getCheckoutContext() {
    return context;
}

async function loadAddresses() {
    try {
        const res = await api.get('/addresses');
        addressesData = res.data.addresses || [];

        if(addressesData.length === 0) {
            addressEmpty.classList.remove('cc-hidden');
            addressSelect.closest('.cc-label').classList.add('cc-hidden');
            context.direccion_id = null;
            updateSubmitState();
            return;
        }

        let html = '';
        let defaultId = null;
        for(const addr of addressesData) {
            if(addr.es_principal) defaultId = addr.id;
            html += `<option value="${escapeHtml(String(addr.id))}">${escapeHtml(addr.direccion)} - ${escapeHtml(addr.ciudad)}</option>`;
        }

        addressSelect.innerHTML = html;
        if(!defaultId && addressesData.length > 0) defaultId = addressesData[0].id;

        if(defaultId) {
            addressSelect.value = defaultId;
            updateAddressFields(defaultId);
        }

        addressSelect.addEventListener('change', (e) => {
            updateAddressFields(e.target.value);
        });

    } catch (error) {
        addressSelect.innerHTML = `<option value="">Error al cargar direcciones</option>`;
        context.direccion_id = null;
        updateSubmitState();
    }
}

function updateAddressFields(id) {
    const addr = addressesData.find(a => String(a.id) === String(id));
    if(addr) {
        context.direccion_id = addr.id;
        document.querySelector('[data-addr-name]').value = addr.receptor || currentUser()?.nombre || '';
        document.querySelector('[data-addr-city]').value = addr.ciudad || '';
        document.querySelector('[data-addr-line]').value = addr.direccion || '';
        document.querySelector('[data-addr-phone]').value = addr.telefono || '';
    } else {
        context.direccion_id = null;
    }
    updateSubmitState();
}

async function loadCart() {
    try {
        const cartReq = await api.get('/cart');
        const cartItems = cartReq.data?.items || [];

        if(!cartItems.length) {
            renderEmptyCart();
            return;
        }

        const validateReq = await api.post('/cart/validate', { items: cartItems });
        const validation = validateReq.data;

        context.valid_items = validation.valid_items || [];
        context.total = validation.total || 0;

        if(context.valid_items.length === 0 || validation.invalid_items.length > 0) {
            renderEmptyCart(true);
            return;
        }

        renderItems(context.valid_items);
        subtotalEl.textContent = money(context.total);
        totalEl.textContent = money(context.total);

        updateSubmitState();
    } catch(err) {
        renderEmptyCart(true);
    }
}

function renderItems(items) {
    let html = '';
    for(const item of items) {
        html += `<div class="flex justify-between">
            <span>${escapeHtml(item.nombre)} x${escapeHtml(String(item.cantidad))}</span>
            <b>${escapeHtml(money(item.subtotal))}</b>
        </div>`;
    }
    itemsContainer.innerHTML = html;
}

function renderEmptyCart(hasInvalid = false) {
    itemsContainer.innerHTML = `<div class="flex justify-between text-red-500"><span>Carrito no válido o vacío</span></div>`;
    subtotalEl.textContent = '$ 0';
    totalEl.textContent = '$ 0';
    emptyCartMsg.classList.remove('cc-hidden');
    context.valid_items = [];
    context.total = 0;
    updateSubmitState();
}

function updateSubmitState() {
    context.valid = !!(context.direccion_id && context.valid_items.length > 0);
    if(submitBtn) submitBtn.disabled = !context.valid;
}

async function init() {
    if(!root) return;
    if(!token() || currentUser()?.rol !== 'comprador') {
        window.location.href = 'login.html';
        return;
    }

    await loadAddresses();
    await loadCart();
}

init();
