const { validationResult }=require('express-validator'); const service=require('../services/payment.service'); const {successResponse,errorResponse}=require('../utils/response');
function val(req,res){const e=validationResult(req); if(!e.isEmpty()){res.status(400).json(errorResponse('Datos de entrada inválidos.',e.array().map(x=>({field:x.path,message:x.msg})))); return true} return false}
async function sandbox(req,res,next){try{if(val(req,res))return; const payment=await service.processPayment(req.user,req.body); res.json(successResponse('Pago sandbox procesado correctamente.',{payment}))}catch(e){next(e)}}
async function webhook(req,res,next){try{if(val(req,res))return; const payment=await service.webhookAdmin(req.user,req.body); res.json(successResponse('Webhook simulado procesado correctamente.',{payment}))}catch(e){next(e)}}
module.exports={sandbox,webhook};
