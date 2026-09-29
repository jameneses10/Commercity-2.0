const {validationResult}=require('express-validator');
const service=require('../services/contentReport.service');
const {successResponse,errorResponse}=require('../utils/response');
function val(req,res){const e=validationResult(req); if(!e.isEmpty()){res.status(400).json(errorResponse('Datos de entrada inválidos.',e.array().map(x=>({field:x.path,message:x.msg})))); return true;} return false;}
function createFor(type){ return async function(req,res,next){ try{ if(val(req,res))return; const report=await service.createReport(type,req.user,req.params.id,req.body,req.ip); res.status(201).json(successResponse('Reporte creado correctamente.',{report})); }catch(e){ next(e); } }; }
function listFor(type){ return async function(req,res,next){ try{ res.json(successResponse('Reportes obtenidos correctamente.',await service.listAdmin(type,req.query))); }catch(e){ next(e); } }; }
function resolveFor(type){ return async function(req,res,next){ try{ if(val(req,res))return; res.json(successResponse('Reporte actualizado correctamente.',await service.resolve(type,req.user,req.params.id,req.body,req.ip))); }catch(e){ next(e); } }; }
module.exports={createFor,listFor,resolveFor};
