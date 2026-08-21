const { pool } = require('../config/database');
const persistent = require('../models/cartPersistent.model');
const EFFECTIVE_PRICE_EXPR = `ROUND(CASE WHEN p.descuento_porcentaje > 0 THEN p.precio * (1 - p.descuento_porcentaje / 100) ELSE p.precio END, 2)`;
function toCents(value){ return Math.round(Number(value) * 100); }
function err(m,s){const e=new Error(m);e.statusCode=s;return e;}
async function validateCart(user,items){
 if(!Array.isArray(items)||!items.length) throw err('El carrito debe contener items.',400);
 if(!user?.id) throw err('Usuario autenticado requerido para validar el carrito.',401);
 const productIds=[...new Set(items.map(raw=>Number(raw.producto_id)).filter(Number.isInteger))];
 const snapshots=await persistent.getPriceSnapshots(user.id,productIds);
 const valid_items=[]; const invalid_items=[]; const price_changes=[]; const snapshotUpdates=new Map();
 for(const raw of items){
  const producto_id=Number(raw.producto_id), cantidad=Number(raw.cantidad);
  if(!producto_id||!Number.isInteger(cantidad)||cantidad<=0){ invalid_items.push({producto_id:raw.producto_id,cantidad:raw.cantidad,reason:'Cantidad o producto inválido.'}); continue; }
  const [rows]=await pool.query(`SELECT p.id producto_id,p.nombre,${EFFECTIVE_PRICE_EXPR} precio_final,p.stock,p.estado,p.tienda_id,t.estado tienda_estado,t.nombre tienda_nombre,c.estado categoria_estado FROM productos p INNER JOIN tiendas t ON t.id=p.tienda_id INNER JOIN categorias c ON c.id=p.categoria_id WHERE p.id=? LIMIT 1`,[producto_id]);
  const p=rows[0];
  if(!p){ invalid_items.push({producto_id,cantidad,reason:'Producto no existe.'}); continue; }
  if(p.estado!=='activo'){ invalid_items.push({producto_id,cantidad,reason:'Producto no está activo.',estado:p.estado}); continue; }
  if(p.tienda_estado!=='activa'){ invalid_items.push({producto_id,cantidad,reason:'La tienda no está activa.',estado_tienda:p.tienda_estado}); continue; }
  if(p.categoria_estado!=='activa'){ invalid_items.push({producto_id,cantidad,reason:'La categoría no está activa.'}); continue; }
  if(Number(p.stock)<cantidad){ invalid_items.push({producto_id,cantidad,reason:'Stock insuficiente.',stock_actual:p.stock}); continue; }
  const precio_unitario=Number(p.precio_final); const subtotal=Number((precio_unitario*cantidad).toFixed(2));
  if(snapshots.has(producto_id)&&!snapshotUpdates.has(producto_id)){
   const snapshot=snapshots.get(producto_id);
   if(snapshot==null){ snapshotUpdates.set(producto_id,{producto_id,precio_actual:precio_unitario}); }
   else if(toCents(snapshot)!==toCents(precio_unitario)){
    price_changes.push({producto_id,producto_nombre:p.nombre,precio_anterior:Number(snapshot),precio_actual:precio_unitario,reason:`El precio de ${p.nombre} cambió.`});
    snapshotUpdates.set(producto_id,{producto_id,precio_actual:precio_unitario});
   }
  }
  valid_items.push({producto_id,cantidad,nombre:p.nombre,tienda_id:p.tienda_id,tienda_nombre:p.tienda_nombre,precio_unitario,stock_actual:p.stock,subtotal});
 }
 await persistent.advancePriceSnapshots(user.id,[...snapshotUpdates.values()]);
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
