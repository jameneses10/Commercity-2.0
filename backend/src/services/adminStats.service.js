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
const REPORT_ESTADO_GENERAL=['creado','procesando','enviado','completado','cancelado'];
const REPORT_COMISION_ESTADO=['pendiente','pagada','revisada','rechazada'];
const REPORT_PRODUCTO_ESTADO=['activo','agotado','oculto','eliminado'];
const REPORT_USUARIO_ESTADO=['activo','bloqueado','inactivo','baneado'];
function normalizeReportDate(value){
  if(value===undefined) return undefined;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw err('fecha debe tener formato YYYY-MM-DD.',400);
  const [y,m,d]=value.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d) throw err('fecha inválida.',400);
  return value;
}
function normalizeReportId(value,name){
  if(value===undefined) return undefined;
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<1) throw err(`${name} inválido.`,400);
  return parsed;
}
function normalizeReportEnum(value,allowed,name){
  if(value===undefined) return undefined;
  if(typeof value!=='string'||!allowed.includes(value)) throw err(`${name} inválido.`,400);
  return value;
}
function normalizeReportFilters(query={}){
  if(query.estado_pago!==undefined) throw err('estado_pago no es un filtro admitido: los reportes de ventas, comisiones y productos se calculan solo sobre pedidos pagados.',400);
  if(query.estado!==undefined) throw err('estado no es un filtro admitido: utilice estado_general, comision_estado, producto_estado o usuario_estado.',400);
  const filters={
    fecha:normalizeReportDate(query.fecha),
    tienda_id:normalizeReportId(query.tienda_id,'tienda_id'),
    vendedor_id:normalizeReportId(query.vendedor_id,'vendedor_id'),
    producto_id:normalizeReportId(query.producto_id,'producto_id'),
    categoria_id:normalizeReportId(query.categoria_id,'categoria_id'),
    estado_general:normalizeReportEnum(query.estado_general,REPORT_ESTADO_GENERAL,'estado_general'),
    comision_estado:normalizeReportEnum(query.comision_estado,REPORT_COMISION_ESTADO,'comision_estado'),
    producto_estado:normalizeReportEnum(query.producto_estado,REPORT_PRODUCTO_ESTADO,'producto_estado'),
    usuario_estado:normalizeReportEnum(query.usuario_estado,REPORT_USUARIO_ESTADO,'usuario_estado'),
    limit:Math.min(Math.max(parseInt(query.limit||'10',10)||10,1),50)
  };
  Object.keys(filters).forEach(key=>{ if(filters[key]===undefined) delete filters[key]; });
  return filters;
}
async function reports(query={}){
  const filters=normalizeReportFilters(query);
  const data=await model.filteredReports(filters);
  return {filtros_aplicados:filters, ...data};
}


function normalizeSearchFilter(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw err('q inválido.', 400);
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > 120) throw err('q inválido.', 400);
  return trimmed;
}

function normalizeSortFilter(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw err('sort inválido.', 400);
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (!['newest', 'oldest'].includes(trimmed)) throw err('sort inválido.', 400);
  return trimmed;
}

function normalizeUserRoleFilter(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !['comprador', 'vendedor', 'administrador'].includes(value)) throw err('rol inválido.', 400);
  return value;
}

function normalizeUserStateFilter(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !['activo', 'inactivo', 'baneado'].includes(value)) throw err('estado inválido.', 400);
  return value;
}

async function listUsers(query) {
  const limit = Math.min(Math.max(parseInt(query.limit || '50', 10), 1), 100);
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const q = normalizeSearchFilter(query.q);
  const rol = normalizeUserRoleFilter(query.rol);
  const estado = normalizeUserStateFilter(query.estado);
  const sort = normalizeSortFilter(query.sort);
  return { users: await model.listUsers({ limit, offset: (page - 1) * limit, q, rol, estado, sort }), pagination: { page, limit } };
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

module.exports = { dashboardStats, reports, normalizeReportFilters, listUsers, updateUserStatus };
