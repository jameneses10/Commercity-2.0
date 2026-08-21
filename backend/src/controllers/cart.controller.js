const { validationResult }=require('express-validator'); const service=require('../services/cart.service'); const {successResponse,errorResponse}=require('../utils/response');
function val(req,res){const e=validationResult(req); if(!e.isEmpty()){res.status(400).json(errorResponse('Datos de entrada inválidos.',e.array().map(x=>({field:x.path,message:x.msg})))); return true} return false}
async function validate(req,res,next){try{if(val(req,res))return; const result=await service.validateCart(req.user,req.body.items); res.json(successResponse('Carrito validado correctamente.',result));}catch(e){next(e)}}
async function get(req,res,next){try{res.json(successResponse('Carrito obtenido correctamente.',await service.getCart(req.user)));}catch(e){next(e)}}
async function addItem(req,res,next){try{res.status(201).json(successResponse('Producto agregado al carrito correctamente.',await service.addItem(req.user,req.body)));}catch(e){next(e)}}
async function updateItem(req,res,next){try{res.json(successResponse('Item de carrito actualizado correctamente.',await service.updateItem(req.user,req.params.id,req.body)));}catch(e){next(e)}}
async function deleteItem(req,res,next){try{res.json(successResponse('Item de carrito eliminado correctamente.',await service.deleteItem(req.user,req.params.id)));}catch(e){next(e)}}
async function clear(req,res,next){try{res.json(successResponse('Carrito vaciado correctamente.',await service.clearCart(req.user)));}catch(e){next(e)}}
module.exports={validate,get,addItem,updateItem,deleteItem,clear};
