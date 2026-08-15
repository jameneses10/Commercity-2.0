const { pool } = require('../config/database');
const model = require('../models/adminStats.model');
const { incrementTokenVersion } = require('../models/user.model');
const notification = require('./notification.service');
const logService = require('./log.service');

function err(m, s) { const e = new Error(m); e.statusCode = s; return e; }

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

    const user = await model.findUser(id, conn);
    if (!user) throw err('Usuario no encontrado.', 404);

    const isRealTransition = user.estado !== estado;
    const isRestrictiveTarget = estado === 'inactivo' || estado === 'baneado';
    const shouldIncrement = isRealTransition && isRestrictiveTarget;

    if (isRealTransition) {
      const statusAffected = await model.updateUserStatusConditional(id, estado, user.estado, conn);
      if (statusAffected !== 1) {
        throw err('El estado del usuario cambió. Intente nuevamente.', 409);
      }

      if (shouldIncrement) {
        const versionAffected = await incrementTokenVersion(id, conn);
        if (versionAffected !== 1) {
          throw err('Error al actualizar el estado del usuario.', 500);
        }
      }
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
