const { pool } = require('../config/database');

async function sellerStore(userId) {
  const [[store]] = await pool.query('SELECT * FROM tiendas WHERE usuario_id = ? LIMIT 1', [userId]);
  return store || null;
}
function requireStore(store) { if (!store) { const e = new Error('El vendedor no tiene tienda asociada.'); e.statusCode = 404; throw e; } }
async function sellerProducts(userId) {
  const store = await sellerStore(userId); requireStore(store);
  const [products] = await pool.query(
    `SELECT p.*, c.nombre AS categoria_nombre,
            (SELECT COUNT(*) FROM reportes_productos rp WHERE rp.producto_id = p.id AND rp.estado = 'pendiente') AS reportes_pendientes
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE p.tienda_id = ?
      ORDER BY p.created_at DESC`, [store.id]
  );
  return { store, products };
}
async function sellerReviews(userId) {
  const store = await sellerStore(userId); requireStore(store);
  const [reviews] = await pool.query(
    `SELECT r.id, r.producto_id, p.nombre AS producto_nombre, r.comprador_id,
            u.nombre AS comprador_nombre, r.pedido_id, r.estrellas, r.comentario,
            r.estado, r.created_at
       FROM resenas r
       INNER JOIN productos p ON p.id = r.producto_id
       LEFT JOIN usuarios u ON u.id = r.comprador_id
      WHERE p.tienda_id = ?
      ORDER BY r.created_at DESC`, [store.id]
  );
  return { store, reviews };
}
async function sellerReputation(userId) {
  const store = await sellerStore(userId); requireStore(store);
  const [[stats]] = await pool.query(
    `SELECT COUNT(r.id) total_resenas, COALESCE(AVG(r.estrellas),0) promedio_resenas,
            SUM(r.estado='aprobada') resenas_aprobadas,
            SUM(r.estado IN ('rechazada','ocultada')) resenas_moderadas
       FROM resenas r
       INNER JOIN productos p ON p.id = r.producto_id
      WHERE p.tienda_id = ?`, [store.id]
  );
  return { store, reputation: { nivel: store.nivel_reputacion, promedio: Number(store.reputacion_promedio || stats.promedio_resenas || 0), total_resenas: Number(stats.total_resenas || 0), resenas_aprobadas: Number(stats.resenas_aprobadas || 0), resenas_moderadas: Number(stats.resenas_moderadas || 0) } };
}
async function sellerCommissions(userId) {
  const store = await sellerStore(userId); requireStore(store);
  const [commissions] = await pool.query(
    `SELECT c.id, c.pedido_id, c.tienda_id, c.subtotal_tienda AS valor_venta,
            c.porcentaje_comision, c.valor_comision, c.valor_vendedor,
            COALESCE(c.estado, 'pendiente') AS estado, c.created_at,
            p.estado_pago, p.estado_general
       FROM comisiones c
       INNER JOIN pedidos p ON p.id = c.pedido_id
      WHERE c.tienda_id = ?
      ORDER BY c.created_at DESC`, [store.id]
  );
  return { store, commissions };
}
async function adminStores({ q='', status='', limit=50, page=1 }) {
  limit = Math.min(Math.max(parseInt(limit,10)||50,1),100); page = Math.max(parseInt(page,10)||1,1);
  const where=[]; const params=[];
  if (q) { where.push('(t.nombre LIKE ? OR u.nombre LIKE ? OR u.correo LIKE ?)'); params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  if (status) { where.push('t.estado = ?'); params.push(status); }
  params.push(limit, (page-1)*limit);
  const [stores] = await pool.query(
    `SELECT t.id, t.nombre, t.slug, t.estado, t.reputacion_promedio, t.nivel_reputacion, t.created_at,
            u.id AS vendedor_id, u.nombre AS vendedor_nombre, u.correo AS vendedor_correo,
            COUNT(p.id) AS total_productos,
            SUM(p.estado='activo') AS productos_activos
       FROM tiendas t
       INNER JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN productos p ON p.tienda_id = t.id
      ${where.length ? 'WHERE '+where.join(' AND ') : ''}
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?`, params
  );
  return { stores, pagination: { page, limit } };
}
async function adminPayments({ limit=50, page=1 }) {
  limit=Math.min(Math.max(parseInt(limit,10)||50,1),100); page=Math.max(parseInt(page,10)||1,1);
  const [payments] = await pool.query(
    `SELECT pg.id, pg.pedido_id, pg.metodo, pg.referencia, pg.estado, pg.mensaje, pg.created_at,
            p.total AS valor, p.estado_pago, p.estado_general,
            u.id AS comprador_id, u.nombre AS comprador_nombre, u.correo AS comprador_correo
       FROM pagos pg
       INNER JOIN pedidos p ON p.id = pg.pedido_id
       INNER JOIN usuarios u ON u.id = p.comprador_id
      ORDER BY pg.created_at DESC LIMIT ? OFFSET ?`, [limit,(page-1)*limit]
  );
  return { payments, pagination:{page,limit} };
}
async function adminShipments({ limit=50, page=1 }) {
  limit=Math.min(Math.max(parseInt(limit,10)||50,1),100); page=Math.max(parseInt(page,10)||1,1);
  const [shipments] = await pool.query(
    `SELECT e.id, e.pedido_id, e.tienda_id, e.transportadora, e.numero_guia, e.estado,
            e.fecha_envio, e.fecha_entrega, e.created_at,
            p.total, p.estado_pago, p.estado_general,
            u.nombre AS comprador_nombre, t.nombre AS tienda_nombre, v.nombre AS vendedor_nombre
       FROM envios e
       INNER JOIN pedidos p ON p.id = e.pedido_id
       INNER JOIN usuarios u ON u.id = p.comprador_id
       INNER JOIN tiendas t ON t.id = e.tienda_id
       INNER JOIN usuarios v ON v.id = t.usuario_id
      ORDER BY e.created_at DESC LIMIT ? OFFSET ?`, [limit,(page-1)*limit]
  );
  return { shipments, pagination:{page,limit} };
}
async function adminReviews({ limit=50, page=1 }) {
  limit=Math.min(Math.max(parseInt(limit,10)||50,1),100); page=Math.max(parseInt(page,10)||1,1);
  const [reviews] = await pool.query(
    `SELECT r.id, r.producto_id, p.nombre AS producto_nombre, t.id AS tienda_id, t.nombre AS tienda_nombre,
            r.comprador_id, u.nombre AS comprador_nombre, r.estrellas, r.comentario, r.estado, r.created_at
       FROM resenas r
       INNER JOIN productos p ON p.id = r.producto_id
       INNER JOIN tiendas t ON t.id = p.tienda_id
       LEFT JOIN usuarios u ON u.id = r.comprador_id
      ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [limit,(page-1)*limit]
  );
  return { reviews, pagination:{page,limit} };
}
async function adminCommissions({ limit=50, page=1, pedido_id, vendedor_id, fecha_desde, fecha_hasta_exclusiva }) {
  limit=Math.min(Math.max(parseInt(limit,10)||50,1),100); page=Math.max(parseInt(page,10)||1,1);
  const where=[]; const params=[];
  if (pedido_id!==undefined) { where.push('c.pedido_id = ?'); params.push(pedido_id); }
  if (vendedor_id!==undefined) { where.push('u.id = ?'); params.push(vendedor_id); }
  if (fecha_desde!==undefined) { where.push('c.created_at >= ?'); params.push(`${fecha_desde} 00:00:00`); }
  if (fecha_hasta_exclusiva!==undefined) { where.push('c.created_at < ?'); params.push(`${fecha_hasta_exclusiva} 00:00:00`); }
  params.push(limit, (page-1)*limit);
  const [commissions] = await pool.query(
    `SELECT c.id, c.pedido_id, c.tienda_id, t.nombre AS tienda_nombre, u.id AS vendedor_id,
            u.nombre AS vendedor_nombre, c.subtotal_tienda AS valor_venta, c.porcentaje_comision,
            c.valor_comision, c.valor_vendedor, COALESCE(c.estado,'pendiente') AS estado, c.created_at,
            p.estado_pago, p.estado_general
       FROM comisiones c
       INNER JOIN tiendas t ON t.id = c.tienda_id
       INNER JOIN usuarios u ON u.id = t.usuario_id
       INNER JOIN pedidos p ON p.id = c.pedido_id
      ${where.length ? 'WHERE '+where.join(' AND ') : ''}
      ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, params
  );
  return { commissions, pagination:{page,limit} };
}
async function updateCommissionStatus(id, estado) {
  if (!['pendiente','pagada','revisada','rechazada'].includes(estado)) { const e=new Error('Estado de comisión no permitido.'); e.statusCode=400; throw e; }
  const [[commission]] = await pool.query('SELECT * FROM comisiones WHERE id=? LIMIT 1', [id]);
  if (!commission) { const e=new Error('Comisión no encontrada.'); e.statusCode=404; throw e; }
  await pool.query('UPDATE comisiones SET estado=? WHERE id=?', [estado, id]);
  const [[updated]] = await pool.query('SELECT *, subtotal_tienda AS valor_venta FROM comisiones WHERE id=?', [id]);
  return updated;
}
module.exports={sellerProducts,sellerReviews,sellerReputation,sellerCommissions,adminStores,adminPayments,adminShipments,adminReviews,adminCommissions,updateCommissionStatus};
