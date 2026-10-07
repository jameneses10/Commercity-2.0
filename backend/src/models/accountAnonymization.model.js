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

  /* RNF-009: la cuenta bancaria simulada conservaba titular, numero y banco
     intactos tras anonimizar. titular es el nombre real del vendedor. La fila
     se conserva porque forma parte del historial de la tienda, pero
     desidentificada e inactiva; usuario_id y tienda_id se mantienen porque son
     las claves que sostienen la integridad historica. */
  await conn.query(
    `UPDATE cuentas_bancarias_vendedores SET
       banco = 'Anonimizado',
       tipo_cuenta = 'simulada',
       numero_cuenta_simulado = ?,
       titular = 'Usuario anonimizado',
       estado = 'inactiva'
     WHERE usuario_id = ?`,
    [`ANON-${userId}`, userId]
  );

  /* RNF-009: la aceptacion de terminos es prueba historica que debe
     conservarse -- usuario_id, version y aceptado_at siguen intactos -- pero no
     hay razon para retener indefinidamente los identificadores tecnicos de una
     cuenta ya anonimizada. */
  await conn.query(
    `UPDATE terminos_aceptaciones SET ip = NULL, user_agent = NULL WHERE usuario_id = ?`,
    [userId]
  );

  /* RNF-009: los logs conservan id, usuario_id, accion, entidad, entidad_id,
     created_at y su detalle de negocio -- RF-285 exige la trazabilidad, y
     RF-286 solo prohibe modificarlos DESDE LA INTERFAZ PUBLICA, no desde este
     flujo aprobado por un administrador.
     Se retira unicamente la IP de los logs cuyo actor es el usuario
     anonimizado. No se toca la IP de logs hechos por otro usuario aunque
     apunten a el: esa IP pertenece al actor, no al sujeto eliminado. */
  await conn.query(`UPDATE logs_acciones SET ip = NULL WHERE usuario_id = ?`, [userId]);

  /* Saneamiento SELECTIVO del detalle, por semantica del evento. Del inventario
     de las 33 acciones registradas, 'correo_cambiado' es la unica cuyo detalle
     guarda un dato personal explicito del propio actor. No se hace borrado
     recursivo por nombres de clave genericos: detalle.nombre puede ser el de
     una categoria o un producto, y destruirlo seria perder historial util. */
  await conn.query(
    `UPDATE logs_acciones
        SET detalle = JSON_REMOVE(detalle, '$.correo')
      WHERE usuario_id = ?
        AND accion = 'correo_cambiado'
        AND detalle IS NOT NULL
        AND JSON_CONTAINS_PATH(detalle, 'one', '$.correo')`,
    [userId]
  );

  /* El motivo de la solicitud de eliminacion es texto libre que escribe el
     propio usuario, y es justo el sitio donde alguien pone "me llamo X, mi
     correo es Y". Una vez aprobada la eliminacion deja de aportar valor de
     auditoria: la evidencia historica la dan usuario_id, accion, entidad,
     entidad_id y created_at, que se conservan. */
  await conn.query(
    `UPDATE logs_acciones
        SET detalle = JSON_REMOVE(detalle, '$.motivo')
      WHERE usuario_id = ?
        AND accion = 'solicitud_eliminacion_enviada'
        AND detalle IS NOT NULL
        AND JSON_CONTAINS_PATH(detalle, 'one', '$.motivo')`,
    [userId]
  );
}

module.exports = { anonymizeAccount };
