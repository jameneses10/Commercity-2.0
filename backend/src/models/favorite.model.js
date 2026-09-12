const { pool } = require('../config/database');

async function findActiveProduct(productId) {
  const [rows] = await pool.query(`SELECT p.id, p.nombre, p.estado, p.imagen_url, p.precio, p.stock, t.estado AS tienda_estado, t.nombre AS tienda_nombre
    FROM productos p INNER JOIN tiendas t ON t.id=p.tienda_id WHERE p.id=? LIMIT 1`, [productId]);
  return rows[0] || null;
}
async function add(userId, productId) {
  const [r] = await pool.query('INSERT IGNORE INTO favoritos (usuario_id, producto_id) VALUES (?,?)', [userId, productId]);
  return r.affectedRows > 0;
}
async function remove(userId, productId) {
  const [r] = await pool.query('DELETE FROM favoritos WHERE usuario_id=? AND producto_id=?', [userId, productId]);
  return r.affectedRows > 0;
}
async function exists(userId, productId) {
  const [[r]] = await pool.query('SELECT COUNT(*) total FROM favoritos WHERE usuario_id=? AND producto_id=?', [userId, productId]);
  return Number(r.total || 0) > 0;
}
async function list(userId) {
  const [rows] = await pool.query(`SELECT f.id, f.producto_id, f.creado_en,
      p.nombre, p.descripcion, p.precio, p.stock, p.estado, p.imagen_url, p.calificacion_promedio, p.total_resenas,
      t.id AS tienda_id, t.nombre AS tienda_nombre, t.estado AS tienda_estado,
      c.nombre AS categoria_nombre
    FROM favoritos f
    INNER JOIN productos p ON p.id=f.producto_id
    INNER JOIN tiendas t ON t.id=p.tienda_id
    INNER JOIN categorias c ON c.id=p.categoria_id
    WHERE f.usuario_id=?
    ORDER BY f.creado_en DESC`, [userId]);
  return rows;
}
async function listFavoriterIds(productId, conn) {
  const db = conn || pool;
  const [rows] = await db.query('SELECT usuario_id FROM favoritos WHERE producto_id=? ORDER BY usuario_id', [productId]);
  return rows.map((r) => Number(r.usuario_id));
}
module.exports = { pool, findActiveProduct, add, remove, exists, list, listFavoriterIds };
