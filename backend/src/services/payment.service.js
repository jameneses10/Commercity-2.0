const crypto=require('crypto');
const { pool }=require('../config/database');
const orderModel=require('../models/order.model');
const paymentModel=require('../models/payment.model');
const commissionService=require('./commission.service');
const shipmentModel=require('../models/shipment.model');
const notificationService=require('./notification.service');
const logService=require('./log.service');
const EFFECTIVE_PRICE_EXPR=`ROUND(CASE WHEN p.descuento_porcentaje > 0 THEN p.precio * (1 - p.descuento_porcentaje / 100) ELSE p.precio END, 2)`;
function err(m,s){const e=new Error(m);e.statusCode=s;return e;}
function toCents(value){return Math.round(Number(value)*100);}
function ensureCurrentPrice(detail,product){if(toCents(detail.precio_unitario)!==toCents(product.precio_final)) throw err('Los precios del pedido cambiaron.',409);}
function buildRequiredQuantityByProduct(details){const required=new Map(); for(const d of details){const productId=Number(d.producto_id); const quantity=Number(d.cantidad); required.set(productId,(required.get(productId)??0)+quantity);} return required;}
function reference(prefix){return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`}
async function processPayment(user,{pedido_id,card_number}){
 const approved=card_number==='4111111111111111'; const rejected=card_number==='4000000000000002'||!approved;
 const conn=await pool.getConnection();
 try{ await conn.beginTransaction();
  const order=await orderModel.lockOrder(conn,pedido_id); if(!order) throw err('Pedido no encontrado.',404);
  if(order.comprador_id!==user.id) throw err('No tiene permisos para pagar este pedido.',403);
  if(order.estado_pago==='pagado') throw err('El pedido ya fue pagado y no puede procesarse dos veces.',409);
  if(order.estado_pago!=='pendiente') throw err('El pedido no está pendiente de pago.',409);
  if(rejected){ await paymentModel.create(conn,{pedido_id,metodo:'sandbox_card',referencia:reference('REJ'),estado:'rechazado',mensaje:'Pago sandbox rechazado.'}); await orderModel.updateStatus(conn,pedido_id,{estado_pago:'rechazado',estado_general:'creado'}); await notificationService.create(conn,order.comprador_id,{tipo:'pago_rechazado',titulo:'Pago rechazado',mensaje:`El pago del pedido ${pedido_id} fue rechazado.`}); await logService.log(conn,{usuario_id:user.id,accion:'pago_rechazado',entidad:'pedidos',entidad_id:pedido_id,detalle:{metodo:'sandbox_card'}}); await conn.commit(); return {estado:'rechazado',mensaje:'Pago sandbox rechazado.'}; }
  const details=await orderModel.getDetailsConn(conn,pedido_id);
  const requiredByProduct=buildRequiredQuantityByProduct(details);
  for(const d of details){ const [rows]=await conn.query(`SELECT p.id,p.stock,p.estado,${EFFECTIVE_PRICE_EXPR} AS precio_final FROM productos p WHERE p.id=? FOR UPDATE`,[d.producto_id]); const p=rows[0]; if(!p||p.estado!=='activo') throw err('Producto no disponible para pago.',409); if(Number(p.stock)<requiredByProduct.get(Number(d.producto_id))) throw err('Stock insuficiente al pagar.',409); ensureCurrentPrice(d,p); }
  await paymentModel.create(conn,{pedido_id,metodo:'sandbox_card',referencia:reference('APR'),estado:'aprobado',mensaje:'Pago sandbox aprobado.'});
  await orderModel.updateStatus(conn,pedido_id,{estado_pago:'pagado',estado_general:'procesando'});
  for(const d of details){ await conn.query(`UPDATE productos SET estado=CASE WHEN stock = ? THEN 'agotado' ELSE estado END, stock=stock-? WHERE id=?`,[d.cantidad,d.cantidad,d.producto_id]); const [[prod]]=await conn.query('SELECT p.stock,p.tienda_id,t.usuario_id vendedor_id,p.nombre FROM productos p INNER JOIN tiendas t ON t.id=p.tienda_id WHERE p.id=?',[d.producto_id]); if(prod&&Number(prod.stock)===0) await notificationService.create(conn,prod.vendedor_id,{tipo:'producto_agotado',titulo:'Producto agotado',mensaje:`El producto ${prod.nombre} quedó sin stock.`}); }
  await commissionService.createCommissions(conn,pedido_id,details);
  const createdShipments=await shipmentModel.createMissingForPaidOrder(conn,pedido_id);
  await notificationService.create(conn,order.comprador_id,{tipo:'pago_aprobado',titulo:'Pago aprobado',mensaje:`El pago del pedido ${pedido_id} fue aprobado.`});
  const [sellerRows]=await conn.query(`SELECT DISTINCT t.usuario_id vendedor_id FROM pedido_detalles d INNER JOIN tiendas t ON t.id=d.tienda_id WHERE d.pedido_id=?`,[pedido_id]);
  for(const s of sellerRows){ await notificationService.create(conn,s.vendedor_id,{tipo:'nuevo_pedido',titulo:'Nuevo pedido recibido',mensaje:`Tienes un nuevo pedido pagado: ${pedido_id}.`}); }
  await logService.log(conn,{usuario_id:user.id,accion:'pago_aprobado',entidad:'pedidos',entidad_id:pedido_id,detalle:{createdShipments}});
  await conn.commit(); return {estado:'aprobado',mensaje:'Pago sandbox aprobado.',envios_creados:createdShipments};
 }catch(e){await conn.rollback(); throw e;} finally{conn.release();}
}
async function webhookAdmin({pedido_id,approved}){
 const conn=await pool.getConnection();
 try{ await conn.beginTransaction();
  const order=await orderModel.lockOrder(conn,pedido_id); if(!order) throw err('Pedido no encontrado.',404); if(order.estado_pago==='pagado') throw err('El pedido ya fue procesado.',409); if(order.estado_pago!=='pendiente') throw err('El pedido no está pendiente.',409);
  if(!approved){ await paymentModel.create(conn,{pedido_id,metodo:'sandbox_webhook',referencia:reference('WH-REJ'),estado:'rechazado',mensaje:'Webhook sandbox rechazado.'}); await orderModel.updateStatus(conn,pedido_id,{estado_pago:'rechazado',estado_general:'creado'}); await conn.commit(); return {estado:'rechazado'}; }
  const details=await orderModel.getDetailsConn(conn,pedido_id);
  const requiredByProduct=buildRequiredQuantityByProduct(details);
  for(const d of details){ const [rows]=await conn.query(`SELECT p.id,p.stock,p.estado,${EFFECTIVE_PRICE_EXPR} AS precio_final FROM productos p WHERE p.id=? FOR UPDATE`,[d.producto_id]); const p=rows[0]; if(!p||p.estado!=='activo'||Number(p.stock)<requiredByProduct.get(Number(d.producto_id))) throw err('Producto no disponible para webhook.',409); ensureCurrentPrice(d,p); }
  await paymentModel.create(conn,{pedido_id,metodo:'sandbox_webhook',referencia:reference('WH-APR'),estado:'aprobado',mensaje:'Webhook sandbox aprobado.'}); await orderModel.updateStatus(conn,pedido_id,{estado_pago:'pagado',estado_general:'procesando'});
  for(const d of details){ await conn.query(`UPDATE productos SET estado=CASE WHEN stock = ? THEN 'agotado' ELSE estado END, stock=stock-? WHERE id=?`,[d.cantidad,d.cantidad,d.producto_id]); }
  await commissionService.createCommissions(conn,pedido_id,details); await conn.commit(); return {estado:'aprobado'};
 }catch(e){await conn.rollback(); throw e;} finally{conn.release();}
}
module.exports={processPayment,webhookAdmin};
