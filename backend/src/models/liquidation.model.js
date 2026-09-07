async function createForCommission(conn, { comision_id, valor_liquidado }) {
  await conn.query('INSERT INTO liquidaciones_simuladas (comision_id, valor_liquidado) VALUES (?,?) ON DUPLICATE KEY UPDATE comision_id=comision_id', [comision_id, valor_liquidado]);
}
async function findByCommissionId(executor, comisionId) {
  const [[row]] = await executor.query('SELECT * FROM liquidaciones_simuladas WHERE comision_id=? LIMIT 1', [comisionId]);
  return row || null;
}
module.exports = { createForCommission, findByCommissionId };
