const { pool }=require('../config/database');
const contentReportModel=require('../models/contentReport.model');
const model=require('../models/chat.model');
const notification=require('./notification.service');
const logService=require('./log.service');
const { resolveStoredFile }=require('../middlewares/upload.middleware');
function err(m,s){const e=new Error(m);e.statusCode=s;return e;}
function participates(c,userId){ return c && (Number(c.comprador_id)===Number(userId)||Number(c.vendedor_id)===Number(userId)); }
/* RF-288: estado de conexion de la CONTRAPARTE, relativo a quien consulta. El
   servidor solo publica un booleano: la marca de actividad del otro usuario no
   sale nunca del servidor. Solo lo ve un participante, porque estas rutas ya
   validan la participacion. */
function withPresence(c,userId){
 if(!c) return c;
 const soyComprador=Number(c.comprador_id)===Number(userId);
 const bruto=soyComprador?c.vendedor_en_linea:c.comprador_en_linea;
 return {...c, comprador_en_linea:Boolean(Number(c.comprador_en_linea)), vendedor_en_linea:Boolean(Number(c.vendedor_en_linea)), contraparte_id:soyComprador?c.vendedor_id:c.comprador_id, contraparte_nombre:soyComprador?c.vendedor_nombre:c.comprador_nombre, contraparte_en_linea:Boolean(Number(bruto))};
}
async function resolveConversationPayload(user,payload){ let comprador_id=payload.comprador_id||null, vendedor_id=payload.vendedor_id||null, tienda_id=payload.tienda_id||null, producto_id=payload.producto_id||null; if(producto_id){ const p=await model.findProduct(producto_id); if(!p) throw err('Producto no encontrado.',404); tienda_id=tienda_id||p.tienda_id; vendedor_id=vendedor_id||p.vendedor_id; } if(tienda_id && !vendedor_id){ const s=await model.findStore(tienda_id); if(!s) throw err('Tienda no encontrada.',404); vendedor_id=s.usuario_id; } if(user.rol==='comprador'){ comprador_id=user.id; if(!vendedor_id) throw err('Debe indicar vendedor, tienda o producto.',400); } else if(user.rol==='vendedor'){ vendedor_id=user.id; if(!comprador_id) throw err('El vendedor debe indicar comprador_id para iniciar conversación.',400); } else { throw err('Rol no autorizado para usar el chat.',403); } if(Number(comprador_id)===Number(vendedor_id)) throw err('No se puede crear conversación con el mismo usuario.',400); const comprador=await model.findUser(comprador_id); const vendedor=await model.findUser(vendedor_id); if(!comprador||!vendedor) throw err('Participante inactivo o no encontrado.',404); return {comprador_id,vendedor_id,tienda_id,producto_id}; }
async function createConversation(user,payload){ const data=await resolveConversationPayload(user,payload); const existing=await model.findExisting(data); if(existing) return await model.findConversation(existing.id); return model.createConversation(data); }
async function list(user){ const rows=await model.listForUser(user.id); return rows.map(row=>withPresence(row,user.id)); }
async function messages(user,id,query){ const c=await model.findConversation(id); if(!participates(c,user.id)) throw err('Conversación no encontrada o sin permisos.',404); const limit=Math.min(Math.max(parseInt(query.limit||'50',10),1),100); const page=Math.max(parseInt(query.page||'1',10),1); return {conversation:withPresence(c,user.id),messages:await model.messages(id,{limit,offset:(page-1)*limit}),pagination:{page,limit}}; }
async function sendMessage(user,id,payload,archivos=[],ip){ const c=await model.findConversation(id); if(!participates(c,user.id)) throw err('Conversación no encontrada o sin permisos.',404); const receptor_id=Number(c.comprador_id)===Number(user.id)?c.vendedor_id:c.comprador_id; const receptor=await model.findUser(receptor_id); if(!receptor) throw err('Receptor inactivo o no encontrado.',403); const contenido=String(payload.contenido ?? payload.mensaje ?? '').trim(); if(!contenido && !archivos.length) throw err('El mensaje debe incluir texto o archivo adjunto.',400); if(contenido.length>1000) throw err('El mensaje no puede superar 1000 caracteres.',400); const tipo=contenido&&archivos.length?'mixto':archivos.length?'archivo':'texto'; const conn=await model.pool.getConnection(); try{ await conn.beginTransaction(); const mid=await model.addMessage(conn,{conversacion_id:id,emisor_id:user.id,contenido,tipo,archivos}); await notification.create(conn,receptor_id,{tipo:'nuevo_mensaje',titulo:'Nuevo mensaje',mensaje:'Tienes un nuevo mensaje interno.',entidad_tipo:'conversaciones',entidad_id:id,url_destino:`/pages/conversation.html?id=${id}`}); await logService.log(conn,{usuario_id:user.id,accion:'mensaje_chat_enviado',entidad:'conversaciones',entidad_id:id,detalle:{mensaje_id:mid,tipo,archivos:archivos.length},ip}); await conn.commit(); return model.findRenderableMessage(mid); }catch(e){ await conn.rollback(); throw e; } finally{ conn.release(); } }
async function markRead(user,id){ const c=await model.findConversation(id); if(!participates(c,user.id)) throw err('Conversación no encontrada o sin permisos.',404); return {updated:await model.markRead(id,user.id)}; }
async function notifyAdminsMessageReport(messageId,conversacionId){ const [admins]=await pool.query(`SELECT u.id FROM usuarios u INNER JOIN roles r ON r.id=u.rol_id WHERE r.nombre='administrador' AND u.estado='activo'`); for(const a of admins){ await notification.create(pool,a.id,{tipo:'nuevo_reporte_mensaje',titulo:'Nuevo reporte de mensaje',mensaje:'Un mensaje de chat fue reportado.',entidad_tipo:'mensajes',entidad_id:messageId,url_destino:'/pages/admin-reportes.html'}); } return admins.length; }
async function reportMessage(user,id,ip){ const m=await model.findMessage(id); if(!m || !participates(m,user.id)) throw err('Mensaje no encontrado o sin permisos.',404); const updated=await model.reportMessage(id); if(!await contentReportModel.findOpenDuplicate('messages',id,user.id)) await contentReportModel.create('messages',{targetId:id,reporterId:user.id,motivo:null,descripcion:null}); await notifyAdminsMessageReport(id,m.conversacion_id); await logService.log(null,{usuario_id:user.id,accion:'mensaje_chat_reportado',entidad:'mensajes',entidad_id:id,detalle:{conversacion_id:m.conversacion_id},ip}); return updated; }
async function deleteMessage(user,id,ip){ const m=await model.findMessage(id); if(!m || !participates(m,user.id)) throw err('Mensaje no encontrado o sin permisos.',404); if(Number(m.emisor_id)!==Number(user.id) && user.rol!=='administrador') throw err('Solo el emisor o administrador puede eliminar el mensaje.',403); const updated=await model.deleteMessage(id); await logService.log(null,{usuario_id:user.id,accion:'mensaje_chat_eliminado',entidad:'mensajes',entidad_id:id,detalle:{conversacion_id:m.conversacion_id},ip}); return updated; }
/* RNF-006: la autorizacion es por RECURSO, no solo por sesion. Exigir unicamente
   authRequired seguiria siendo IDOR, porque el nombre del fichero era la unica
   credencial: cualquier autenticado que lo conociera podia descargarlo.
   Aqui se resuelve adjunto -> mensaje -> conversacion y solo pasan sus dos
   participantes. Se devuelve 404 en todos los casos negativos para no revelar
   si el adjunto existe.
   RF-293: un mensaje eliminado conserva el fichero fisico como evidencia
   interna, pero el participante ya no puede recuperarlo. */
async function attachment(user,attachmentId){
 const id=Number(attachmentId);
 const noEncontrado=err('Archivo no encontrado.',404);
 if(!Number.isInteger(id) || id<1) throw noEncontrado;
 const a=await model.findAttachmentWithContext(id);
 if(!a) throw noEncontrado;
 if(!participates(a,user.id)) throw noEncontrado;
 if(a.eliminado===true || Number(a.eliminado)===1) throw noEncontrado;
 const ruta=resolveStoredFile('chat',a.url_archivo);
 if(!ruta) throw noEncontrado;
 return {ruta, nombre:a.nombre_original||'adjunto', mime:a.mime_type||'application/octet-stream'};
}
module.exports={createConversation,list,messages,sendMessage,markRead,reportMessage,deleteMessage,attachment};
