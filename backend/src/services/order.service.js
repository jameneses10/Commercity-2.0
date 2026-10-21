const { pool } = require('../config/database');
const cartService=require('./cart.service');
const cartModel=require('../models/cartPersistent.model');
const addressService=require('./address.service');
const orderModel=require('../models/order.model');
const comprobanteModel=require('../models/comprobante.model');
const logService=require('./log.service');
function err(m,s){const e=new Error(m);e.statusCode=s;return e;}
/* #81: el carrito se bloquea, se valida y se CONSUME en la misma transaccion
   que crea el pedido. Antes nada ataba el carrito al pedido: medido sobre la
   API real, cinco checkouts simultaneos del mismo carrito producian cinco
   pedidos, cinco pagos aprobados y cinco descuentos de existencias.
   `items` llega del validador HTTP pero no se usa: la fuente de verdad es el
   carrito persistente. */
async function createOrder(user,{direccion_id,items}){
 await addressService.own(direccion_id,user);
 const conn=await pool.getConnection();
 let confirmada=false;
 try{ await conn.beginTransaction();
  const carritoId=await cartModel.lockActiveCart(user.id,conn);
  const cart=await cartService.validateCart(user,conn);
  if(cart.price_changes.length||cart.invalid_items.length){
   /* El rechazo se CONFIRMA en vez de revertirse. Los snapshots de precio ya
      se escribieron en esta transaccion y deben sobrevivir: si se perdieran,
      el siguiente intento volveria a comparar contra el precio viejo y el
      comprador quedaria atrapado recibiendo el mismo 409 para siempre. Aqui
      no se ha creado pedido ni consumido nada, asi que confirmar solo
      persiste los snapshots. */
   await conn.commit(); confirmada=true;
   if(cart.price_changes.length) throw err(cart.price_changes.map(change=>change.reason).join(' ')||'Los precios del carrito cambiaron.',409);
   throw err('El carrito contiene productos inválidos.',409);
  }
  const id=await orderModel.createWithDetails(conn,{comprador_id:user.id,direccion_id,total:cart.total,items:cart.valid_items});
  await cartModel.consumeItems(carritoId,conn);
  await logService.log(conn,{usuario_id:user.id,accion:'pedido_creado',entidad:'pedidos',entidad_id:id,detalle:{total:cart.total,items:cart.valid_items.length,estado_pago:'pendiente',estado_general:'creado'}});
  await conn.commit(); confirmada=true;
  return getOrderForUser(id,user);
 }catch(e){ if(!confirmada) await conn.rollback(); throw e;} finally{conn.release();}
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
/* RNF-007: la paginacion llegaba al modelo como CADENA y reventaba la consulta.
   adminOrdersValidator declara query('page').isInt().toInt() y lo mismo para
   limit, pero en Express 5 `req.query` es de solo lectura, asi que los
   sanitizadores de express-validator sobre query NO persisten: el valor sigue
   siendo "20" y la validacion pasa con cero errores. Fallo silencioso.
   listAll hacia `offset=(page-1)*limit`, que resulta numero por la aritmetica,
   y empujaba `limit` sin convertir a `LIMIT ?`; mysql2 lo escapaba como
   LIMIT '20' y MySQL rechazaba la sentencia. Resultado medido: 500 en
   GET /admin/orders siempre que la query incluyera limit.
   La normalizacion va aqui y no en el modelo, que debe recibir los filtros ya
   normalizados -- mismo criterio que product.service. Solo page y limit: los
   identificadores viajan como parametros en comparaciones `= ?`, donde mysql2
   los compara correctamente y no hay defecto observable. */
async function adminOrders(filters={}){
 const normalizados={
  ...filters,
  page: filters.page===undefined ? 1 : Number(filters.page),
  limit: filters.limit===undefined ? 50 : Number(filters.limit),
 };
 const {scope,tienda_id,comprador_id,vendedor_id,estado_pago,estado_envio,fecha}=normalizados;
 const hasBusinessFilter=comprador_id!==undefined||vendedor_id!==undefined||estado_pago!==undefined||estado_envio!==undefined||fecha!==undefined;
 if(scope==='all'&&tienda_id!==undefined) throw err('No puede combinar Todas las tiendas con una tienda específica.',400);
 if(scope!=='all'&&tienda_id===undefined) throw err('Debe indicar una tienda específica o seleccionar Todas las tiendas.',400);
 if(scope==='all'&&!hasBusinessFilter) throw err('Seleccionar Todas las tiendas requiere aplicar al menos un filtro.',400);
 return orderModel.listAll(normalizados);
}
async function getComprobanteForUser(id,user){
 await getOrderForUser(id,user);
 const comprobante=await comprobanteModel.findDetailByPedidoId(id);
 if(!comprobante) throw err('Comprobante no disponible para este pedido.',404);
 return comprobante;
}
module.exports={createOrder,getOrderForUser,myOrders,sellerOrders,adminOrders,getComprobanteForUser};
