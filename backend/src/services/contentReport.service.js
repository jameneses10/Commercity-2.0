const { pool } = require('../config/database');
const model = require('../models/contentReport.model');
const notification = require('./notification.service');
const logService = require('./log.service');

function err(m, s) { const e = new Error(m); e.statusCode = s; return e; }

const REPORT_STATES = ['pendiente', 'revisado', 'rechazado', 'accionado'];
const TYPE_META = Object.freeze({
  stores: { entidad: 'reportes_tiendas', notifTipo: 'nuevo_reporte_tienda', notifTitulo: 'Nuevo reporte de tienda', notifMensaje: 'Una tienda fue reportada.', accion: 'tienda_reportada' },
  reviews: { entidad: 'reportes_resenas', notifTipo: 'nuevo_reporte_resena', notifTitulo: 'Nuevo reporte de reseña', notifMensaje: 'Una reseña fue reportada.', accion: 'resena_reportada' },
  messages: { entidad: 'reportes_mensajes', notifTipo: 'nuevo_reporte_mensaje', notifTitulo: 'Nuevo reporte de mensaje', notifMensaje: 'Un mensaje de chat fue reportado.', accion: 'mensaje_reportado' }
});

function meta(type) {
  const found = TYPE_META[type];
  if (!found) throw err('Tipo de reporte no soportado.', 400);
  return found;
}

function normalizeMotivo(value) {
  if (typeof value !== 'string') throw err('El motivo debe tener entre 3 y 120 caracteres.', 400);
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 120) throw err('El motivo debe tener entre 3 y 120 caracteres.', 400);
  return trimmed;
}

function normalizeDescripcion(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw err('descripcion inválida.', 400);
  const trimmed = value.trim();
  if (trimmed.length > 1000) throw err('La descripción no puede superar 1000 caracteres.', 400);
  return trimmed || null;
}

function normalizeStateFilter(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !REPORT_STATES.includes(value)) throw err('estado inválido.', 400);
  return value;
}

function normalizeSearch(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw err('q inválido.', 400);
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > 120) throw err('q inválido.', 400);
  return trimmed;
}

function normalizeSort(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw err('sort inválido.', 400);
  if (!['newest', 'oldest'].includes(value)) throw err('sort inválido.', 400);
  return value;
}

async function notifyAdmins(executor, type, reportId) {
  const info = meta(type);
  const [admins] = await executor.query(
    `SELECT u.id FROM usuarios u INNER JOIN roles r ON r.id=u.rol_id WHERE r.nombre='administrador' AND u.estado='activo'`
  );
  for (const a of admins) {
    await notification.create(executor, a.id, {
      tipo: info.notifTipo,
      titulo: info.notifTitulo,
      mensaje: info.notifMensaje,
      entidad_tipo: info.entidad,
      entidad_id: reportId,
      url_destino: '/pages/admin-reportes.html'
    });
  }
  return admins.length;
}

// Creacion generica. motivo es obligatorio para tiendas y resenas; para mensajes el
// contrato publicado no envia body, por lo que puede quedar NULL.
async function createReport(type, user, targetId, payload = {}, ip) {
  const cfg = model.config(type);
  const id = Number(targetId);
  if (!Number.isInteger(id) || id < 1) throw err('Identificador inválido.', 400);
  if (!(await model.targetExists(type, id))) throw err('Elemento reportado no encontrado.', 404);
  const motivo = cfg.motivoRequired ? normalizeMotivo(payload.motivo) : (payload.motivo === undefined ? null : normalizeMotivo(payload.motivo));
  const descripcion = normalizeDescripcion(payload.descripcion);
  if (await model.findOpenDuplicate(type, id, user.id)) throw err('Ya existe un reporte pendiente o revisado sobre este elemento.', 409);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const report = await model.create(type, { targetId: id, reporterId: user.id, motivo, descripcion }, conn);
    await notifyAdmins(conn, type, report.id);
    await logService.log(conn, {
      usuario_id: user.id,
      accion: meta(type).accion,
      entidad: meta(type).entidad,
      entidad_id: report.id,
      detalle: { target_id: id },
      ip
    });
    await conn.commit();
    return report;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function listAdmin(type, query = {}) {
  model.config(type);
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '20', 10) || 20, 1), 50);
  const estado = normalizeStateFilter(query.estado);
  const q = normalizeSearch(query.q);
  const sort = normalizeSort(query.sort);
  const reports = await model.list(type, { estado, q, sort, limit, offset: (page - 1) * limit });
  return { reports, pagination: { page, limit } };
}

// Resolver el reporte y, solo si el administrador lo selecciona explicitamente,
// aplicar una accion ya publicada sobre el target. Nunca automatica.
async function resolve(type, adminUser, reportId, payload = {}, ip) {
  model.config(type);
  const id = Number(reportId);
  if (!Number.isInteger(id) || id < 1) throw err('Identificador inválido.', 400);
  const existing = await model.findById(type, id);
  if (!existing) throw err('Reporte no encontrado.', 404);
  const estado = payload.estado === undefined ? undefined : normalizeStateFilter(payload.estado);
  const respuesta_admin = payload.respuesta_admin === undefined ? undefined : normalizeDescripcion(payload.respuesta_admin);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const updated = await model.update(type, id, { estado, respuesta_admin }, conn);
    let accionAplicada = null;
    if (payload.accion_target) {
      accionAplicada = await applyTargetAction(conn, type, existing, payload.accion_target);
    }
    await logService.log(conn, {
      usuario_id: adminUser.id,
      accion: 'reporte_resuelto',
      entidad: meta(type).entidad,
      entidad_id: id,
      detalle: { estado: updated.estado, accion_target: accionAplicada },
      ip
    });
    await conn.commit();
    return { report: updated, accion_target: accionAplicada };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Solo operaciones ya publicadas sobre cada target.
async function applyTargetAction(conn, type, report, accion) {
  if (type === 'stores') {
    if (!['pausada', 'suspendida', 'activa'].includes(accion)) throw err('accion_target inválida para tiendas.', 400);
    await conn.query('UPDATE tiendas SET estado=? WHERE id=?', [accion, report.tienda_id]);
    return accion;
  }
  if (type === 'reviews') {
    if (!['aprobada', 'rechazada', 'ocultada'].includes(accion)) throw err('accion_target inválida para reseñas.', 400);
    await conn.query('UPDATE resenas SET estado=? WHERE id=?', [accion, report.resena_id]);
    return accion;
  }
  if (type === 'messages') {
    if (accion !== 'eliminar') throw err('accion_target inválida para mensajes.', 400);
    await conn.query('UPDATE mensajes SET eliminado=TRUE WHERE id=?', [report.mensaje_id]);
    return accion;
  }
  throw err('Tipo de reporte no soportado.', 400);
}

module.exports = { createReport, listAdmin, resolve, notifyAdmins, REPORT_STATES };
