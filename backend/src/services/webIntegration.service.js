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
async function sellerProducts(user){ return model.sellerProducts(user.id); }
async function sellerReviews(user){ return model.sellerReviews(user.id); }
async function sellerReputation(user){ return model.sellerReputation(user.id); }
async function sellerCommissions(user){ return model.sellerCommissions(user.id); }
async function adminStores(query){ return model.adminStores(query); }
async function adminPayments(query){ return model.adminPayments(query); }
async function adminShipments(query){ return model.adminShipments(query); }
async function adminReviews(query){ return model.adminReviews(query); }
async function adminCommissions(query){ return model.adminCommissions(query); }
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
module.exports={sellerProducts,sellerReviews,sellerReputation,sellerCommissions,adminStores,adminPayments,adminShipments,adminReviews,adminCommissions,updateCommissionStatus,adminCommissionSettings,updateAdminCommissionSettings};
