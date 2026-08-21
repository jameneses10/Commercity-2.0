const { pool } = require('../config/database');
const cartService=require('./cart.service');
const addressService=require('./address.service');
const orderModel=require('../models/order.model');
const logService=require('./log.service');
function err(m,s){const e=new Error(m);e.statusCode=s;return e;}
async function createOrder(user,{direccion_id,items}){
 await addressService.own(direccion_id,user);
 const cart=await cartService.validateCart(user,items);
 if(cart.price_changes.length) throw err(cart.price_changes.map(change=>change.reason).join(' ')||'Los precios del carrito cambiaron.',409);
 if(cart.invalid_items.length) throw err('El carrito contiene productos inválidos.',409);
 const conn=await pool.getConnection();
 try{ await conn.beginTransaction();
  const id=await orderModel.createWithDetails(conn,{comprador_id:user.id,direccion_id,total:cart.total,items:cart.valid_items});
  await logService.log(conn,{usuario_id:user.id,accion:'pedido_creado',entidad:'pedidos',entidad_id:id,detalle:{total:cart.total,items:cart.valid_items.length}});
  await conn.commit();
  return getOrderForUser(id,user);
 }catch(e){await conn.rollback(); throw e;} finally{conn.release();}
}
async function formatOrder(o){ return {...o, details: await orderModel.getDetails(o.id)}; }
async function getOrderForUser(id,user){
 const o=await orderModel.findById(id); if(!o) throw err('Pedido no encontrado.',404);
 if(user.rol==='comprador'&&o.comprador_id!==user.id) throw err('No tiene permisos para ver este pedido.',403);
 if(user.rol==='vendedor'&&!(await orderModel.sellerParticipates(id,user.id))) throw err('No tiene permisos para ver este pedido.',403);
 return formatOrder(o);
}
async function myOrders(user){return orderModel.listBuyer(user.id)}
async function sellerOrders(user){return orderModel.listSeller(user.id)}
async function adminOrders(){return orderModel.listAll()}
module.exports={createOrder,getOrderForUser,myOrders,sellerOrders,adminOrders};
