const { hashPassword } = require('../utils/password');
const crypto = require('crypto');

async function anonymizeAccount(userId, respuesta_admin, conn) {
  const anonEmail = `anon-${userId}-${Date.now()}@commercity.invalid`;
  const anonName = `Usuario anonimizado ${userId}`;
  const randomStr = crypto.randomBytes(32).toString('hex');
  const newHash = await hashPassword(randomStr);

  await conn.query(
    `UPDATE usuarios SET
       nombre = ?,
       correo = ?,
       telefono = NULL,
       fecha_nacimiento = NULL,
       estado = 'inactivo',
       cuenta_desactivada = TRUE,
       fecha_desactivacion = COALESCE(fecha_desactivacion, NOW()),
       deleted_at = COALESCE(deleted_at, NOW()),
       anonimizado = TRUE,
       solicitud_eliminacion_estado = 'aprobada',
       solicitud_eliminacion_respuesta_admin = ?,
       modo_oscuro = FALSE,
       preferencias_notificaciones = NULL,
       ultimo_login_at = NULL,
       password_hash = ?
     WHERE id = ?`,
    [anonName, anonEmail, respuesta_admin || null, newHash, userId]
  );

  await conn.query(
    `UPDATE perfiles_usuarios SET
       foto_url = NULL,
       foto_perfil_url = NULL,
       descripcion = NULL,
       descripcion_personal = NULL,
       ciudad = NULL,
       departamento = NULL,
       sitio_web = NULL
     WHERE usuario_id = ?`,
    [userId]
  );

  await conn.query(
    `UPDATE direcciones SET
       departamento = 'Anonimizado',
       ciudad = 'Anonimizado',
       direccion = 'Información anonimizada',
       codigo_postal = NULL,
       telefono = '0000000000',
       es_principal = FALSE
     WHERE usuario_id = ?`,
    [userId]
  );

  await conn.query(
    `UPDATE password_reset_tokens SET
       usado = TRUE,
       used_at = COALESCE(used_at, NOW())
     WHERE usuario_id = ?`,
    [userId]
  );

  await conn.query(`DELETE FROM favoritos WHERE usuario_id = ?`, [userId]);

  await conn.query(`DELETE FROM seguimientos WHERE seguidor_id = ? OR seguido_id = ?`, [userId, userId]);

  await conn.query(`UPDATE notificaciones SET deleted_at = COALESCE(deleted_at, NOW()) WHERE usuario_id = ?`, [userId]);

  await conn.query(`UPDATE tiendas SET estado = 'pausada' WHERE usuario_id = ? AND estado = 'activa'`, [userId]);
}

module.exports = { anonymizeAccount };
