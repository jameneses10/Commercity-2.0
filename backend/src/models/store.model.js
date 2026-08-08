const { pool } = require('../config/database');

async function findStoreBySellerId(usuarioId) {
  const [rows] = await pool.query('SELECT * FROM tiendas WHERE usuario_id = ? LIMIT 1', [usuarioId]);
  return rows[0] || null;
}

async function findStoreById(id) {
  const [rows] = await pool.query('SELECT * FROM tiendas WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function findStoreBySlug(slug) {
  const [rows] = await pool.query('SELECT * FROM tiendas WHERE slug = ? LIMIT 1', [slug]);
  return rows[0] || null;
}

async function findStoreByName(nombre) {
  const [rows] = await pool.query('SELECT * FROM tiendas WHERE nombre = ? LIMIT 1', [nombre]);
  return rows[0] || null;
}

async function createStore(data) {
  const [result] = await pool.query(
    `INSERT INTO tiendas (usuario_id, nombre, slug, descripcion, logo_url, banner_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [data.usuario_id, data.nombre, data.slug, data.descripcion || null, data.logo_url || null, data.banner_url || null]
  );
  return findStoreById(result.insertId);
}

async function updateStoreById(id, data) {
  const fields = [];
  const values = [];
  for (const key of ['nombre', 'slug', 'descripcion', 'logo_url', 'banner_url', 'estado']) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }
  if (!fields.length) return findStoreById(id);
  values.push(id);
  await pool.query(`UPDATE tiendas SET ${fields.join(', ')} WHERE id = ?`, values);
  return findStoreById(id);
}

async function listActiveProductsByStore(storeId, { limit, offset }) {
  const [rows] = await pool.query(
    `SELECT p.id, p.tienda_id, p.categoria_id, p.nombre, p.slug, p.descripcion, p.precio,
            p.precio_anterior, p.descuento_porcentaje,
            ROUND(CASE WHEN p.descuento_porcentaje > 0 THEN p.precio * (1 - p.descuento_porcentaje / 100) ELSE p.precio END, 2) AS precio_final,
            p.fecha_publicacion, p.fecha_caducidad, p.stock,
            p.estado, p.imagen_url, p.calificacion_promedio, p.total_resenas, p.created_at, p.updated_at,
            c.nombre AS categoria_nombre, c.slug AS categoria_slug
     FROM productos p
     INNER JOIN categorias c ON c.id = p.categoria_id
     INNER JOIN tiendas t ON t.id = p.tienda_id
     WHERE p.tienda_id = ? AND p.estado = 'activo' AND t.estado = 'activa'
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [storeId, limit, offset]
  );
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM productos p
     INNER JOIN tiendas t ON t.id = p.tienda_id
     WHERE p.tienda_id = ? AND p.estado = 'activo' AND t.estado = 'activa'`,
    [storeId]
  );
  return { rows, total: count.total };
}

async function pauseStoreBySellerId(usuarioId, conn = pool) {
  const [result] = await conn.query(
    `UPDATE tiendas SET estado = 'pausada' WHERE usuario_id = ? AND estado = 'activa'`,
    [usuarioId]
  );
  return result.affectedRows;
}

module.exports = {
  findStoreBySellerId,
  findStoreById,
  findStoreBySlug,
  findStoreByName,
  createStore,
  updateStoreById,
  listActiveProductsByStore,
  pauseStoreBySellerId,
};
