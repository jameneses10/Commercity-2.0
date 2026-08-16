const { pool } = require('../config/database');
const model = require('../models/adminStats.model');
const { applyUserStatusTransition } = require('./userStatusTransition.service');
const notification = require('./notification.service');
const logService = require('./log.service');

function err(m, s) { const e = new Error(m); e.statusCode = s; return e; }

function mapUserStatusTransitionError(error) {
  if (error.code === 'USER_STATUS_INVALID_TARGET') return err('Estado no permitido.', 400);
  if (error.code === 'USER_STATUS_TARGET_NOT_FOUND') return err('Usuario no encontrado.', 404);
  if (error.code === 'USER_STATUS_CONFLICT') return err('El estado del usuario cambió. Intente nuevamente.', 409);
  if (error.code === 'USER_TOKEN_VERSION_UPDATE_FAILED') return err('Error al actualizar el estado del usuario.', 500);
  return error;
}

async function dashboardStats() { return model.dashboardStats(); }

async function listUsers(query) {
  const limit = Math.min(Math.max(parseInt(query.limit || '50', 10), 1), 100);
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  return { users: await model.listUsers({ limit, offset: (page - 1) * limit }), pagination: { page, limit } };
}

async function updateUserStatus(admin, id, estado, ip) {
  if (!['activo', 'inactivo', 'baneado'].includes(estado)) throw err('Estado no permitido.', 400);
  if (Number(admin.id) === Number(id) && estado !== 'activo') throw err('No puede inactivar o banear su propia cuenta.', 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    try {
      await applyUserStatusTransition({
        conn,
        userId: id,
        requestedEstado: estado
      });
    } catch (error) {
      throw mapUserStatusTransitionError(error);
    }

    await notification.create(conn, id, {
      tipo: 'estado_cuenta',
      titulo: 'Estado de cuenta actualizado',
      mensaje: `Tu cuenta ahora está en estado ${estado}.`,
      entidad_tipo: 'usuarios',
      entidad_id: id,
      url_destino: '/pages/account-settings.html'
    });

    await logService.log(conn, {
      usuario_id: admin.id,
      accion: 'usuario_estado_actualizado',
      entidad: 'usuarios',
      entidad_id: id,
      detalle: { estado },
      ip
    });

    const updated = await model.findUser(id, conn);
    await conn.commit();
    return updated;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { dashboardStats, listUsers, updateUserStatus };
