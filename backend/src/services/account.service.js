const { pool } = require('../config/database');
const { findUserById, findUserByEmail, updatePassword, updateBasic, deactivate, upgradeToSeller, reactivateAccount, sanitizeUser, incrementTokenVersion } = require('../models/user.model');
const { findRoleByName } = require('../models/role.model');
const profileModel = require('../models/profile.model');
const { pauseStoreBySellerId } = require('../models/store.model');
const { getPendingOperations } = require('../models/accountOperations.model');
const { anonymizeAccount } = require('../models/accountAnonymization.model');
const notificationService = require('./notification.service');
const logService = require('./log.service');
const { comparePassword, hashPassword } = require('../utils/password');
const { isAdult } = require('../utils/age');
function err(m, s) { const e = new Error(m); e.statusCode = s; return e; }
function parsePrefs(v) { if (!v) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v; }
async function settings(userId) {
  const user = await findUserById(userId);
  if (!user) throw err('Usuario no encontrado.', 404);
  const profile = await profileModel.ensureProfile(userId);
  const pendingOperations = await getPendingOperations(userId);
  const account_status = {
    estado: user.estado,
    rol: user.rol,
    cuenta_desactivada: Boolean(user.cuenta_desactivada),
    solicitud_eliminacion_estado: user.solicitud_eliminacion_estado,
    solicitud_eliminacion_fecha: user.solicitud_eliminacion_fecha,
    anonimizado: Boolean(user.anonimizado),
    pending_operations: pendingOperations,
    can_deactivate: pendingOperations.total === 0
  };
  return {
    user: sanitizeUser(user),
    profile,
    settings: {
      modo_oscuro: Boolean(user.modo_oscuro),
      preferencias_notificaciones: parsePrefs(user.preferencias_notificaciones),
      cuenta_desactivada: Boolean(user.cuenta_desactivada),
      solicitud_eliminacion_estado: user.solicitud_eliminacion_estado,
      solicitud_eliminacion_fecha: user.solicitud_eliminacion_fecha,
      anonimizado: Boolean(user.anonimizado)
    },
    account_status
  };
}
async function updateSettings(userId, data, meta = {}) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction();
    await conn.query(`UPDATE usuarios SET nombre=COALESCE(?,nombre), telefono=?, modo_oscuro=COALESCE(?,modo_oscuro), preferencias_notificaciones=COALESCE(?, preferencias_notificaciones) WHERE id=?`, [data.nombre || null, data.telefono ?? null, data.modo_oscuro === undefined ? null : Boolean(data.modo_oscuro), data.preferencias_notificaciones === undefined ? null : JSON.stringify(data.preferencias_notificaciones), userId]);
    await logService.log(conn, { usuario_id:userId, accion:'configuracion_cuenta_actualizada', entidad:'usuario', entidad_id:userId, detalle:{ modo_oscuro:data.modo_oscuro, preferencias:data.preferencias_notificaciones !== undefined }, ip:meta.ip });
    await conn.commit(); return settings(userId);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
async function changePassword(userId, { currentPassword, newPassword, confirmPassword }, meta = {}) {
  if (newPassword !== confirmPassword) throw err('La nueva contraseña y su confirmación no coinciden.', 400);
  const user = await findUserById(userId); if (!user) throw err('Usuario no encontrado.', 404);
  const full = await findUserByEmail(user.correo); const ok = await comparePassword(currentPassword, full.password_hash);
  if (!ok) throw err('La contraseña actual no es correcta.', 400);
  const hash = await hashPassword(newPassword);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const passwordAffected = await updatePassword(userId, hash, conn);
    if (passwordAffected !== 1) {
      throw err('Error al actualizar la contraseña.', 500);
    }
    const versionAffected = await incrementTokenVersion(userId, conn);
    if (versionAffected !== 1) {
      throw err('Error al actualizar la contraseña.', 500);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  await notificationService.create(null, userId, { tipo:'password_cambiada', titulo:'Contraseña actualizada', mensaje:'Tu contraseña fue cambiada correctamente.', entidad_tipo:'usuario', entidad_id:userId });
  await logService.log(null, { usuario_id:userId, accion:'password_cambiada', entidad:'usuario', entidad_id:userId, ip:meta.ip });
  return { changed:true };
}
async function changeEmail(userId, { currentPassword, newEmail }, meta = {}) {
  const correo = String(newEmail || '').toLowerCase().trim();
  const user = await findUserById(userId); if (!user) throw err('Usuario no encontrado.', 404);
  const full = await findUserByEmail(user.correo); const ok = await comparePassword(currentPassword, full.password_hash);
  if (!ok) throw err('La contraseña actual no es correcta.', 400);
  const existing = await findUserByEmail(correo); if (existing && Number(existing.id) !== Number(userId)) throw err('El correo electrónico ya está registrado.', 409);
  await pool.query('UPDATE usuarios SET correo=? WHERE id=?', [correo, userId]);
  await notificationService.create(null, userId, { tipo:'correo_cambiado', titulo:'Correo actualizado', mensaje:'Tu correo electrónico fue actualizado.', entidad_tipo:'usuario', entidad_id:userId });
  await logService.log(null, { usuario_id:userId, accion:'correo_cambiado', entidad:'usuario', entidad_id:userId, detalle:{ correo }, ip:meta.ip });
  return { user: sanitizeUser(await findUserById(userId)) };
}
async function deactivateAccount(userId, meta = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const user = await findUserById(userId, conn);
    if (!user) throw err('Usuario no encontrado.', 404);

    const pending = await getPendingOperations(userId, conn);
    if (pending.total > 0) {
      const parts = [];
      if (pending.pedidos > 0) parts.push(`${pending.pedidos} pedido${pending.pedidos === 1 ? '' : 's'}`);
      if (pending.envios > 0) parts.push(`${pending.envios} envío${pending.envios === 1 ? '' : 's'}`);
      if (pending.devoluciones > 0) parts.push(`${pending.devoluciones} devolución${pending.devoluciones === 1 ? '' : 'es'}`);
      if (pending.reembolsos > 0) parts.push(`${pending.reembolsos} reembolso${pending.reembolsos === 1 ? '' : 's'}`);
      throw err(`No puede desactivar la cuenta mientras tenga operaciones pendientes: ${parts.join(', ')}.`, 409);
    }

    const [deactResult] = await conn.query("UPDATE usuarios SET estado='inactivo', cuenta_desactivada=TRUE, fecha_desactivacion=NOW(), deleted_at=NOW() WHERE id=? AND estado='activo'", [userId]);
    if (deactResult.affectedRows !== 1) {
      throw err('La cuenta ya no se encuentra activa.', 409);
    }

    if (user.rol === 'vendedor') {
      const pausedRows = await pauseStoreBySellerId(userId, conn);
      if (pausedRows > 0) {
        await logService.log(conn, { usuario_id: userId, accion: 'tienda_pausada_por_desactivacion', entidad: 'tienda', ip: meta.ip });
      }
    }

    await notificationService.create(conn, userId, { tipo:'cuenta_desactivada', titulo:'Cuenta desactivada', mensaje:'Tu cuenta fue desactivada temporalmente.', entidad_tipo:'usuario', entidad_id:userId });
    await logService.log(conn, { usuario_id:userId, accion:'cuenta_desactivada', entidad:'usuario', entidad_id:userId, ip:meta.ip });

    const versionAffected = await incrementTokenVersion(userId, conn);
    if (versionAffected !== 1) {
      throw err('Error al desactivar la cuenta.', 500);
    }

    await conn.commit();
    return { user: sanitizeUser(await findUserById(userId, conn)) };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
async function requestDeletion(userId, { motivo } = {}, meta = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const user = await findUserById(userId, conn);
    if (!user) throw err('Usuario no encontrado.', 404);
    if (user.anonimizado || user.solicitud_eliminacion_estado === 'aprobada') throw err('La cuenta ya fue procesada para eliminación.', 409);
    if (user.solicitud_eliminacion_estado === 'pendiente') throw err('Ya existe una solicitud de eliminación pendiente.', 409);

    await conn.query("UPDATE usuarios SET solicitud_eliminacion_estado='pendiente', solicitud_eliminacion_fecha=NOW(), solicitud_eliminacion_respuesta_admin=NULL WHERE id=?", [userId]);
    await notificationService.create(conn, userId, { tipo:'solicitud_eliminacion_enviada', titulo:'Solicitud de eliminación enviada', mensaje:'Tu solicitud quedó pendiente de revisión administrativa.', entidad_tipo:'usuario', entidad_id:userId });
    await logService.log(conn, { usuario_id:userId, accion:'solicitud_eliminacion_enviada', entidad:'usuario', entidad_id:userId, detalle:{ motivo: motivo || null }, ip:meta.ip });

    await conn.commit();
    return { requested:true, estado:'pendiente' };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
async function listDeleteRequests() {
  const [rows] = await pool.query(`SELECT u.id, u.nombre, u.correo, u.rol_id, r.nombre rol, u.estado, u.solicitud_eliminacion_estado, u.solicitud_eliminacion_fecha, u.solicitud_eliminacion_respuesta_admin, u.anonimizado FROM usuarios u INNER JOIN roles r ON r.id=u.rol_id WHERE u.solicitud_eliminacion_estado <> 'ninguna' ORDER BY u.solicitud_eliminacion_fecha DESC`);
  return { requests: rows };
}
async function getDeleteRequestDetail(userId) {
  const target = await findUserById(userId);
  if (!target) throw err('Usuario no encontrado.', 404);
  if (target.solicitud_eliminacion_estado === 'ninguna') throw err('El usuario no tiene solicitudes de eliminación.', 404);

  const pending = await getPendingOperations(userId);

  return {
    request: {
      id: target.id,
      nombre: target.nombre,
      correo: target.correo,
      rol: target.rol,
      estado: target.estado,
      solicitud_eliminacion_estado: target.solicitud_eliminacion_estado,
      solicitud_eliminacion_fecha: target.solicitud_eliminacion_fecha,
      solicitud_eliminacion_respuesta_admin: target.solicitud_eliminacion_respuesta_admin
    },
    pending_operations: pending,
    can_approve: pending.total === 0
  };
}
async function resolveDeleteRequest(adminId, userId, { estado, respuesta_admin }, meta = {}) {
  if (!['aprobada','rechazada'].includes(estado)) throw err('Estado no permitido.', 400);
  const conn = await pool.getConnection();
  try { await conn.beginTransaction();
    const current = await findUserById(userId, conn);
    if (!current) throw err('Usuario no encontrado.', 404);
    if (current.solicitud_eliminacion_estado !== 'pendiente') throw err('La solicitud no está pendiente.', 409);

    if (estado === 'aprobada') {
      const pending = await getPendingOperations(userId, conn);
      if (pending.total > 0) {
        const parts = [];
        if (pending.pedidos > 0) parts.push(`${pending.pedidos} pedido${pending.pedidos === 1 ? '' : 's'}`);
        if (pending.envios > 0) parts.push(`${pending.envios} envío${pending.envios === 1 ? '' : 's'}`);
        if (pending.devoluciones > 0) parts.push(`${pending.devoluciones} devolución${pending.devoluciones === 1 ? '' : 'es'}`);
        if (pending.reembolsos > 0) parts.push(`${pending.reembolsos} reembolso${pending.reembolsos === 1 ? '' : 's'}`);
        throw err(`No puede aprobar la eliminación mientras existan operaciones pendientes: ${parts.join(', ')}.`, 409);
      }
      await anonymizeAccount(userId, respuesta_admin, conn);
    } else {
      await conn.query("UPDATE usuarios SET solicitud_eliminacion_estado='rechazada', solicitud_eliminacion_respuesta_admin=? WHERE id=?", [respuesta_admin || null, userId]);
    }
    await notificationService.create(conn, userId, { tipo:'solicitud_eliminacion_resuelta', titulo: estado === 'aprobada' ? 'Eliminación aprobada' : 'Eliminación rechazada', mensaje: respuesta_admin || 'Tu solicitud de eliminación fue revisada.', entidad_tipo:'usuario', entidad_id:userId });
    await logService.log(conn, { usuario_id:adminId, accion: estado === 'aprobada' ? 'cuenta_anonimizada' : 'solicitud_eliminacion_rechazada', entidad:'usuario', entidad_id:userId, detalle:{ estado, respuesta_admin }, ip:meta.ip });
    await conn.commit(); return { user: sanitizeUser(await findUserById(userId)) };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
async function upgrade(userId, { acceptSellerTerms, seller_terms_accepted, fecha_nacimiento }) {
  if (!(acceptSellerTerms || seller_terms_accepted)) throw err('Debe aceptar las condiciones de vendedor.', 400);
  const user = await findUserById(userId);
  if (!user) throw err('Usuario no encontrado.', 404);
  if (user.rol === 'administrador') throw err('Un administrador no puede cambiarse a vendedor desde este flujo.', 403);
  if (user.rol !== 'comprador') throw err('Solo compradores activos pueden cambiar a vendedor.', 409);
  if (user.estado !== 'activo') throw err('Usuario no activo.', 403);

  const birthDateToUse = user.fecha_nacimiento || fecha_nacimiento;

  if (!birthDateToUse) {
    throw err('La fecha de nacimiento es obligatoria para activar las funciones de vendedor.', 400);
  }

  if (!isAdult(birthDateToUse)) {
    throw err('Para activar las funciones de vendedor debe tener al menos 18 años.', 400);
  }

  const role = await findRoleByName('vendedor');
  const updated = await upgradeToSeller(userId, role.id, !user.fecha_nacimiento ? fecha_nacimiento : null);
  return { user: sanitizeUser(updated) };
}
async function reactivate(userId, meta = {}) {
  const user = await findUserById(userId);
  if (!user) throw err('Usuario no encontrado.', 404);
  if (user.estado === 'activo' && !user.cuenta_desactivada) throw err('La cuenta ya se encuentra activa.', 409);
  if (user.anonimizado || user.solicitud_eliminacion_estado === 'aprobada') throw err('La cuenta no puede ser reactivada.', 409);
  if (!user.cuenta_desactivada) throw err('La cuenta no puede ser reactivada.', 409);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const affected = await reactivateAccount(userId, conn);
    if (affected === 0) {
      throw err('La cuenta no puede ser reactivada.', 409);
    }

    await notificationService.create(conn, userId, { tipo: 'cuenta_reactivada', titulo: 'Cuenta reactivada', mensaje: 'Tu cuenta fue reactivada correctamente.', entidad_tipo: 'usuario', entidad_id: userId });
    await logService.log(conn, { usuario_id: userId, accion: 'cuenta_reactivada', entidad: 'usuario', entidad_id: userId, ip: meta.ip });

    await conn.commit();
    return { reactivated: true };
  } catch (e) {
    await conn.rollback(); throw e;
  } finally {
    conn.release();
  }
}

module.exports={settings,updateSettings,changePassword,changeEmail,deactivateAccount,requestDeletion,listDeleteRequests,getDeleteRequestDetail,resolveDeleteRequest,upgrade,reactivate};
