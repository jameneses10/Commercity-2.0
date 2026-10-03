const express=require('express'); const c=require('../controllers/productReport.controller'); const authRequired=require('../middlewares/authRequired'); const requireRole=require('../middlewares/requireRole'); const {createReportValidator,updateReportValidator}=require('../validators/productReport.validators');
/* RNF-004: RF-277 permite reportar productos a los COMPRADORES. RF-278 abre a
   "los usuarios" el reporte de vendedores, compradores y mensajes, pero no el
   de productos, y esas rutas se dejan agnosticas a proposito. */
const productReportRouter=express.Router(); productReportRouter.post('/:id/report',authRequired,requireRole('comprador'),createReportValidator,c.report);
const adminProductReportRouter=express.Router(); adminProductReportRouter.get('/reports/products',authRequired,requireRole('administrador'),c.listAdmin); adminProductReportRouter.patch('/reports/products/:id',authRequired,requireRole('administrador'),updateReportValidator,c.updateAdmin);
module.exports={productReportRouter,adminProductReportRouter};
