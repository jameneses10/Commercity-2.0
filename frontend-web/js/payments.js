import { api } from './api.js';
import { hideCheckoutMessage, revalidateCheckout, showCheckoutMessage } from './checkout.js';

/* #82: pedido creado cuyo pago fue rechazado. El siguiente intento paga
   ESE pedido en vez de crear otro, porque desde #81 el carrito ya se
   consumio al crearlo y no hay nada con que reconstruirlo. */
const PEDIDO_PENDIENTE = 'cc_pedido_pendiente';

const paymentForm = document.querySelector('[data-payment-form]');
const submitBtn = document.querySelector('[data-payment-submit]');

let checkoutSubmitting = false;

if (paymentForm) {
    paymentForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (checkoutSubmitting) return;
        hideCheckoutMessage();

        const formData = new FormData(paymentForm);
        let cardNumber = formData.get('card_number')?.toString() || '';
        cardNumber = cardNumber.replace(/\s+/g, '');

        const cardHolder = formData.get('card_holder')?.toString().trim() || '';
        const expMonth = parseInt(formData.get('exp_month'), 10);
        const expYear = parseInt(formData.get('exp_year'), 10);
        const cvv = formData.get('cvv')?.toString().trim() || '';

        checkoutSubmitting = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="cc-spinner w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Procesando...';
        }

        try {
            // 1. Reintento: si un intento anterior dejo un pedido rechazado,
            //    se paga ESE pedido en vez de crear otro. Desde #81 el carrito
            //    se consume al crear el pedido, asi que revalidarlo aqui
            //    encontraria un carrito vacio y el reintento seria imposible.
            let order = null;
            const pedidoPendiente = Number(sessionStorage.getItem(PEDIDO_PENDIENTE) || 0);
            if (pedidoPendiente > 0) {
                order = { id: pedidoPendiente };
            } else {
                // 2. Primer intento: revalidar y crear el pedido
                const ctx = await revalidateCheckout();
                if (!ctx.valid || !ctx.direccion_id || ctx.valid_items.length === 0) {
                    showCheckoutMessage(ctx.validation_message || 'El carrito o la dirección ya no son válidos. Revisa tu pedido.');
                    return;
                }

                const orderPayload = {
                    direccion_id: ctx.direccion_id,
                    items: ctx.valid_items.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad }))
                };

                const orderRes = await api.post('/orders', orderPayload);
                order = orderRes.data?.order;
                if (!order || !order.id) {
                    throw new Error('No se pudo confirmar la creación del pedido.');
                }
            }

            // 3. Pagar (sandbox)
            const paymentPayload = {
                pedido_id: order.id,
                card_number: cardNumber,
                card_holder: cardHolder,
                exp_month: expMonth,
                exp_year: expYear,
                cvv: cvv
            };

            const paymentRes = await api.post('/payments/sandbox', paymentPayload);
            const payment = paymentRes.data?.payment;

            if (payment?.estado === 'aprobado') {
                // 4. El carrito NO se borra aqui. Desde #81 el servidor lo
                //    consume dentro de la misma transaccion que crea el
                //    pedido; borrarlo ahora eliminaria lo que el comprador
                //    haya anadido despues, desde otra pestana o dispositivo.
                sessionStorage.removeItem(PEDIDO_PENDIENTE);

                const resultData = {
                    pedido_id: order.id,
                    estado: payment.estado,
                    mensaje: payment.mensaje,
                    envios_creados: payment.envios_creados
                };
                sessionStorage.setItem('cc_payment_result', JSON.stringify(resultData));
                window.location.href = 'pago-realizado.html';
            } else {
                // El pedido queda en 'rechazado' y se puede reintentar sobre
                // el mismo id: se recuerda para el siguiente envio.
                sessionStorage.setItem(PEDIDO_PENDIENTE, String(order.id));
                showCheckoutMessage(payment?.mensaje || 'Pago rechazado.');
            }
        } catch (error) {
            showCheckoutMessage(error.message || 'Error al procesar la solicitud.');
        } finally {
            checkoutSubmitting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<img class="cc-icon w-5 h-5 filter brightness-0 invert" src="assets/icons/cc-security-payment-lock.svg" alt=""><span>Pagar ahora</span>';
            }
        }
    });
}
