import { api, currentUser, token } from './api.js';
import { escapeHtml, money, showMessage } from './ui.js';

let context = {
    direccion_id: null,
    valid_items: [],
    price_changes: [],
    total: 0,
    valid: false,
    validation_message: '',
    /* #82: pedido ya creado al que apunta una referencia guardada.
       `estado_pendiente` tiene tres valores y no dos, porque "no he podido
       comprobarlo" no es lo mismo que "no hay ninguno":
         'ninguno'       no hay referencia, o se demostro que no sirve
         'reintento'     el pedido existe y admite pago
         'indeterminado' la consulta fallo por una causa transitoria */
    estado_pendiente: 'ninguno',
    pedido_pendiente: 0,
    pendiente_sin_verificar: 0,
    total_pendiente: 0,
    reintento: false
};

const root = document.querySelector('[data-checkout-root]');
const addressSelect = document.querySelector('[data-checkout-address]');
const addressEmpty = document.querySelector('[data-checkout-address-empty]');
const itemsContainer = document.querySelector('[data-checkout-items]');
const subtotalEl = document.querySelector('[data-checkout-subtotal]');
const totalEl = document.querySelector('[data-checkout-total]');
const emptyCartMsg = document.querySelector('[data-checkout-empty]');
const submitBtn = document.querySelector('[data-payment-submit]');

/* #82: pedido ya creado cuyo pago no llego a aprobarse. Desde #81 el carrito
   se consume al crear el pedido, de modo que tras un rechazo no queda nada
   con que reconstruirlo: el siguiente intento tiene que pagar ESE pedido.
   La referencia vive aqui, y no en payments.js, porque es `updateSubmitState`
   quien decide si el comprador puede enviar el formulario: guardandola solo
   en payments.js, al recargar la pagina el boton quedaba deshabilitado por un
   carrito vacio y el reintento era inalcanzable. */
const PEDIDO_PENDIENTE = 'cc_pedido_pendiente';

export function pedidoPendiente() {
    try {
        const n = Number(sessionStorage.getItem(PEDIDO_PENDIENTE) || 0);
        return Number.isInteger(n) && n > 0 ? n : 0;
    } catch (e) {
        return 0;   /* sessionStorage puede no estar disponible */
    }
}

/* Los dos escritores mantienen en paso el almacenamiento y el contexto. Se
   hace aqui y no en quien llama porque la decision de pagar ya no se toma
   leyendo sessionStorage: tras un rechazo, sin recargar la pagina, un
   contexto desfasado habria dejado crear un segundo pedido. */
export function recuerdaPedidoPendiente(id) {
    try { sessionStorage.setItem(PEDIDO_PENDIENTE, String(id)); } catch (e) { /* sin almacenamiento */ }
    context.pedido_pendiente = id;
    context.pendiente_sin_verificar = 0;
    context.estado_pendiente = 'reintento';   /* acaba de crearse: es pagable */
}

export function olvidaPedidoPendiente() {
    try { sessionStorage.removeItem(PEDIDO_PENDIENTE); } catch (e) { /* sin almacenamiento */ }
    context.pedido_pendiente = 0;
    context.pendiente_sin_verificar = 0;
    context.estado_pendiente = 'ninguno';
}

/* Un fallo al consultar no demuestra nada sobre el pedido. Solo dos
   respuestas lo hacen: 404 (no existe) y 403 (no es de este comprador).
   Un corte de red, un 5xx, una sesion caducada o una respuesta ilegible
   dejan la referencia intacta: borrarla ahi era perder precisamente lo
   unico con que recuperar un pedido que el carrito ya no puede reconstruir. */
function esDefinitivo(error) {
    if (error?.isNetworkError) return false;
    const estado = Number(error?.status);
    return estado === 404 || estado === 403;
}

/* Una referencia guardada puede haber caducado: otro dispositivo la pago, el
   comprador cambio de cuenta, o el pedido ya no existe. Se consulta al
   servidor y se descarta si se demuestra que no se puede reintentar, para que
   una referencia vieja no bloquee una compra nueva. */
export async function resuelvePedidoPendiente() {
    const id = pedidoPendiente();
    context.pedido_pendiente = 0;
    context.pendiente_sin_verificar = 0;
    context.total_pendiente = 0;
    if (!id) {
        context.estado_pendiente = 'ninguno';
        return 'ninguno';
    }
    try {
        const res = await api.get('/orders/' + id);
        const pedido = res.data?.order || res.data;
        const estado = pedido?.estado_pago;
        if (estado === 'pendiente' || estado === 'rechazado') {
            context.pedido_pendiente = id;
            context.total_pendiente = Number(pedido?.total) || 0;
            context.estado_pendiente = 'reintento';
            return 'reintento';
        }
        olvidaPedidoPendiente();            /* ya pagado, cancelado u otro estado */
        context.estado_pendiente = 'ninguno';
        return 'ninguno';
    } catch (e) {
        if (esDefinitivo(e)) {
            olvidaPedidoPendiente();        /* no existe o no es de este comprador */
            context.estado_pendiente = 'ninguno';
            return 'ninguno';
        }
        /* Se conserva la referencia y no se crea ningun pedido nuevo hasta
           saber en que estado quedo este. */
        context.pendiente_sin_verificar = id;
        context.estado_pendiente = 'indeterminado';
        return 'indeterminado';
    }
}

export function modoPendiente() {
    return context.estado_pendiente;
}
const paymentMessage = document.querySelector('[data-payment-message]');

let addressesData = [];

function invalidItemMessage(item = {}) {
    const providedName = item.nombre || item.producto_nombre;
    const label = providedName
        ? String(providedName)
        : (item.producto_id ? `Producto ${item.producto_id}` : 'Un producto');
    const state = String(item.estado || '').toLowerCase();
    const exhaustedByStock = item.stock_actual !== undefined && Number(item.stock_actual) === 0;

    if(state === 'agotado' || exhaustedByStock) return `${label} quedó agotado.`;
    if(state === 'oculto') return `${label} fue desactivado y ya no está disponible.`;
    if(state === 'eliminado') return `${label} ya no está disponible.`;
    return `${label}: ${String(item.reason || 'Ya no está disponible.')}`;
}

function invalidItemsMessage(items) {
    return items.map(invalidItemMessage).join(' ');
}

function priceChangesMessage(items) {
    return items
        .map(item => String(item.reason || `El precio de ${item.producto_nombre || `Producto ${item.producto_id}`} cambió.`))
        .join(' ');
}

function validationMessage(invalidItems, priceChanges) {
    return [
        invalidItems.length ? invalidItemsMessage(invalidItems) : '',
        priceChanges.length ? priceChangesMessage(priceChanges) : '',
    ].filter(Boolean).join(' ');
}

function renderCheckoutSummary(items, total) {
    renderItems(items);
    subtotalEl.textContent = money(total);
    totalEl.textContent = money(total);
}

export function showCheckoutMessage(message) {
    showMessage('[data-payment-message]', message, false);
    paymentMessage?.classList.remove('cc-hidden');
}

export function hideCheckoutMessage() {
    paymentMessage?.classList.add('cc-hidden');
    paymentMessage?.replaceChildren();
}

export async function revalidateCheckout() {
    context.validation_message = '';
    context.price_changes = [];
    hideCheckoutMessage();
    try {
        /* RNF-016: una sola peticion por ciclo. Antes se hacia GET /cart y
           acto seguido POST /cart/validate devolviendo al servidor los items
           que el mismo acababa de entregar; la validacion ya responde
           valid_items, invalid_items, price_changes y total. */
        const validateReq = await api.post('/cart/validate', {});
        const validation = validateReq.data;
        const invalidItems = Array.isArray(validation.invalid_items) ? validation.invalid_items : [];
        const priceChanges = Array.isArray(validation.price_changes) ? validation.price_changes : [];

        context.valid_items = validation.valid_items || [];
        if(!context.valid_items.length && !invalidItems.length) {
            context.valid = false;
            context.validation_message = 'El carrito no tiene productos para validar.';
            showCheckoutMessage(context.validation_message);
            return context;
        }
        context.price_changes = priceChanges;
        context.total = validation.total || 0;
        context.valid = (context.valid_items.length > 0 && invalidItems.length === 0 && priceChanges.length === 0 && context.direccion_id);

        if(invalidItems.length === 0 && context.valid_items.length > 0) {
            renderCheckoutSummary(context.valid_items, context.total);
        }

        if(invalidItems.length > 0 || priceChanges.length > 0) {
            context.validation_message = validationMessage(invalidItems, priceChanges);
            showCheckoutMessage(context.validation_message);
        }

        return context;
    } catch(err) {
        context.valid = false;
        context.validation_message = err.message || 'No fue posible validar el carrito.';
        showCheckoutMessage(context.validation_message);
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
    hideCheckoutMessage();
    /* En modo reintento el carrito no decide nada: el pedido ya existe y sus
       lineas estan congeladas. Validarlo aqui devolveria 400 por carrito
       vacio -la guarda de #66- y ese mensaje taparia el del reintento,
       dejando al comprador con un boton habilitado y un texto que le dice lo
       contrario. */
    if (context.estado_pendiente === 'reintento') {
        renderPedidoPendiente();
        return;
    }
    /* Cuando el estado del pedido no se pudo comprobar, el carrito tampoco es
       lo que hay que resolver: validarlo solo anadiria otro mensaje. */
    if (context.estado_pendiente === 'indeterminado') {
        renderPendienteSinVerificar();
        return;
    }
    try {
        /* RNF-016: igual que en revalidateCheckout, se elimina el GET /cart
           previo. El carrito vacio se distingue de "todo invalido" por no
           traer ni items validos ni invalidos. */
        const validateReq = await api.post('/cart/validate', {});
        const validation = validateReq.data;

        context.valid_items = validation.valid_items || [];
        context.price_changes = Array.isArray(validation.price_changes) ? validation.price_changes : [];
        context.total = validation.total || 0;

        const invalidItems = Array.isArray(validation.invalid_items) ? validation.invalid_items : [];
        const priceChanges = context.price_changes;
        if(!context.valid_items.length && !invalidItems.length) {
            renderEmptyCart();
            return;
        }
        if(context.valid_items.length === 0 || invalidItems.length > 0) {
            renderEmptyCart(true);
            if(invalidItems.length > 0 || priceChanges.length > 0) {
                showCheckoutMessage(validationMessage(invalidItems, priceChanges));
            }
            return;
        }

        renderCheckoutSummary(context.valid_items, context.total);
        if(priceChanges.length > 0) showCheckoutMessage(priceChangesMessage(priceChanges));

        updateSubmitState();
    } catch(err) {
        renderEmptyCart(true);
        showCheckoutMessage(err.message || 'No fue posible validar el carrito.');
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

/* `renderEmptyCart` pinta "Carrito no válido o vacío" y descubre el aviso
   rojo. Con un pedido pendiente el carrito esta vacio POR DISEÑO, de modo
   que ese texto contradecia al mensaje de reintento mostrado justo debajo.
   Estos dos resumenes describen el pedido, que es lo que esta en juego. */
function renderPedidoPendiente() {
    itemsContainer.innerHTML = `<div class="flex justify-between">
            <span>Pedido ${escapeHtml(String(context.pedido_pendiente))} pendiente de pago</span>
            <b>${escapeHtml(money(context.total_pendiente))}</b>
        </div>`;
    subtotalEl.textContent = money(context.total_pendiente);
    totalEl.textContent = money(context.total_pendiente);
    emptyCartMsg.classList.add('cc-hidden');
    context.valid_items = [];
    context.total = context.total_pendiente;
    updateSubmitState();
}

function renderPendienteSinVerificar() {
    itemsContainer.innerHTML = `<div class="flex justify-between">
            <span>Pedido ${escapeHtml(String(context.pendiente_sin_verificar))}: estado sin comprobar</span>
        </div>`;
    subtotalEl.textContent = money(0);
    totalEl.textContent = money(0);
    emptyCartMsg.classList.add('cc-hidden');
    context.valid_items = [];
    context.total = 0;
    updateSubmitState();
}

function updateSubmitState() {
    /* Con un pedido pendiente el carrito esta vacio por diseño, asi que no
       puede ser lo que decida si el boton se habilita.
       `context.valid` significa "se puede crear un pedido nuevo", y por eso
       es falso mientras el estado del anterior siga siendo desconocido. */
    const modo = context.estado_pendiente;
    context.reintento = modo === 'reintento';

    if(modo === 'reintento') {
        context.valid = true;
        if(submitBtn) submitBtn.disabled = false;
        showCheckoutMessage('Tienes el pedido ' + context.pedido_pendiente
            + ' pendiente de pago. Al continuar se reintentara ese pedido, no se creara uno nuevo.');
        return;
    }

    if(modo === 'indeterminado') {
        /* El boton sigue activo a proposito: es el unico control de la
           pantalla y pulsarlo vuelve a comprobar el pedido antes de hacer
           nada. Deshabilitarlo encerraria al comprador hasta recargar, con un
           pedido ya creado y un carrito que no puede reconstruirlo. */
        context.valid = false;
        if(submitBtn) submitBtn.disabled = false;
        showCheckoutMessage('No pudimos comprobar el estado de tu pedido '
            + context.pendiente_sin_verificar
            + '. No se creara ningun pedido nuevo hasta saberlo: vuelve a pulsar'
            + ' "Pagar ahora" para comprobarlo de nuevo.');
        return;
    }

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
    /* Antes de leer el carrito: con un pedido pendiente, el carrito vacio es
       lo esperado y no debe deshabilitar el boton. */
    await resuelvePedidoPendiente();
    await loadCart();
}

init();
