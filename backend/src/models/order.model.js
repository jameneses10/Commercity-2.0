const { pool } = require('../config/database');
async function findById(id){ const [r]=await pool.query('SELECT * FROM pedidos WHERE id=? LIMIT 1',[id]); return r[0]||null; }
async function getDetails(id){ const [r]=await pool.query(`SELECT d.*, p.nombre producto_nombre, t.nombre tienda_nombre FROM pedido_detalles d INNER JOIN productos p ON p.id=d.producto_id INNER JOIN tiendas t ON t.id=d.tienda_id WHERE d.pedido_id=? ORDER BY d.id`,[id]); return r; }
async function createWithDetails(conn,{comprador_id,direccion_id,total,items}){ const [res]=await conn.query('INSERT INTO pedidos (comprador_id,direccion_id,total,estado_pago,estado_general) VALUES (?,?,?,\'pendiente\',\'creado\')',[comprador_id,direccion_id,total]); for(const it of items){ await conn.query('INSERT INTO pedido_detalles (pedido_id,producto_id,tienda_id,cantidad,precio_unitario,subtotal) VALUES (?,?,?,?,?,?)',[res.insertId,it.producto_id,it.tienda_id,it.cantidad,it.precio_unitario,it.subtotal]); } return res.insertId; }
async function listBuyer(userId){
 const [orders]=await pool.query('SELECT * FROM pedidos WHERE comprador_id=? ORDER BY created_at DESC',[userId]);
 if(!orders.length) return [];
 const [storeRows]=await pool.query(`SELECT DISTINCT d.pedido_id, t.id AS tienda_id, t.nombre AS tienda_nombre FROM pedido_detalles d INNER JOIN tiendas t ON t.id=d.tienda_id INNER JOIN pedidos p ON p.id=d.pedido_id WHERE p.comprador_id=? ORDER BY d.pedido_id, t.nombre, t.id`,[userId]);
 const storesByOrder=new Map();
 storeRows.forEach(row=>{
  const key=String(row.pedido_id);
  if(!storesByOrder.has(key)) storesByOrder.set(key,[]);
  storesByOrder.get(key).push({id:row.tienda_id,nombre:row.tienda_nombre});
 });
 return orders.map(order=>({...order,tiendas:storesByOrder.get(String(order.id)) || []}));
}
function nextCalendarDay(fecha){ const [y,m,d]=fecha.split('-').map(Number); return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10); }
async function listAll(filters={}){
  const { tienda_id, comprador_id, vendedor_id, estado_pago, estado_envio, fecha } = filters;
  const where=[]; const params=[];
  if (comprador_id!==undefined) { where.push('p.comprador_id = ?'); params.push(comprador_id); }
  if (estado_pago!==undefined) { where.push('p.estado_pago = ?'); params.push(estado_pago); }
  if (fecha!==undefined) { where.push('p.created_at >= ? AND p.created_at < ?'); params.push(`${fecha} 00:00:00`, `${nextCalendarDay(fecha)} 00:00:00`); }
  if (tienda_id!==undefined || vendedor_id!==undefined || estado_envio!==undefined) {
    const sub=['d.pedido_id = p.id'];
    if (tienda_id!==undefined) { sub.push('d.tienda_id = ?'); params.push(tienda_id); }
    if (vendedor_id!==undefined) { sub.push('t.usuario_id = ?'); params.push(vendedor_id); }
    if (estado_envio!==undefined) { sub.push('e.estado = ?'); params.push(estado_envio); }
    where.push(`EXISTS (SELECT 1 FROM pedido_detalles d INNER JOIN tiendas t ON t.id = d.tienda_id LEFT JOIN envios e ON e.pedido_id = d.pedido_id AND e.tienda_id = d.tienda_id WHERE ${sub.join(' AND ')})`);
  }
  const [orders] = await pool.query(
    `SELECT p.*, u.nombre AS comprador_nombre,
            (SELECT GROUP_CONCAT(DISTINCT t2.nombre ORDER BY t2.nombre SEPARATOR ', ') FROM pedido_detalles d2 INNER JOIN tiendas t2 ON t2.id = d2.tienda_id WHERE d2.pedido_id = p.id) AS tiendas_nombres,
            (SELECT GROUP_CONCAT(DISTINCT v2.nombre ORDER BY v2.nombre SEPARATOR ', ') FROM pedido_detalles d2 INNER JOIN tiendas t2 ON t2.id = d2.tienda_id INNER JOIN usuarios v2 ON v2.id = t2.usuario_id WHERE d2.pedido_id = p.id) AS vendedores_nombres,
            (SELECT GROUP_CONCAT(DISTINCT e2.estado ORDER BY e2.estado SEPARATOR ', ') FROM envios e2 WHERE e2.pedido_id = p.id) AS estados_envio
       FROM pedidos p
       INNER JOIN usuarios u ON u.id = p.comprador_id
      ${where.length ? 'WHERE '+where.join(' AND ') : ''}
      ORDER BY p.created_at DESC`, params
  );
  return orders;
}
async function sellerParticipates(orderId,sellerId){ const [[r]]=await pool.query(`SELECT COUNT(*) total FROM pedido_detalles d INNER JOIN tiendas t ON t.id=d.tienda_id WHERE d.pedido_id=? AND t.usuario_id=?`,[orderId,sellerId]); return r.total>0; }
async function listSeller(sellerId){ const [r]=await pool.query(`SELECT DISTINCT p.* FROM pedidos p INNER JOIN pedido_detalles d ON d.pedido_id=p.id INNER JOIN tiendas t ON t.id=d.tienda_id WHERE t.usuario_id=? ORDER BY p.created_at DESC`,[sellerId]); return r; }
async function lockOrder(conn,id){ const [r]=await conn.query('SELECT * FROM pedidos WHERE id=? FOR UPDATE',[id]); return r[0]||null; }
async function getDetailsConn(conn,id){ const [r]=await conn.query('SELECT * FROM pedido_detalles WHERE pedido_id=?',[id]); return r; }
async function updateStatus(conn,id,{estado_pago,estado_general}){ await conn.query('UPDATE pedidos SET estado_pago=?, estado_general=? WHERE id=?',[estado_pago,estado_general,id]); }
module.exports={pool,findById,getDetails,createWithDetails,listBuyer,listAll,sellerParticipates,listSeller,lockOrder,getDetailsConn,updateStatus};
