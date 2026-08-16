const { pool } = require('../config/database');

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    nombre: user.nombre,
    correo: user.correo,
    telefono: user.telefono,
    fecha_nacimiento: user.fecha_nacimiento,
    estado: user.estado,
    rol: user.rol,
    acepta_terminos: Boolean(user.acepta_terminos),
    terminos_version: user.terminos_version,
    terminos_aceptados_at: user.terminos_aceptados_at,
    deleted_at: user.deleted_at,
    ultimo_login_at: user.ultimo_login_at,
    modo_oscuro: Boolean(user.modo_oscuro),
    preferencias_notificaciones: user.preferencias_notificaciones,
    cuenta_desactivada: Boolean(user.cuenta_desactivada),
    fecha_desactivacion: user.fecha_desactivacion,
    solicitud_eliminacion_estado: user.solicitud_eliminacion_estado,
    solicitud_eliminacion_fecha: user.solicitud_eliminacion_fecha,
    solicitud_eliminacion_respuesta_admin: user.solicitud_eliminacion_respuesta_admin,
    anonimizado: Boolean(user.anonimizado),
    foto_perfil_url: user.foto_perfil_url,
    descripcion_personal: user.descripcion_personal,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

const USER_SELECT = `SELECT u.id, u.rol_id, u.nombre, u.correo, u.password_hash, u.telefono, u.fecha_nacimiento,
            u.estado, u.token_version, u.acepta_terminos, u.terminos_version, u.terminos_aceptados_at,
            u.deleted_at, u.ultimo_login_at, u.modo_oscuro, u.preferencias_notificaciones,
            u.cuenta_desactivada, u.fecha_desactivacion, u.solicitud_eliminacion_estado,
            u.solicitud_eliminacion_fecha, u.solicitud_eliminacion_respuesta_admin, u.anonimizado,
            u.created_at, u.updated_at, r.nombre AS rol,
            COALESCE(p.foto_perfil_url, p.foto_url) AS foto_perfil_url,
            COALESCE(p.descripcion_personal, p.descripcion) AS descripcion_personal
     FROM usuarios u
     INNER JOIN roles r ON r.id = u.rol_id
     LEFT JOIN perfiles_usuarios p ON p.usuario_id = u.id`;

async function findUserByEmail(correo) {
  const [rows] = await pool.query(`${USER_SELECT} WHERE u.correo = ? LIMIT 1`, [correo]);
  return rows[0] || null;
}

async function findUserById(id, conn = pool) {
  const [rows] = await conn.query(`${USER_SELECT} WHERE u.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function createUser({ rolId, nombre, correo, passwordHash, telefono = null, fechaNacimiento = null, aceptaTerminos = false, terminosVersion = null }, conn = pool) {
  const [result] = await conn.query(
    `INSERT INTO usuarios (rol_id, nombre, correo, password_hash, telefono, fecha_nacimiento, estado, acepta_terminos, terminos_version, terminos_aceptados_at)
     VALUES (?, ?, ?, ?, ?, ?, 'activo', ?, ?, CASE WHEN ? THEN NOW() ELSE NULL END)`,
    [rolId, nombre, correo, passwordHash, telefono, fechaNacimiento, aceptaTerminos, terminosVersion, aceptaTerminos]
  );
  return findUserById(result.insertId);
}

async function updateLastLogin(id){ await pool.query('UPDATE usuarios SET ultimo_login_at=NOW() WHERE id=?',[id]); }
async function updatePassword(id, passwordHash, conn = pool) {
  const [result] = await conn.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  return result.affectedRows;
}
async function updateBasic(id,{nombre,telefono}){ await pool.query('UPDATE usuarios SET nombre=COALESCE(?,nombre), telefono=? WHERE id=?',[nombre||null, telefono ?? null, id]); return findUserById(id); }
async function upgradeToSeller(id, rolId, fechaNacimiento = null) {
  await pool.query(
    `UPDATE usuarios
     SET rol_id = ?,
         fecha_nacimiento = COALESCE(fecha_nacimiento, ?)
     WHERE id = ? AND estado = 'activo'`,
    [rolId, fechaNacimiento, id]
  );
  return findUserById(id);
}

async function reactivateAccount(id, conn = pool) {
  const [result] = await conn.query(
    `UPDATE usuarios
     SET estado = 'activo',
         cuenta_desactivada = FALSE,
         fecha_desactivacion = NULL,
         deleted_at = NULL
     WHERE id = ?
       AND cuenta_desactivada = TRUE
       AND anonimizado = FALSE
       AND solicitud_eliminacion_estado <> 'aprobada'
       AND estado = 'inactivo'`,
    [id]
  );
  return result.affectedRows;
}
async function updateUserStatusConditional(id, estado, expectedEstado, conn = pool) {
  const [result] = await conn.query('UPDATE usuarios SET estado=? WHERE id=? AND estado=?', [estado, id, expectedEstado]);
  return result.affectedRows;
}
async function incrementTokenVersion(id, conn = pool) {
  const [result] = await conn.query('UPDATE usuarios SET token_version = token_version + 1 WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = { sanitizeUser, findUserByEmail, findUserById, createUser, updateLastLogin, updatePassword, updateBasic, upgradeToSeller, reactivateAccount, updateUserStatusConditional, incrementTokenVersion };
