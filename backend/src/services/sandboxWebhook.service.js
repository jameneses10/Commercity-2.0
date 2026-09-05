function executePaymentApprovedWebhook({pedido_id,pago_id,estado}){ return {executed:true,event:'payment.approved',pedido_id,pago_id,estado}; }
module.exports={executePaymentApprovedWebhook};
