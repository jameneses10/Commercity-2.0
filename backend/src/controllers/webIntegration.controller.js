const service = require('../services/webIntegration.service');
const { successResponse } = require('../utils/response');
async function sellerProducts(req,res,next){try{res.json(successResponse('Productos del vendedor obtenidos correctamente.',await service.sellerProducts(req.user)));}catch(e){next(e)}}
async function sellerReviews(req,res,next){try{res.json(successResponse('Reseñas del vendedor obtenidas correctamente.',await service.sellerReviews(req.user)));}catch(e){next(e)}}
async function sellerReputation(req,res,next){try{res.json(successResponse('Reputación del vendedor obtenida correctamente.',await service.sellerReputation(req.user)));}catch(e){next(e)}}
async function sellerCommissions(req,res,next){try{res.json(successResponse('Comisiones del vendedor obtenidas correctamente.',await service.sellerCommissions(req.user)));}catch(e){next(e)}}
async function adminStores(req,res,next){try{res.json(successResponse('Tiendas administrativas obtenidas correctamente.',await service.adminStores(req.query)));}catch(e){next(e)}}
async function adminPayments(req,res,next){try{res.json(successResponse('Pagos administrativos obtenidos correctamente.',await service.adminPayments(req.query)));}catch(e){next(e)}}
async function adminShipments(req,res,next){try{res.json(successResponse('Envíos administrativos obtenidos correctamente.',await service.adminShipments(req.query)));}catch(e){next(e)}}
async function adminReviews(req,res,next){try{res.json(successResponse('Reseñas administrativas obtenidas correctamente.',await service.adminReviews(req.query)));}catch(e){next(e)}}
async function adminCommissions(req,res,next){try{res.json(successResponse('Comisiones administrativas obtenidas correctamente.',await service.adminCommissions(req.query)));}catch(e){next(e)}}
async function updateCommissionStatus(req,res,next){try{res.json(successResponse('Estado de comisión actualizado correctamente.',{commission:await service.updateCommissionStatus(req.user,req.params.id,req.body,req.ip)}));}catch(e){next(e)}}
async function adminCommissionSettings(req,res,next){try{res.json(successResponse('Configuración de comisión obtenida correctamente.',{settings:await service.adminCommissionSettings()}));}catch(e){next(e)}}
async function updateAdminCommissionSettings(req,res,next){try{res.json(successResponse('Configuración de comisión actualizada correctamente.',{settings:await service.updateAdminCommissionSettings(req.user,req.body,req.ip)}));}catch(e){next(e)}}
module.exports={sellerProducts,sellerReviews,sellerReputation,sellerCommissions,adminStores,adminPayments,adminShipments,adminReviews,adminCommissions,updateCommissionStatus,adminCommissionSettings,updateAdminCommissionSettings};
