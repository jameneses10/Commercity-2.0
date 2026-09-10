const { pool } = require('../config/database');
const reviewModel=require('../models/review.model'); const shipmentModel=require('../models/shipment.model'); const reputation=require('./reputation.service'); const notification=require('./notification.service'); const logService=require('./log.service');
function err(m,s){const e=new Error(m);e.statusCode=s;return e;}
async function createReview(user,body,ip){
 const {producto_id,pedido_id,estrellas,comentario}=body;
 const [[order]]=await pool.query('SELECT * FROM pedidos WHERE id=?',[pedido_id]); if(!order) throw err('Pedido no encontrado.',404); if(order.comprador_id!==user.id) throw err('No tiene permisos para reseñar este pedido.',403); if(order.estado_pago!=='pagado') throw err('Solo se pueden reseñar pedidos pagados.',409);
 const [[detail]]=await pool.query('SELECT d.*, p.tienda_id, t.usuario_id vendedor_id FROM pedido_detalles d INNER JOIN productos p ON p.id=d.producto_id INNER JOIN tiendas t ON t.id=p.tienda_id WHERE d.pedido_id=? AND d.producto_id=?',[pedido_id,producto_id]); if(!detail) throw err('El producto no pertenece al pedido.',404); if(detail.vendedor_id===user.id) throw err('No puede reseñar su propio producto.',403);
 if(!(await shipmentModel.isDeliveredForProductOrder(producto_id,pedido_id))) throw err('Solo se puede reseñar cuando el envío fue entregado.',409);
 if(await reviewModel.duplicate(producto_id,user.id,pedido_id)) throw err('Ya existe una reseña para este producto en este pedido.',409);
 const conn=await pool.getConnection(); let r;
 try{ await conn.beginTransaction(); await conn.query('SELECT id FROM productos WHERE id=? FOR UPDATE',[producto_id]); r=await reviewModel.create({producto_id,comprador_id:user.id,pedido_id,estrellas,comentario},conn); await reputation.recalcProduct(producto_id,conn); await conn.commit(); }
 catch(e){ await conn.rollback(); throw e; }
 finally{ conn.release(); }
 await reputation.recalcStore(detail.tienda_id); await notification.create(null,detail.vendedor_id,{tipo:'nueva_resena',titulo:'Nueva reseña recibida',mensaje:`Recibiste una reseña de ${estrellas} estrellas.`}); await logService.log(null,{usuario_id:user.id,accion:'resena_creada',entidad:'resenas',entidad_id:r.id,detalle:{producto_id,pedido_id},ip}); return r;
}
async function listProduct(productId){ return reviewModel.listApproved(productId); }
async function moderate(admin,id,estado,ip){ const r=await reviewModel.findById(id); if(!r) throw err('Reseña no encontrada.',404); const updated=await reviewModel.updateStatus(id,estado); const [[p]]=await pool.query('SELECT tienda_id FROM productos WHERE id=?',[r.producto_id]); await reputation.recalcProduct(r.producto_id); if(p) await reputation.recalcStore(p.tienda_id); await logService.log(null,{usuario_id:admin.id,accion:'resena_moderada',entidad:'resenas',entidad_id:id,detalle:{estado},ip}); return updated; }
module.exports={createReview,listProduct,moderate};
