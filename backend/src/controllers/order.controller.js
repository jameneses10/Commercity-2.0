const { validationResult }=require('express-validator'); const service=require('../services/order.service'); const {successResponse,errorResponse}=require('../utils/response');
function val(req,res){const e=validationResult(req); if(!e.isEmpty()){res.status(400).json(errorResponse('Datos de entrada inválidos.',e.array().map(x=>({field:x.path,message:x.msg})))); return true} return false}
async function create(req,res,next){try{if(val(req,res))return; const order=await service.createOrder(req.user,req.body); res.status(201).json(successResponse('Pedido pendiente creado correctamente.',{order}))}catch(e){next(e)}}
async function myOrders(req,res,next){try{res.json(successResponse('Pedidos del comprador obtenidos correctamente.',{orders:await service.myOrders(req.user)}))}catch(e){next(e)}}
async function getById(req,res,next){try{res.json(successResponse('Pedido obtenido correctamente.',{order:await service.getOrderForUser(req.params.id,req.user)}))}catch(e){next(e)}}
async function getComprobante(req,res,next){try{res.json(successResponse('Comprobante obtenido correctamente.',{comprobante:await service.getComprobanteForUser(req.params.id,req.user)}))}catch(e){next(e)}}
async function sellerOrders(req,res,next){try{res.json(successResponse('Pedidos del vendedor obtenidos correctamente.',{orders:await service.sellerOrders(req.user)}))}catch(e){next(e)}}
async function adminOrders(req,res,next){try{res.json(successResponse('Pedidos administrativos obtenidos correctamente.',{orders:await service.adminOrders()}))}catch(e){next(e)}}
module.exports={create,myOrders,getById,getComprobante,sellerOrders,adminOrders};
