const { pool } = require('../config/database');

async function getPendingOperations(userId, conn = pool) {
  const [pedidosRow] = await conn.query(
    `SELECT COUNT(DISTINCT p.id) AS total
     FROM pedidos p
     INNER JOIN pedido_detalles pd ON pd.pedido_id = p.id
     INNER JOIN tiendas t ON t.id = pd.tienda_id
     LEFT JOIN envios e ON e.pedido_id = p.id AND e.tienda_id = pd.tienda_id
     WHERE p.estado_pago = 'pagado'
       AND p.estado_general NOT IN ('completado', 'cancelado')
       AND e.id IS NULL
       AND (p.comprador_id = ? OR t.usuario_id = ?)`,
    [userId, userId]
  );
  const pedidos = pedidosRow[0].total;

  const [enviosRow] = await conn.query(
    `SELECT COUNT(DISTINCT e.id) AS total
     FROM envios e
     INNER JOIN pedidos p ON p.id = e.pedido_id
     INNER JOIN tiendas t ON t.id = e.tienda_id
     WHERE e.estado IN ('pendiente', 'preparado', 'en_camino')
       AND (p.comprador_id = ? OR t.usuario_id = ?)`,
    [userId, userId]
  );
  const envios = enviosRow[0].total;

  const [devolucionesRow] = await conn.query(
    `SELECT COUNT(DISTINCT d.id) AS total
     FROM devoluciones d
     INNER JOIN tiendas t ON t.id = d.tienda_id
     WHERE d.estado IN ('solicitada', 'en_revision')
       AND (d.comprador_id = ? OR t.usuario_id = ?)`,
    [userId, userId]
  );
  const devoluciones = devolucionesRow[0].total;

  const [reembolsosRow] = await conn.query(
    `SELECT COUNT(DISTINCT d.id) AS total
     FROM devoluciones d
     INNER JOIN tiendas t ON t.id = d.tienda_id
     WHERE d.estado = 'aprobada'
       AND (d.comprador_id = ? OR t.usuario_id = ?)`,
    [userId, userId]
  );
  const reembolsos = reembolsosRow[0].total;

  return {
    pedidos,
    envios,
    devoluciones,
    reembolsos,
    total: pedidos + envios + devoluciones + reembolsos
  };
}

module.exports = {
  getPendingOperations
};
