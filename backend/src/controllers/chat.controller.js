const {validationResult}=require('express-validator'); const service=require('../services/chat.service'); const {successResponse,errorResponse}=require('../utils/response'); const { mapFile, cleanupFiles } = require('../middlewares/upload.middleware');
function val(req,res){const e=validationResult(req); if(!e.isEmpty()){res.status(400).json(errorResponse('Datos de entrada inválidos.',e.array().map(x=>({field:x.path,message:x.msg})))); return true;} return false;}
function chatFiles(req){ return (req.files||[]).map(f=>mapFile(f,'chat')).filter(Boolean); }
async function list(req,res,next){try{res.json(successResponse('Conversaciones obtenidas correctamente.',{conversations:await service.list(req.user)}))}catch(e){next(e)}}
async function create(req,res,next){try{if(val(req,res))return; res.status(201).json(successResponse('Conversación creada u obtenida correctamente.',{conversation:await service.createConversation(req.user,req.body)}))}catch(e){next(e)}}
async function messages(req,res,next){try{res.json(successResponse('Mensajes obtenidos correctamente.',await service.messages(req.user,req.params.id,req.query)))}catch(e){next(e)}}
/* RF-291 CORRECCION: Multer ya escribio los archivos en disco antes de que el
   servicio pueda rechazar la peticion (conversacion inexistente, usuario no
   participante, receptor no disponible o transaccion fallida). En ese caso se
   borran los archivos de ESTA peticion; el borrado es best-effort y el error
   original se propaga intacto. Tras un envio correcto no se borra nada. */
async function send(req,res,next){
 try{
  if(val(req,res)){ cleanupFiles(req.files); return; }
  const message=await service.sendMessage(req.user,req.params.id,req.body,chatFiles(req),req.ip);
  res.status(201).json(successResponse('Mensaje enviado correctamente.',{message}));
 }catch(e){
  try{ cleanupFiles(req.files); }catch(cleanupError){ /* nunca oculta el error original */ }
  next(e);
 }
}
async function read(req,res,next){try{res.json(successResponse('Conversación marcada como leída.',await service.markRead(req.user,req.params.id)))}catch(e){next(e)}}
async function report(req,res,next){try{res.json(successResponse('Mensaje reportado correctamente.',{message:await service.reportMessage(req.user,req.params.id,req.ip)}))}catch(e){next(e)}}
async function remove(req,res,next){try{res.json(successResponse('Mensaje eliminado correctamente.',{message:await service.deleteMessage(req.user,req.params.id,req.ip)}))}catch(e){next(e)}}
module.exports={list,create,messages,send,read,report,remove};
