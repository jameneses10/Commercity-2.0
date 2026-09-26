const model = require('../models/webIntegration.model');
const logService = require('./log.service');
const platformSettingsModel = require('../models/platformSettings.model');
const { pool } = require('../config/database');
function id(value) { const n=Number(value); if(!Number.isInteger(n)||n<1){ const e=new Error('Identificador inválido.'); e.statusCode=400; throw e; } return n; }
function normalizePercentage(value){
  const n = Number(value);
  if(value===null || value===undefined || (typeof value==='string' && value.trim()==='') || !Number.isFinite(n) || n<0 || n>100){
    const e=new Error('Porcentaje de comisión inválido.'); e.statusCode=400; throw e;
  }
  return Math.round(n*100)/100;
}
function normalizePositiveIntFilter(value, fieldLabel){
  if(value===undefined) return undefined;
  const n=Number(value);
  if(value===null || (typeof value==='string' && value.trim()==='') || !Number.isInteger(n) || n<1){
    const e=new Error(`${fieldLabel} inválido.`); e.statusCode=400; throw e;
  }
  return n;
}
function normalizeDateOnly(value, fieldLabel){
  if(value===undefined) return undefined;
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)){ const e=new Error(`${fieldLabel} inválida.`); e.statusCode=400; throw e; }
  const d=new Date(`${value}T00:00:00Z`);
  if(Number.isNaN(d.getTime()) || d.toISOString().slice(0,10)!==value){ const e=new Error(`${fieldLabel} inválida.`); e.statusCode=400; throw e; }
  return value;
}
function normalizeProductStateFilter(value){
  if(value===undefined) return undefined;
  if(!['activo','agotado','oculto','eliminado'].includes(value)){ const e=new Error('estado inválido.'); e.statusCode=400; throw e; }
  return value;
}
function normalizeSearchFilter(value){
  if(value===undefined) return undefined;
  if(typeof value!=='string'){ const e=new Error('q inválido.'); e.statusCode=400; throw e; }
  const trimmed=value.trim();
  if(trimmed==='') return undefined;
  if(trimmed.length>120){ const e=new Error('q inválido.'); e.statusCode=400; throw e; }
  return trimmed;
}
function normalizeSortFilter(value){
  if(value===undefined) return undefined;
  if(typeof value!=='string'){ const e=new Error('sort inválido.'); e.statusCode=400; throw e; }
  const trimmed=value.trim();
  if(trimmed==='') return undefined;
  if(!['newest','oldest'].includes(trimmed)){ const e=new Error('sort inválido.'); e.statusCode=400; throw e; }
  return trimmed;
}
function normalizeStoreStatusFilter(value){
  if(value===undefined) return undefined;
  if(typeof value!=='string' || !['activa','pausada','suspendida'].includes(value)){ const e=new Error('status inválido.'); e.statusCode=400; throw e; }
  return value;
}
function normalizePaymentStateFilter(value){
  if(value===undefined) return undefined;
  if(typeof value!=='string' || !['pendiente','aprobado','rechazado'].includes(value)){ const e=new Error('estado inválido.'); e.statusCode=400; throw e; }
  return value;
}
function normalizeAdminCommissionFilters(query){
  const pedido_id = normalizePositiveIntFilter(query.pedido_id, 'pedido_id');
  const vendedor_id = normalizePositiveIntFilter(query.vendedor_id, 'vendedor_id');
  const fecha_desde = normalizeDateOnly(query.fecha_desde, 'fecha_desde');
  const fecha_hasta = normalizeDateOnly(query.fecha_hasta, 'fecha_hasta');
  if(fecha_desde && fecha_hasta && fecha_desde > fecha_hasta){ const e=new Error('fecha_desde no puede ser posterior a fecha_hasta.'); e.statusCode=400; throw e; }
  let fecha_hasta_exclusiva;
  if(fecha_hasta){ const d=new Date(`${fecha_hasta}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+1); fecha_hasta_exclusiva=d.toISOString().slice(0,10); }
  return { pedido_id, vendedor_id, fecha_desde, fecha_hasta_exclusiva };
}
async function sellerProducts(user){ return model.sellerProducts(user.id); }
async function sellerReviews(user){ return model.sellerReviews(user.id); }
async function sellerReputation(user){ return model.sellerReputation(user.id); }
async function sellerCommissions(user){ return model.sellerCommissions(user.id); }
async function adminStores(query){
  const q = normalizeSearchFilter(query.q);
  const status = normalizeStoreStatusFilter(query.status);
  const sort = normalizeSortFilter(query.sort);
  return model.adminStores({ limit: query.limit, page: query.page, q, status, sort });
}
async function adminPayments(query){
  const q = normalizeSearchFilter(query.q);
  const estado = normalizePaymentStateFilter(query.estado);
  const sort = normalizeSortFilter(query.sort);
  return model.adminPayments({ limit: query.limit, page: query.page, q, estado, sort });
}
async function adminShipments(query){ return model.adminShipments(query); }
async function adminReviews(query){ return model.adminReviews(query); }
async function adminCommissions(query){
  const filters = normalizeAdminCommissionFilters(query);
  return model.adminCommissions({ limit: query.limit, page: query.page, ...filters });
}
async function adminProducts(query){
  const store_id = normalizePositiveIntFilter(query.store_id, 'store_id');
  const category_id = normalizePositiveIntFilter(query.category_id, 'category_id');
  const vendedor_id = normalizePositiveIntFilter(query.vendedor_id, 'vendedor_id');
  const estado = normalizeProductStateFilter(query.estado);
  const q = normalizeSearchFilter(query.q);
  const sort = normalizeSortFilter(query.sort);
  return model.adminProducts({ limit: query.limit, page: query.page, store_id, category_id, vendedor_id, estado, q, sort });
}
async function updateCommissionStatus(admin, commissionId, body, ip){
  const updated = await model.updateCommissionStatus(id(commissionId), body.estado);
  await logService.log(null,{usuario_id:admin.id,accion:'comision_estado_actualizado',entidad:'comisiones',entidad_id:updated.id,detalle:{estado:body.estado},ip});
  return updated;
}
async function adminCommissionSettings(){ return platformSettingsModel.getCommissionSettings(pool); }
async function updateAdminCommissionSettings(admin, body, ip){
  const porcentaje = normalizePercentage(body.porcentaje_comision);
  const updated = await platformSettingsModel.updateCommissionRate(pool, porcentaje);
  await logService.log(null,{usuario_id:admin.id,accion:'comision_plataforma_actualizada',entidad:'configuracion_plataforma',entidad_id:updated.id,detalle:{porcentaje_comision:porcentaje},ip});
  return updated;
}
module.exports={sellerProducts,sellerReviews,sellerReputation,sellerCommissions,adminStores,adminPayments,adminShipments,adminReviews,adminCommissions,adminProducts,updateCommissionStatus,adminCommissionSettings,updateAdminCommissionSettings};
