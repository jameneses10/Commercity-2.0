const { pool } = require('../config/database');
function safeDetail(d){ return d?JSON.stringify(d).slice(0,2000):null; }
async function create(conn,{usuario_id=null,accion,entidad,entidad_id=null,detalle=null,ip=null}){ const db=conn||pool; await db.query('INSERT INTO logs_acciones (usuario_id,accion,entidad,entidad_id,detalle,ip) VALUES (?,?,?,?,?,?)',[usuario_id,accion,entidad,entidad_id,safeDetail(detalle),ip]); }
function logDay(fecha){ const [y,mo,d]=String(fecha).split('-').map(Number); const next=new Date(Date.UTC(y,mo-1,d+1)).toISOString().slice(0,10); return [`${fecha} 00:00:00`, `${next} 00:00:00`]; }
// RF-284: consulta por fecha, usuario, accion y entidad afectada. Todos los valores
// van como parametros ligados; solo se concatenan fragmentos de predicado fijos.
async function list({limit,offset,fecha,usuario_id,accion,entidad,entidad_id}={}){
 const where=[]; const params=[];
 if(fecha!==undefined){ const [from,to]=logDay(fecha); where.push('l.created_at >= ? AND l.created_at < ?'); params.push(from,to); }
 if(usuario_id!==undefined){ where.push('l.usuario_id = ?'); params.push(usuario_id); }
 if(accion!==undefined){ where.push('l.accion = ?'); params.push(accion); }
 if(entidad!==undefined){ where.push('l.entidad = ?'); params.push(entidad); }
 if(entidad_id!==undefined){ where.push('l.entidad_id = ?'); params.push(entidad_id); }
 params.push(limit,offset);
 const [r]=await pool.query(`SELECT l.*, u.nombre AS usuario_nombre, u.correo AS usuario_correo FROM logs_acciones l LEFT JOIN usuarios u ON u.id = l.usuario_id ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,params);
 return r;
}
module.exports={create,list};
