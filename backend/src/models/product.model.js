const { pool } = require('../config/database');

const PRICE_EXPR = `ROUND(CASE WHEN p.descuento_porcentaje > 0 THEN p.precio * (1 - p.descuento_porcentaje / 100) ELSE p.precio END, 2)`;
const PRODUCT_FIELDS = `p.id, p.tienda_id, p.categoria_id, p.nombre, p.slug, p.descripcion, p.precio, p.precio_anterior, p.descuento_porcentaje, ${PRICE_EXPR} AS precio_final, p.fecha_publicacion, p.fecha_caducidad, p.reportado, p.total_reportes, p.stock, p.estado, p.imagen_url, p.calificacion_promedio, p.total_resenas, p.created_at, p.updated_at`;

async function getImagesForProductIds(ids) {
  if (!ids.length) return new Map();
  const [rows] = await pool.query(`SELECT id, producto_id, url_imagen, nombre_original, mime_type, size_bytes, orden, es_principal, creado_en FROM producto_imagenes WHERE producto_id IN (?) ORDER BY es_principal DESC, orden ASC, id ASC`, [ids]);
  const map = new Map(ids.map((id) => [Number(id), []]));
  for (const row of rows) map.get(Number(row.producto_id))?.push(row);
  return map;
}
function withImages(product, images = []) {
  if (!product) return product;
  const arr = [...images];
  if (product.imagen_url && !arr.some((x) => x.url_imagen === product.imagen_url)) {
    arr.unshift({ id: null, producto_id: product.id, url_imagen: product.imagen_url, nombre_original: null, mime_type: null, size_bytes: null, orden: 0, es_principal: true, legacy: true });
  }
  return { ...product, imagenes: arr };
}
async function attachImagesToRows(rows) {
  const map = await getImagesForProductIds(rows.map((r) => r.id));
  return rows.map((row) => withImages(row, map.get(Number(row.id)) || []));
}
async function findProductById(id) {
  const [rows] = await pool.query(`SELECT *, ROUND(CASE WHEN descuento_porcentaje > 0 THEN precio * (1 - descuento_porcentaje / 100) ELSE precio END, 2) AS precio_final FROM productos WHERE id = ? LIMIT 1`, [id]);
  if (!rows[0]) return null;
  const map = await getImagesForProductIds([rows[0].id]);
  return withImages(rows[0], map.get(Number(rows[0].id)) || []);
}
async function findProductDetailById(id) {
  const [rows] = await pool.query(
    `SELECT ${PRODUCT_FIELDS}, t.nombre AS tienda_nombre, t.slug AS tienda_slug, c.nombre AS categoria_nombre, c.slug AS categoria_slug
     FROM productos p INNER JOIN tiendas t ON t.id = p.tienda_id INNER JOIN categorias c ON c.id = p.categoria_id
     WHERE p.id = ? AND p.estado IN ('activo','agotado') AND t.estado = 'activa' AND c.estado = 'activa' AND (p.fecha_caducidad IS NULL OR p.fecha_caducidad >= NOW()) LIMIT 1`, [id]);
  if (!rows[0]) return null;
  const map = await getImagesForProductIds([rows[0].id]);
  return withImages(rows[0], map.get(Number(rows[0].id)) || []);
}
async function findProductByStoreSlug(tiendaId, slug) { const [rows] = await pool.query('SELECT * FROM productos WHERE tienda_id = ? AND slug = ? LIMIT 1', [tiendaId, slug]); return rows[0] || null; }
async function createProduct(data) {
  const [result] = await pool.query(
    `INSERT INTO productos (tienda_id, categoria_id, nombre, slug, descripcion, precio, precio_anterior, descuento_porcentaje, fecha_publicacion, fecha_caducidad, stock, estado, imagen_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, ?, ?, ?)`,
    [data.tienda_id, data.categoria_id, data.nombre, data.slug, data.descripcion, data.precio, data.precio_anterior || null, data.descuento_porcentaje || 0, data.fecha_publicacion || null, data.fecha_caducidad || null, data.stock, data.estado, data.imagen_url || null]
  );
  return findProductById(result.insertId);
}
async function updateProductById(id, data) {
  const fields = []; const values = [];
  for (const key of ['categoria_id', 'nombre', 'slug', 'descripcion', 'precio', 'precio_anterior', 'descuento_porcentaje', 'fecha_publicacion', 'fecha_caducidad', 'stock', 'estado', 'imagen_url', 'reportado', 'total_reportes']) {
    if (Object.prototype.hasOwnProperty.call(data, key)) { fields.push(`${key} = ?`); values.push(data[key]); }
  }
  if (!fields.length) return findProductById(id);
  values.push(id); await pool.query(`UPDATE productos SET ${fields.join(', ')} WHERE id = ?`, values); return findProductById(id);
}
async function countImages(productId) { const [[r]] = await pool.query('SELECT COUNT(*) total FROM producto_imagenes WHERE producto_id=?', [productId]); return Number(r.total || 0); }
async function addProductImages(productId, images) {
  if (!images?.length) return [];
  const current = await countImages(productId);
  if (current + images.length > 6) { const e = new Error('Un producto puede tener máximo 6 imágenes.'); e.statusCode = 400; throw e; }
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    await pool.query(`INSERT INTO producto_imagenes (producto_id, url_imagen, nombre_original, mime_type, size_bytes, orden, es_principal) VALUES (?,?,?,?,?,?,?)`, [productId, img.url, img.nombre_original, img.mime_type, img.size_bytes, current + i, current === 0 && i === 0]);
  }
  const map = await getImagesForProductIds([productId]);
  return map.get(Number(productId)) || [];
}
async function findImageById(imageId) { const [[r]] = await pool.query('SELECT * FROM producto_imagenes WHERE id=? LIMIT 1', [imageId]); return r || null; }
async function deleteProductImage(imageId) { const [r] = await pool.query('DELETE FROM producto_imagenes WHERE id=?', [imageId]); return r.affectedRows > 0; }
function buildCatalogWhere(filters) {
  const where = ["p.estado IN ('activo','agotado')", "t.estado = 'activa'", "c.estado = 'activa'", '(p.fecha_caducidad IS NULL OR p.fecha_caducidad >= NOW())'];
  const values = [];
  if (filters.q) { where.push('(p.nombre LIKE ? OR p.descripcion LIKE ? OR t.nombre LIKE ?)'); values.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`); }
  if (filters.category_id) { where.push('p.categoria_id = ?'); values.push(filters.category_id); }
  if (filters.store_id) { where.push('p.tienda_id = ?'); values.push(filters.store_id); }
  if (filters.min_price !== undefined) { where.push(`${PRICE_EXPR} >= ?`); values.push(filters.min_price); }
  if (filters.max_price !== undefined) { where.push(`${PRICE_EXPR} <= ?`); values.push(filters.max_price); }
  return { where: where.join(' AND '), values };
}
/* RNF-013: los cuatro ordenes desempatan por p.id DESC para que el orden sea
   TOTAL y determinista. Sin el, dos productos con la misma fecha efectiva -- o
   el mismo precio, o la misma calificacion -- pueden intercambiar posicion entre
   peticiones y provocar que una fila aparezca dos veces o se salte al paginar.
   Medido antes del cambio: con 200 productos empatados en la misma fecha el
   orden resultaba estable, pero solo de hecho, porque MySQL recorria el indice y
   dentro de claves iguales InnoDB devolvia por clave primaria. Eso no lo
   garantiza la semantica SQL, y un scroll infinito depende de que lo este. */
function sortClause(sort) { switch (sort) { case 'price_asc': return 'precio_final ASC, p.id DESC'; case 'price_desc': return 'precio_final DESC, p.id DESC'; case 'rating_desc': return 'p.calificacion_promedio DESC, p.id DESC'; case 'newest': default: return 'COALESCE(p.fecha_publicacion,p.created_at) DESC, p.id DESC'; } }
async function listPublicProducts(filters) {
  const { where, values } = buildCatalogWhere(filters); const orderBy = sortClause(filters.sort);
  const [rows] = await pool.query(`SELECT ${PRODUCT_FIELDS}, t.nombre AS tienda_nombre, t.slug AS tienda_slug, c.nombre AS categoria_nombre, c.slug AS categoria_slug FROM productos p INNER JOIN tiendas t ON t.id = p.tienda_id INNER JOIN categorias c ON c.id = p.categoria_id WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...values, filters.limit, filters.offset]);
  const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM productos p INNER JOIN tiendas t ON t.id = p.tienda_id INNER JOIN categorias c ON c.id = p.categoria_id WHERE ${where}`, values);
  return { rows: await attachImagesToRows(rows), total: count.total };
}
async function incrementReport(id){ await pool.query('UPDATE productos SET total_reportes=total_reportes+1, reportado=TRUE WHERE id=?',[id]); return findProductById(id); }
module.exports = { findProductById, findProductDetailById, findProductByStoreSlug, createProduct, updateProductById, addProductImages, findImageById, deleteProductImage, listPublicProducts, incrementReport };
