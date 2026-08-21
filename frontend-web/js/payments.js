import { api } from './api.js';
import { hideCheckoutMessage, revalidateCheckout, showCheckoutMessage } from './checkout.js';

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
            // 1. Revalidar
            const ctx = await revalidateCheckout();
            if (!ctx.valid || !ctx.direccion_id || ctx.valid_items.length === 0) {
                showCheckoutMessage(ctx.validation_message || 'El carrito o la dirección ya no son válidos. Revisa tu pedido.');
                return;
            }

            // 2. Crear pedido
            const orderPayload = {
                direccion_id: ctx.direccion_id,
                items: ctx.valid_items.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad }))
            };

            const orderRes = await api.post('/orders', orderPayload);
            const order = orderRes.data?.order;
            if (!order || !order.id) {
                throw new Error('No se pudo confirmar la creación del pedido.');
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
                // 4. Limpiar carrito
                try {
                    await api.delete('/cart');
                } catch (err) {
                    // Ignorar error de limpieza (Paso 41: no convierte pago aprobado en fallo)
                }

                const resultData = {
                    pedido_id: order.id,
                    estado: payment.estado,
                    mensaje: payment.mensaje,
                    envios_creados: payment.envios_creados
                };
                sessionStorage.setItem('cc_payment_result', JSON.stringify(resultData));
                window.location.href = 'pago-realizado.html';
            } else {
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
