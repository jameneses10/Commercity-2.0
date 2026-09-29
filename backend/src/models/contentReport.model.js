const { pool } = require('../config/database');

// Los tres tipos comparten el lifecycle publicado por reportes_productos y
// reportes_usuarios. La configuracion es fija en el servidor: ningun identificador
// SQL proviene de la peticion.
const REPORT_TYPES = Object.freeze({
  stores: Object.freeze({
    table: 'reportes_tiendas',
    targetColumn: 'tienda_id',
    targetTable: 'tiendas',
    targetLabel: 'nombre',
    motivoRequired: true
  }),
  reviews: Object.freeze({
    table: 'reportes_resenas',
    targetColumn: 'resena_id',
    targetTable: 'resenas',
    targetLabel: 'comentario',
    motivoRequired: true
  }),
  messages: Object.freeze({
    table: 'reportes_mensajes',
    targetColumn: 'mensaje_id',
    targetTable: 'mensajes',
    targetLabel: 'contenido',
    motivoRequired: false
  })
});

const OPEN_STATES = Object.freeze(['pendiente', 'revisado']);

function config(type) {
  const found = REPORT_TYPES[type];
  if (!found) { const e = new Error('Tipo de reporte no soportado.'); e.statusCode = 400; throw e; }
  return found;
}

async function targetExists(type, targetId, executor = pool) {
  const { targetTable } = config(type);
  const [[row]] = await executor.query(`SELECT id FROM ${targetTable} WHERE id=? LIMIT 1`, [targetId]);
  return Boolean(row);
}

async function findOpenDuplicate(type, targetId, reporterId, executor = pool) {
  const { table, targetColumn } = config(type);
  const [[row]] = await executor.query(
    `SELECT id FROM ${table} WHERE ${targetColumn}=? AND usuario_reportante_id=? AND estado IN ('pendiente','revisado') LIMIT 1`,
    [targetId, reporterId]
  );
  return row || null;
}

async function create(type, { targetId, reporterId, motivo = null, descripcion = null }, executor = pool) {
  const { table, targetColumn } = config(type);
  const [result] = await executor.query(
    `INSERT INTO ${table} (${targetColumn},usuario_reportante_id,motivo,descripcion) VALUES (?,?,?,?)`,
    [targetId, reporterId, motivo, descripcion]
  );
  return findById(type, result.insertId, executor);
}

async function findById(type, id, executor = pool) {
  const { table } = config(type);
  const [[row]] = await executor.query(`SELECT * FROM ${table} WHERE id=? LIMIT 1`, [id]);
  return row || null;
}

async function list(type, { estado, q, sort, limit = 20, offset = 0 } = {}) {
  const { table, targetColumn, targetTable, targetLabel } = config(type);
  const where = [];
  const params = [];
  if (estado !== undefined) { where.push('r.estado = ?'); params.push(estado); }
  if (q) { where.push('(r.motivo LIKE ? OR r.descripcion LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const orderBy = sort === 'oldest' ? 'r.created_at ASC' : 'r.created_at DESC';
  params.push(limit, offset);
  const [rows] = await pool.query(
    `SELECT r.*, r.${targetColumn} AS target_id, t.${targetLabel} AS target_label,
            u.nombre AS reportante_nombre, u.correo AS reportante_correo
       FROM ${table} r
       LEFT JOIN ${targetTable} t ON t.id = r.${targetColumn}
       LEFT JOIN usuarios u ON u.id = r.usuario_reportante_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    params
  );
  return rows;
}

async function countOpen(type) {
  const { table } = config(type);
  const [[row]] = await pool.query(`SELECT COUNT(*) total FROM ${table} WHERE estado IN ('pendiente','revisado')`);
  return Number(row.total || 0);
}

async function update(type, id, { estado, respuesta_admin }, executor = pool) {
  const { table } = config(type);
  const sets = [];
  const params = [];
  if (estado !== undefined) { sets.push('estado = ?'); params.push(estado); }
  if (respuesta_admin !== undefined) { sets.push('respuesta_admin = ?'); params.push(respuesta_admin); }
  if (sets.length) {
    params.push(id);
    await executor.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id=?`, params);
  }
  return findById(type, id, executor);
}

module.exports = { REPORT_TYPES, OPEN_STATES, config, targetExists, findOpenDuplicate, create, findById, list, countOpen, update };
