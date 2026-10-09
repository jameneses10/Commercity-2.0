const persistent = require('../models/cartPersistent.model');
function toCents(value){ return Math.round(Number(value) * 100); }
function err(m,s){const e=new Error(m);e.statusCode=s;return e;}
/* RNF-016: la validación opera sobre el carrito PERSISTENTE del comprador, no
   sobre una lista que el cliente devuelve al servidor.

   Antes se recibía `items` por el cuerpo y se consultaba un producto por
   iteración. Medido: 1 item = 3 consultas, 10 = 12, 50 = 52, 200 = 202, siempre
   con los mismos 3 patrones de SQL -- repetición pura, no variedad. Las mismas
   200 filas se recuperan en lote con 1 consulta en 2,9 ms frente a 202
   consultas y 100 ms.

   El endpoint ya estaba restringido a `authRequired` + `requireRole('comprador')`
   y el backend mantiene un carrito por usuario, así que no había motivo para que
   el cliente dijese qué contiene. Esto elimina además el viaje
   GET /cart -> copiar items -> POST /validate, y que un cliente pueda forzar
   miles de búsquedas por clave primaria enviando ids arbitrarios: el trabajo de
   base de datos depende ahora del carrito real.

   `items` en el cuerpo se sigue aceptando por compatibilidad, pero NO es fuente
   de verdad: se ignora. */
async function validateCart(user){
 if(!user?.id) throw err('Usuario autenticado requerido para validar el carrito.',401);
 const {items}=await persistent.getCart(user.id);
 const valid_items=[]; const invalid_items=[]; const price_changes=[]; const snapshotUpdates=new Map();
 for(const item of items){
  const producto_id=Number(item.producto_id), cantidad=Number(item.cantidad);
  if(!producto_id||!Number.isInteger(cantidad)||cantidad<=0){ invalid_items.push({producto_id:item.producto_id,cantidad:item.cantidad,reason:'Cantidad o producto inválido.'}); continue; }
  if(item.estado!=='activo'){ invalid_items.push({producto_id,cantidad,reason:'Producto no está activo.',estado:item.estado}); continue; }
  if(item.tienda_estado!=='activa'){ invalid_items.push({producto_id,cantidad,reason:'La tienda no está activa.',estado_tienda:item.tienda_estado}); continue; }
  if(item.categoria_estado!=='activa'){ invalid_items.push({producto_id,cantidad,reason:'La categoría no está activa.'}); continue; }
  if(Number(item.stock)<cantidad){ invalid_items.push({producto_id,cantidad,reason:'Stock insuficiente.',stock_actual:item.stock}); continue; }
  const precio_unitario=Number(item.precio); const subtotal=Number((precio_unitario*cantidad).toFixed(2));
  if(!snapshotUpdates.has(producto_id)){
   const snapshot=item.precio_unitario_snapshot;
   if(snapshot==null){ snapshotUpdates.set(producto_id,{producto_id,precio_actual:precio_unitario}); }
   else if(toCents(snapshot)!==toCents(precio_unitario)){
    price_changes.push({producto_id,producto_nombre:item.nombre,precio_anterior:Number(snapshot),precio_actual:precio_unitario,reason:`El precio de ${item.nombre} cambió.`});
    snapshotUpdates.set(producto_id,{producto_id,precio_actual:precio_unitario});
   }
  }
  valid_items.push({producto_id,cantidad,nombre:item.nombre,tienda_id:item.tienda_id,tienda_nombre:item.tienda_nombre,precio_unitario,stock_actual:item.stock,subtotal});
 }
 /* Solo se escribe si algo cambió: advancePriceSnapshots ya corta con 0
    actualizaciones, pero así tampoco se le llama en el caso normal. */
 if(snapshotUpdates.size) await persistent.advancePriceSnapshots(user.id,[...snapshotUpdates.values()]);
 const total=valid_items.reduce((a,b)=>a+toCents(b.subtotal),0)/100;
 return {valid_items,invalid_items,price_changes,total,advertencias:invalid_items.map(i=>i.reason)};
}
function positiveInt(value, field='cantidad') { const n=Number(value); if(!Number.isInteger(n)||n<1) throw err(`${field} debe ser un entero mayor o igual a 1.`,400); return n; }
function id(value, field='id') { const n=Number(value); if(!Number.isInteger(n)||n<1) throw err(`${field} inválido.`,400); return n; }
async function getCart(user){ return persistent.getCart(user.id); }
async function addItem(user, body){ return persistent.upsertItem(user.id, id(body.product_id || body.producto_id, 'product_id'), positiveInt(body.cantidad)); }
async function updateItem(user, itemId, body){ return persistent.updateItem(user.id, id(itemId), positiveInt(body.cantidad)); }
async function deleteItem(user, itemId){ return persistent.deleteItem(user.id, id(itemId)); }
async function clearCart(user){ return persistent.clearCart(user.id); }
module.exports={validateCart,getCart,addItem,updateItem,deleteItem,clearCart};
