const { pool } = require('../config/database');
async function orderForBuyer(orderId, buyerId, conn = pool) { const [r] = await conn.query('SELECT * FROM pedidos WHERE id=? AND comprador_id=? LIMIT 1 FOR UPDATE', [orderId, buyerId]); return r[0] || null; }
async function detailsForOrder(orderId, detailIds, conn = pool) {
  const ids = detailIds.map(Number);
  if (!ids.length) return [];
  const [r] = await conn.query(`SELECT d.*, p.nombre producto_nombre, t.nombre tienda_nombre, t.usuario_id vendedor_id
    FROM pedido_detalles d INNER JOIN productos p ON p.id=d.producto_id INNER JOIN tiendas t ON t.id=d.tienda_id
    WHERE d.pedido_id=? AND d.id IN (?)`, [orderId, ids]);
  return r;
}
async function deliveredStoreIds(orderId, conn = pool) { const [r] = await conn.query("SELECT tienda_id FROM envios WHERE pedido_id=? AND estado='entregado'", [orderId]); return new Set(r.map(x => Number(x.tienda_id))); }
async function hasActiveDuplicate(orderId, detailIds, conn = pool) {
  if (!detailIds.length) return false;
  const [[r]] = await conn.query(`SELECT COUNT(*) total FROM devoluciones d INNER JOIN devolucion_items i ON i.devolucion_id=d.id
    WHERE d.pedido_id=? AND i.pedido_detalle_id IN (?) AND d.estado IN ('solicitada','en_revision','aprobada','producto_recibido','reembolso_simulado')`, [orderId, detailIds]);
  return Number(r.total || 0) > 0;
}
async function createReturn(conn, data) {
  const [r] = await conn.query(`INSERT INTO devoluciones (numero_solicitud,pedido_id,comprador_id,tienda_id,estado,motivo,descripcion,monto_estimado)
    VALUES (?,?,?,?, 'solicitada', ?, ?, ?)`, [data.numero_solicitud, data.pedido_id, data.comprador_id, data.tienda_id, data.motivo, data.descripcion || null, data.monto_estimado]);
  return r.insertId;
}
async function addItem(conn, devolucionId, it) { await conn.query(`INSERT INTO devolucion_items (devolucion_id,pedido_detalle_id,producto_id,cantidad,precio_unitario,subtotal) VALUES (?,?,?,?,?,?)`, [devolucionId, it.pedido_detalle_id, it.producto_id, it.cantidad, it.precio_unitario, it.subtotal]); }
async function addEvidence(conn, devolucionId, file) { await conn.query(`INSERT INTO devolucion_evidencias (devolucion_id,url_archivo,nombre_original,mime_type,size_bytes) VALUES (?,?,?,?,?)`, [devolucionId, file.url, file.nombre_original, file.mime_type, file.size_bytes]); }
async function findById(id) { const [r] = await pool.query(`SELECT d.*, u.nombre comprador_nombre, t.nombre tienda_nombre FROM devoluciones d INNER JOIN usuarios u ON u.id=d.comprador_id INNER JOIN tiendas t ON t.id=d.tienda_id WHERE d.id=? LIMIT 1`, [id]); return r[0] || null; }
async function items(id) { const [r] = await pool.query(`SELECT i.*, p.nombre producto_nombre FROM devolucion_items i INNER JOIN productos p ON p.id=i.producto_id WHERE i.devolucion_id=? ORDER BY i.id`, [id]); return r; }
async function evidences(id) { const [r] = await pool.query('SELECT * FROM devolucion_evidencias WHERE devolucion_id=? ORDER BY id', [id]); return r; }
async function hydrate(row) { if (!row) return null; return { ...row, items: await items(row.id), evidencias: await evidences(row.id) }; }
async function listBuyer(userId) { const [r] = await pool.query('SELECT * FROM devoluciones WHERE comprador_id=? ORDER BY creado_en DESC', [userId]); return r; }
async function listSeller(userId) { const [r] = await pool.query(`SELECT d.* FROM devoluciones d INNER JOIN tiendas t ON t.id=d.tienda_id WHERE t.usuario_id=? ORDER BY d.creado_en DESC`, [userId]); return r; }
async function listAdmin() { const [r] = await pool.query(`SELECT d.*, u.nombre comprador_nombre, t.nombre tienda_nombre FROM devoluciones d INNER JOIN usuarios u ON u.id=d.comprador_id INNER JOIN tiendas t ON t.id=d.tienda_id ORDER BY d.creado_en DESC`); return r; }
async function sellerOwnsReturn(returnId, sellerId) { const [[r]] = await pool.query(`SELECT COUNT(*) total FROM devoluciones d INNER JOIN tiendas t ON t.id=d.tienda_id WHERE d.id=? AND t.usuario_id=?`, [returnId, sellerId]); return Number(r.total || 0) > 0; }
async function updateSeller(returnId, { estado, respuesta_vendedor }) { await pool.query(`UPDATE devoluciones SET estado=?, respuesta_vendedor=COALESCE(?,respuesta_vendedor), resuelto_en=CASE WHEN ? IN ('aprobada','rechazada','cerrada') THEN NOW() ELSE resuelto_en END WHERE id=?`, [estado, respuesta_vendedor || null, estado, returnId]); return findById(returnId); }
async function updateAdmin(returnId, { estado, respuesta_admin }, conn = pool) { await conn.query(`UPDATE devoluciones SET estado=?, respuesta_admin=COALESCE(?,respuesta_admin), resuelto_en=CASE WHEN ? IN ('aprobada','rechazada','reembolso_simulado','cerrada') THEN NOW() ELSE resuelto_en END WHERE id=?`, [estado, respuesta_admin || null, estado, returnId]); return conn === pool ? findById(returnId) : null; }
async function sellerForStore(tiendaId) { const [[r]] = await pool.query('SELECT usuario_id FROM tiendas WHERE id=? LIMIT 1', [tiendaId]); return r?.usuario_id || null; }
async function findByIdForUpdate(id, conn) { const [r] = await conn.query('SELECT * FROM devoluciones WHERE id=? LIMIT 1 FOR UPDATE', [id]); return r[0] || null; }
async function findRefundByReturnId(devolucionId, conn) { const [r] = await conn.query('SELECT * FROM reembolsos_simulados WHERE devolucion_id=? LIMIT 1', [devolucionId]); return r[0] || null; }
async function createSimulatedRefund(conn, { devolucion_id, pedido_id, monto }) { const [r] = await conn.query('INSERT INTO reembolsos_simulados (devolucion_id,pedido_id,monto) VALUES (?,?,?)', [devolucion_id, pedido_id, monto]); return r.insertId; }
module.exports = { pool, orderForBuyer, detailsForOrder, deliveredStoreIds, hasActiveDuplicate, createReturn, addItem, addEvidence, findById, hydrate, listBuyer, listSeller, listAdmin, sellerOwnsReturn, updateSeller, updateAdmin, sellerForStore, findByIdForUpdate, findRefundByReturnId, createSimulatedRefund };
