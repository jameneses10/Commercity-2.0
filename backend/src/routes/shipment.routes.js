const express=require('express'); const c=require('../controllers/shipment.controller'); const authRequired=require('../middlewares/authRequired'); const requireRole=require('../middlewares/requireRole'); const {dispatchValidator,statusValidator}=require('../validators/shipment.validators');
const shipmentRouter=express.Router(); shipmentRouter.get('/my-shipments',authRequired,requireRole('comprador'),c.my); shipmentRouter.patch('/:id/dispatch',authRequired,requireRole('vendedor'),dispatchValidator,c.dispatch); shipmentRouter.patch('/:id/status',authRequired,requireRole('vendedor'),statusValidator,c.status);
/* RNF-004: esta ruta admitia tambien 'administrador', pero RF-191 a RF-196
   asignan los cambios de estado del envio al VENDEDOR -- en preparacion, en
   camino, entregado -- y RF-199 le impone que sean de su propia tienda. Ningun
   RF concede esa capacidad al administrador: el bloque administrativo le da
   consultar pedidos por estado de envio (RF-259), no modificarlos. RF-019 y
   RF-020 obligan a bloquear la funcion no autorizada con 403.
   En este mismo router, /:id/dispatch ya era requireRole('vendedor') a secas. */
const sellerShipmentRouter=express.Router(); sellerShipmentRouter.get('/shipments',authRequired,requireRole('vendedor'),c.seller);
module.exports={shipmentRouter,sellerShipmentRouter};
