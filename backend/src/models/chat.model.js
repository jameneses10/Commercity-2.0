const { pool } = require('../config/database');
const { PRESENCE_WINDOW_MINUTES } = require('../config/presence');
// RF-288: el estado en linea se evalua con NOW() de la base de datos, nunca con
// el reloj del cliente ni del proceso de Node.
const PRESENCE_EXPR = (alias) => `(${alias}.ultima_actividad_at IS NOT NULL AND ${alias}.ultima_actividad_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE))`;
async function findUser(id){ const [[u]]=await pool.query("SELECT u.id,u.nombre,u.estado,r.nombre rol FROM usuarios u INNER JOIN roles r ON r.id=u.rol_id WHERE u.id=? AND u.estado='activo' AND u.deleted_at IS NULL",[id]); return u||null; }
async function findStore(id){ const [[s]]=await pool.query('SELECT id,usuario_id,nombre,estado FROM tiendas WHERE id=? LIMIT 1',[id]); return s||null; }
async function findProduct(id){ const [[p]]=await pool.query('SELECT p.id,p.tienda_id,p.nombre,t.usuario_id vendedor_id FROM productos p INNER JOIN tiendas t ON t.id=p.tienda_id WHERE p.id=? LIMIT 1',[id]); return p||null; }
async function findConversation(id){ const [[r]]=await pool.query(`SELECT c.*, uc.nombre comprador_nombre, uv.nombre vendedor_nombre, ${PRESENCE_EXPR('uc')} comprador_en_linea, ${PRESENCE_EXPR('uv')} vendedor_en_linea, t.nombre tienda_nombre, p.nombre producto_nombre FROM conversaciones c INNER JOIN usuarios uc ON uc.id=c.comprador_id INNER JOIN usuarios uv ON uv.id=c.vendedor_id LEFT JOIN tiendas t ON t.id=c.tienda_id LEFT JOIN productos p ON p.id=c.producto_id WHERE c.id=?`,[PRESENCE_WINDOW_MINUTES,PRESENCE_WINDOW_MINUTES,id]); return r||null; }
async function findExisting({comprador_id,vendedor_id,tienda_id=null,producto_id=null}){ const [rows]=await pool.query(`SELECT * FROM conversaciones WHERE comprador_id=? AND vendedor_id=? AND ((tienda_id <=> ?) AND (producto_id <=> ?)) LIMIT 1`,[comprador_id,vendedor_id,tienda_id,producto_id]); return rows[0]||null; }
async function createConversation(data,conn=pool){ const [r]=await conn.query('INSERT INTO conversaciones (comprador_id,vendedor_id,tienda_id,producto_id) VALUES (?,?,?,?)',[data.comprador_id,data.vendedor_id,data.tienda_id||null,data.producto_id||null]); return findConversation(r.insertId); }
async function listForUser(userId){ const [rows]=await pool.query(`SELECT c.*, uc.nombre comprador_nombre, uv.nombre vendedor_nombre, ${PRESENCE_EXPR('uc')} comprador_en_linea, ${PRESENCE_EXPR('uv')} vendedor_en_linea, t.nombre tienda_nombre, p.nombre producto_nombre, (SELECT COALESCE(m.contenido,'[archivo]') FROM mensajes m WHERE m.conversacion_id=c.id AND m.eliminado=FALSE ORDER BY m.creado_en DESC LIMIT 1) ultimo_mensaje, 0 no_leidos FROM conversaciones c INNER JOIN usuarios uc ON uc.id=c.comprador_id INNER JOIN usuarios uv ON uv.id=c.vendedor_id LEFT JOIN tiendas t ON t.id=c.tienda_id LEFT JOIN productos p ON p.id=c.producto_id WHERE c.comprador_id=? OR c.vendedor_id=? ORDER BY COALESCE(c.ultimo_mensaje_at,c.updated_at,c.created_at) DESC`,[PRESENCE_WINDOW_MINUTES,PRESENCE_WINDOW_MINUTES,userId,userId]); return rows; }
// RF-291: una sola definicion del shape renderizable de un mensaje, compartida
// por la lista y por la consulta exacta, para que no puedan divergir.
const MESSAGE_SELECT=`SELECT m.id,m.conversacion_id,m.emisor_id,CASE WHEN m.eliminado THEN NULL ELSE m.contenido END mensaje,CASE WHEN m.eliminado THEN NULL ELSE m.contenido END contenido,m.tipo,m.eliminado,m.reportado,m.creado_en AS created_at,m.creado_en,ue.nombre emisor_nombre FROM mensajes m INNER JOIN usuarios ue ON ue.id=m.emisor_id`;
async function filesForMessageIds(ids){ if(!ids.length) return new Map(); const [files]=await pool.query('SELECT id,mensaje_id,url_archivo,nombre_original,mime_type,size_bytes,creado_en FROM mensaje_archivos WHERE mensaje_id IN (?) ORDER BY id ASC',[ids]); const map=new Map(ids.map(id=>[Number(id),[]])); files.forEach(f=>map.get(Number(f.mensaje_id))?.push(f)); return map; }
async function messages(conversacion_id,{limit=50,offset=0}){ const [rows]=await pool.query(`${MESSAGE_SELECT} WHERE m.conversacion_id=? ORDER BY m.creado_en ASC LIMIT ? OFFSET ?`,[conversacion_id,limit,offset]); const map=await filesForMessageIds(rows.map(r=>r.id)); return rows.map(r=>({...r,archivos:map.get(Number(r.id))||[]})); }
/* RF-291 CORRECCION: recupera UN mensaje por su id con el mismo shape
   renderizable que devuelve messages(), incluidos sus archivos. Antes el
   servicio paginaba los 100 primeros por creado_en ASC para localizar el que
   acababa de insertar, de modo que en una conversacion con mas de 100 mensajes
   el recien creado quedaba fuera de la ventana. No se altera la paginacion. */
async function findRenderableMessage(id){
 const [[row]]=await pool.query(`${MESSAGE_SELECT} WHERE m.id=? LIMIT 1`,[id]);
 if(!row) return null;
 const map=await filesForMessageIds([row.id]);
 return {...row, archivos:map.get(Number(row.id))||[]};
}
async function addMessage(conn,{conversacion_id,emisor_id,contenido,tipo,archivos=[]}){ const [r]=await conn.query('INSERT INTO mensajes (conversacion_id,emisor_id,contenido,tipo) VALUES (?,?,?,?)',[conversacion_id,emisor_id,contenido||null,tipo]); const id=r.insertId; for(const f of archivos){ await conn.query('INSERT INTO mensaje_archivos (mensaje_id,url_archivo,nombre_original,mime_type,size_bytes) VALUES (?,?,?,?,?)',[id,f.url,f.nombre_original,f.mime_type,f.size_bytes]); } await conn.query('UPDATE conversaciones SET ultimo_mensaje_at=NOW() WHERE id=?',[conversacion_id]); return id; }
async function markRead(conversacion_id,userId){ const [r]=await pool.query('UPDATE mensajes_chat SET leido=TRUE, leido_at=NOW() WHERE conversacion_id=? AND receptor_id=? AND leido=FALSE',[conversacion_id,userId]); return r.affectedRows; }
async function findMessage(id){ const [[m]]=await pool.query('SELECT m.*, c.comprador_id,c.vendedor_id FROM mensajes m INNER JOIN conversaciones c ON c.id=m.conversacion_id WHERE m.id=?',[id]); return m||null; }
async function reportMessage(id){ await pool.query('UPDATE mensajes SET reportado=TRUE WHERE id=?',[id]); return findMessage(id); }
async function deleteMessage(id){ await pool.query('UPDATE mensajes SET eliminado=TRUE, contenido=NULL WHERE id=?',[id]); return findMessage(id); }
module.exports={pool,findUser,findStore,findProduct,findConversation,findExisting,createConversation,listForUser,messages,addMessage,markRead,findMessage,reportMessage,deleteMessage,findRenderableMessage};
