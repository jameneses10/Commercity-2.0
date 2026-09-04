const model=require('../models/shipment.model');
const notification=require('./notification.service');
const logService=require('./log.service');
function err(m,s){const e=new Error(m);e.statusCode=s;return e;}
const sellerTransitions={preparado:'en_camino',en_camino:'entregado'};
async function listBuyer(user){ return model.listBuyer(user.id); }
async function listSeller(user){ return model.listSeller(user.id); }
async function ownSellerShipment(id,user){ const s=await model.findById(id); if(!s) throw err('Envío no encontrado.',404); if(s.vendedor_id!==user.id) throw err('No tiene permisos sobre este envío.',403); return s; }
async function dispatch(id,user,body,ip){ const s=await ownSellerShipment(id,user); if(s.estado!=='pendiente') throw err('El envío solo puede prepararse cuando está pendiente.',409); const updated=await model.updateDispatch(id,body); await notification.create(null,updated.comprador_id,{tipo:'envio_preparado',titulo:'Tu envío fue preparado',mensaje:`La tienda registró la guía del pedido ${updated.pedido_id}.`}); await logService.log(null,{usuario_id:user.id,accion:'envio_despachado',entidad:'envios',entidad_id:id,detalle:{estado:'preparado'},ip}); return updated; }
async function updateStatus(id,user,estado,ip){ const s=await model.findById(id); if(!s) throw err('Envío no encontrado.',404); const isOwner=user.rol==='vendedor'&&s.vendedor_id===user.id; const isAdmin=user.rol==='administrador'; if(!isOwner&&!isAdmin) throw err('No tiene permisos sobre este envío.',403); if(isOwner&&sellerTransitions[s.estado]!==estado) throw err('Transición de estado no permitida para este envío.',409); const updated=await model.updateStatus(id,estado); await notification.create(null,updated.comprador_id,{tipo:'envio_estado',titulo:'Actualización de envío',mensaje:`Tu envío del pedido ${updated.pedido_id} cambió a ${estado}.`}); await logService.log(null,{usuario_id:user.id,accion:'envio_cambio_estado',entidad:'envios',entidad_id:id,detalle:{estado},ip}); return updated; }
module.exports={listBuyer,listSeller,dispatch,updateStatus};
