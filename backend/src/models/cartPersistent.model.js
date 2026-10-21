const { pool } = require('../config/database');

const EFFECTIVE_PRICE_EXPR = `ROUND(CASE WHEN p.descuento_porcentaje > 0 THEN p.precio * (1 - p.descuento_porcentaje / 100) ELSE p.precio END, 2)`;
function toCents(value) { return Math.round(Number(value) * 100); }

/* #81: ancla de serializacion. Todo el que escriba en el carrito toma antes
   esta fila, de modo que el checkout y las modificaciones no se solapen.
   Medido: bloquear `carritos` NO basta por si solo. Insertar un hijo con
   clave ajena toma un compartido sobre el padre y por eso addItem esperaba,
   pero UPDATE y DELETE de un hijo no tocan al padre y entraban sin esperar
   (200 en 12 y 15 ms con la fila bloqueada). De ahi que el bloqueo sea
   explicito en los cinco escritores y no se confie en la clave ajena. */
async function lockActiveCart(usuarioId, conn) {
  const [[existing]] = await conn.query(
    'SELECT id FROM carritos WHERE usuario_id = ? AND estado = ? LIMIT 1 FOR UPDATE',
    [usuarioId, 'activo']
  );
  if (existing) return existing.id;
  const [result] = await conn.query(
    'INSERT INTO carritos (usuario_id, estado) VALUES (?, ?)',
    [usuarioId, 'activo']
  );
  return result.insertId;
}

/* Vacia el carrito dentro de la transaccion de quien lo llama. No usa
   clearCart: aquel abre su propia transaccion y no serviria para esto. */
async function consumeItems(cartId, conn) {
  const [result] = await conn.query(
    'DELETE FROM carrito_items WHERE carrito_id = ?', [cartId]);
  return result.affectedRows;
}

/* Ejecuta `fn` con el carrito bloqueado, en una transaccion propia. */
async function conCarritoBloqueado(usuarioId, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const cartId = await lockActiveCart(usuarioId, conn);
    const salida = await fn(conn, cartId);
    await conn.commit();
    return salida;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function getActiveCartId(usuarioId, conn = pool) {
  const [[existing]] = await conn.query(
    'SELECT id FROM carritos WHERE usuario_id = ? AND estado = ? LIMIT 1',
    [usuarioId, 'activo']
  );
  if (existing) return existing.id;
  const [result] = await conn.query(
    'INSERT INTO carritos (usuario_id, estado) VALUES (?, ?)',
    [usuarioId, 'activo']
  );
  return result.insertId;
}

async function getProduct(productId, conn = pool) {
  const [[product]] = await conn.query(
    `SELECT p.id, p.nombre, p.precio, ${EFFECTIVE_PRICE_EXPR} AS precio_efectivo,
            p.stock, p.estado, p.imagen_url, p.tienda_id,
            t.nombre AS tienda_nombre, t.estado AS tienda_estado,
            c.nombre AS categoria_nombre, c.estado AS categoria_estado
       FROM productos p
       INNER JOIN tiendas t ON t.id = p.tienda_id
       INNER JOIN categorias c ON c.id = p.categoria_id
      WHERE p.id = ? LIMIT 1`,
    [productId]
  );
  return product || null;
}

async function findItemForUser(usuarioId, itemId, conn = pool) {
  const [[item]] = await conn.query(
    `SELECT ci.id, ci.carrito_id, ci.producto_id, ci.cantidad
       FROM carrito_items ci
       INNER JOIN carritos c ON c.id = ci.carrito_id
      WHERE ci.id = ? AND c.usuario_id = ? AND c.estado = 'activo'
      LIMIT 1`,
    [itemId, usuarioId]
  );
  return item || null;
}

async function getCart(usuarioId, conn = pool) {
  const cartId = await getActiveCartId(usuarioId, conn);
  const [items] = await conn.query(
    /* RNF-016: se añaden los estados comerciales de tienda y categoría. Esta
       consulta ya traía en lote todo lo que la validación necesita menos esos
       dos campos; con ellos, validateCart() puede trabajar sobre el carrito
       persistente y deja de hacer una consulta por producto. */
    `SELECT ci.id, ci.producto_id, ci.cantidad, ci.precio_unitario_snapshot,
            p.nombre, ${EFFECTIVE_PRICE_EXPR} AS precio, p.stock, p.estado, p.imagen_url,
            p.tienda_id, t.nombre AS tienda_nombre, t.estado AS tienda_estado,
            c.nombre AS categoria_nombre, c.estado AS categoria_estado,
            ROUND(${EFFECTIVE_PRICE_EXPR} * ci.cantidad, 2) AS subtotal
       FROM carrito_items ci
       INNER JOIN productos p ON p.id = ci.producto_id
       INNER JOIN tiendas t ON t.id = p.tienda_id
       INNER JOIN categorias c ON c.id = p.categoria_id
      WHERE ci.carrito_id = ?
      ORDER BY ci.created_at DESC`,
    [cartId]
  );
  const normalized = items.map((item) => ({
    ...item,
    precio: Number(item.precio),
    precio_unitario: Number(item.precio),
    precio_unitario_snapshot: item.precio_unitario_snapshot == null ? null : Number(item.precio_unitario_snapshot),
    subtotal: Number(item.subtotal),
  }));
  const total = normalized.reduce((sum, item) => sum + toCents(item.subtotal), 0) / 100;
  return { cart: { id: cartId, usuario_id: usuarioId, estado: 'activo' }, items: normalized, total };
}

async function upsertItem(usuarioId, productId, cantidad) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const cartId = await lockActiveCart(usuarioId, conn);
    const product = await getProduct(productId, conn);
    if (!product) {
      const error = new Error('Producto no encontrado.');
      error.statusCode = 404;
      throw error;
    }
    if (product.estado !== 'activo') {
      const error = new Error('Producto no disponible para carrito.');
      error.statusCode = 409;
      throw error;
    }
    if (product.tienda_estado !== 'activa' || product.categoria_estado !== 'activa') {
      const error = new Error('Producto no disponible comercialmente.');
      error.statusCode = 409;
      throw error;
    }
    const [[existing]] = await conn.query(
      'SELECT id, cantidad FROM carrito_items WHERE carrito_id = ? AND producto_id = ? LIMIT 1',
      [cartId, productId]
    );
    const nextQty = Number(existing?.cantidad || 0) + cantidad;
    if (Number(product.stock) < nextQty) {
      const error = new Error('Stock insuficiente.');
      error.statusCode = 409;
      throw error;
    }
    await conn.query(
      `INSERT INTO carrito_items (carrito_id, producto_id, cantidad, precio_unitario_snapshot)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE cantidad = VALUES(cantidad)`,
      [cartId, productId, nextQty, product.precio_efectivo]
    );
    const cart = await getCart(usuarioId, conn);
    await conn.commit();
    return cart;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function updateItem(usuarioId, itemId, cantidad) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await lockActiveCart(usuarioId, conn);
    const item = await findItemForUser(usuarioId, itemId, conn);
    if (!item) {
      const error = new Error('Item de carrito no encontrado.');
      error.statusCode = 404;
      throw error;
    }
    const product = await getProduct(item.producto_id, conn);
    if (!product || product.estado !== 'activo') {
      const error = new Error('Producto no disponible para carrito.');
      error.statusCode = 409;
      throw error;
    }
    if (Number(product.stock) < cantidad) {
      const error = new Error('Stock insuficiente.');
      error.statusCode = 409;
      throw error;
    }
    await conn.query('UPDATE carrito_items SET cantidad = ? WHERE id = ?', [cantidad, itemId]);
    const cart = await getCart(usuarioId, conn);
    await conn.commit();
    return cart;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function deleteItem(usuarioId, itemId) {
  return conCarritoBloqueado(usuarioId, async (conn) => {
    const item = await findItemForUser(usuarioId, itemId, conn);
    if (!item) {
      const error = new Error('Item de carrito no encontrado.');
      error.statusCode = 404;
      throw error;
    }
    await conn.query('DELETE FROM carrito_items WHERE id = ?', [itemId]);
    return getCart(usuarioId, conn);
  });
}

async function clearCart(usuarioId) {
  return conCarritoBloqueado(usuarioId, async (conn, cartId) => {
    await conn.query('DELETE FROM carrito_items WHERE carrito_id = ?', [cartId]);
    return getCart(usuarioId, conn);
  });
}

/* La validacion publica del carrito tambien escribe, al avanzar los
   snapshots de precio. Cuando no corre dentro de otra transaccion, necesita
   el mismo bloqueo que los demas escritores. */
async function advancePriceSnapshotsLocked(usuarioId, updates) {
  if (!updates.length) return 0;
  return conCarritoBloqueado(usuarioId, (conn) =>
    advancePriceSnapshots(usuarioId, updates, conn));
}

async function advancePriceSnapshots(usuarioId, updates, conn = pool) {
  if (!updates.length) return 0;
  const byProduct = new Map(updates.map((update) => [Number(update.producto_id), Number(update.precio_actual)]));
  const entries = [...byProduct.entries()];
  const cases = entries.map(() => 'WHEN ? THEN ?').join(' ');
  const placeholders = entries.map(() => '?').join(', ');
  const values = entries.flatMap(([productId, price]) => [productId, price]);
  const [result] = await conn.query(
    `UPDATE carrito_items ci
       INNER JOIN carritos c ON c.id = ci.carrito_id
        SET ci.precio_unitario_snapshot = CASE ci.producto_id ${cases}
          ELSE ci.precio_unitario_snapshot END
      WHERE c.usuario_id = ? AND c.estado = 'activo'
        AND ci.producto_id IN (${placeholders})`,
    [...values, usuarioId, ...entries.map(([productId]) => productId)]
  );
  return result.affectedRows;
}

module.exports = {
  getCart,
  upsertItem,
  updateItem,
  deleteItem,
  clearCart,
  advancePriceSnapshots,
  advancePriceSnapshotsLocked,
  lockActiveCart,
  consumeItems,
};
