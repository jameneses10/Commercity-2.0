const crypto = require('crypto');
const model = require('../models/return.model');
const notificationService = require('./notification.service');
const logService = require('./log.service');
function err(message, statusCode) { const e = new Error(message); e.statusCode = statusCode; return e; }
const BUYER_STATES = ['solicitada'];
const SELLER_STATES = ['en_revision','aprobada','rechazada'];
const ADMIN_STATES = ['en_revision','aprobada','rechazada','producto_recibido','reembolso_simulado','cerrada'];
function number() { return `DEV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function statusTitle(estado) { return ({ solicitada:'Devolución solicitada', en_revision:'Devolución en revisión', aprobada:'Devolución aprobada', rechazada:'Devolución rechazada', producto_recibido:'Producto recibido', reembolso_simulado:'Reembolso simulado', cerrada:'Devolución cerrada' })[estado] || 'Actualización de devolución'; }
async function detailForUser(user, id) {
  const row = await model.findById(id); if (!row) throw err('Solicitud de devolución no encontrada.', 404);
  if (user.rol === 'comprador' && Number(row.comprador_id) !== Number(user.id)) throw err('No autorizado para ver esta devolución.', 403);
  if (user.rol === 'vendedor' && !(await model.sellerOwnsReturn(id, user.id))) throw err('No autorizado para ver esta devolución.', 403);
  return { return: await model.hydrate(row) };
}
async function create(user, payload, files = [], meta = {}) {
  if (user.rol !== 'comprador') throw err('Solo compradores pueden solicitar devoluciones.', 403);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw err('Debe seleccionar al menos un producto del pedido.', 400);
  const pedidoId = Number(payload.pedido_id);
  const detailIds = items.map(x => Number(x.pedido_detalle_id)).filter(Boolean);
  const conn = await model.pool.getConnection();
  try {
    await conn.beginTransaction();
    const order = await model.orderForBuyer(pedidoId, user.id, conn);
    if (!order) throw err('Pedido no encontrado para el comprador.', 404);
    if (order.estado_pago !== 'pagado') throw err('No se puede solicitar devolución de un pedido no pagado.', 409);
    if (order.estado_general === 'cancelado') throw err('No se puede solicitar devolución de un pedido cancelado.', 409);
    const details = await model.detailsForOrder(pedidoId, detailIds, conn);
    if (details.length !== detailIds.length) throw err('Uno o más productos no pertenecen al pedido.', 400);
    const storeIds = new Set(details.map(d => Number(d.tienda_id)));
    if (storeIds.size !== 1) throw err('La solicitud debe agrupar productos de una sola tienda.', 400);
    const delivered = await model.deliveredStoreIds(pedidoId, conn);
    const tiendaId = [...storeIds][0];
    if (!delivered.has(tiendaId)) throw err('No se puede devolver un producto cuyo envío no esté entregado.', 409);
    if (await model.hasActiveDuplicate(pedidoId, detailIds, conn)) throw err('Ya existe una devolución activa para uno de estos productos del pedido.', 409);
    let monto = 0;
    const byDetail = new Map(details.map(d => [Number(d.id), d]));
    const normalized = items.map(raw => {
      const d = byDetail.get(Number(raw.pedido_detalle_id));
      const cantidad = Math.max(1, Math.min(Number(raw.cantidad || d.cantidad), Number(d.cantidad)));
      const subtotal = Number(d.precio_unitario) * cantidad;
      monto += subtotal;
      return { pedido_detalle_id: d.id, producto_id: d.producto_id, cantidad, precio_unitario: d.precio_unitario, subtotal };
    });
    const returnId = await model.createReturn(conn, { numero_solicitud: number(), pedido_id: pedidoId, comprador_id: user.id, tienda_id: tiendaId, motivo: payload.motivo, descripcion: payload.descripcion, monto_estimado: monto });
    for (const it of normalized) await model.addItem(conn, returnId, it);
    for (const f of files) await model.addEvidence(conn, returnId, f);
    const sellerId = await model.sellerForStore(tiendaId);
    await notificationService.create(conn, user.id, { tipo:'devolucion_solicitada', titulo:'Solicitud de devolución enviada', mensaje:'Tu solicitud fue registrada y queda en revisión.', entidad_tipo:'devolucion', entidad_id:returnId });
    await notificationService.create(conn, sellerId, { tipo:'devolucion_solicitada', titulo:'Nueva solicitud de devolución', mensaje:'Un comprador solicitó devolución de productos de tu tienda.', entidad_tipo:'devolucion', entidad_id:returnId });
    await logService.log(conn, { usuario_id:user.id, accion:'devolucion_solicitada', entidad:'devolucion', entidad_id:returnId, detalle:{ pedido_id:pedidoId, tienda_id:tiendaId, monto_estimado:monto }, ip:meta.ip });
    await conn.commit();
    return { return: await model.hydrate(await model.findById(returnId)) };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
async function myReturns(user) { return { returns: await model.listBuyer(user.id) }; }
async function sellerReturns(user) { if (user.rol !== 'vendedor') throw err('Solo vendedores pueden consultar estas devoluciones.', 403); return { returns: await model.listSeller(user.id) }; }
async function adminReturns(user) { if (user.rol !== 'administrador') throw err('Solo administradores pueden consultar todas las devoluciones.', 403); return { returns: await model.listAdmin() }; }
async function sellerUpdate(user, id, payload, meta = {}) {
  if (user.rol !== 'vendedor') throw err('Solo vendedores pueden actualizar devoluciones de su tienda.', 403);
  if (!SELLER_STATES.includes(payload.estado)) throw err('Estado no permitido para vendedor.', 400);
  if (!(await model.sellerOwnsReturn(id, user.id))) throw err('La devolución no pertenece a tu tienda.', 403);
  const conn = await model.pool.getConnection();
  try {
    await conn.beginTransaction();
    await model.updateSeller(id, payload, conn);
    await logService.log(conn, { usuario_id:user.id, accion:'devolucion_actualizada_vendedor', entidad:'devolucion', entidad_id:id, detalle:payload, ip:meta.ip });
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  const row = await model.findById(id);
  await notificationService.create(null, row.comprador_id, { tipo:'devolucion_actualizada', titulo:statusTitle(payload.estado), mensaje:payload.respuesta_vendedor || 'El vendedor actualizó tu solicitud.', entidad_tipo:'devolucion', entidad_id:id });
  await notificationService.create(null, user.id, { tipo:'devolucion_actualizada', titulo:statusTitle(payload.estado), mensaje:'Actualizaste el estado de una devolución de tu tienda.', entidad_tipo:'devolucion', entidad_id:id });
  return { return: await model.hydrate(row) };
}
async function adminResolve(user, id, payload, meta = {}) {
  if (user.rol !== 'administrador') throw err('Solo administradores pueden resolver devoluciones.', 403);
  if (!ADMIN_STATES.includes(payload.estado)) throw err('Estado no permitido para administrador.', 400);
  let row, updated;
  if (payload.estado === 'reembolso_simulado') {
    const conn = await model.pool.getConnection();
    try {
      await conn.beginTransaction();
      row = await model.findByIdForUpdate(id, conn);
      if (!row) throw err('Solicitud de devolución no encontrada.', 404);
      if (!(await model.findRefundByReturnId(row.id, conn))) await model.createSimulatedRefund(conn, { devolucion_id: row.id, pedido_id: row.pedido_id, monto: row.monto_estimado });
      await model.updateAdmin(id, payload, conn);
      await logService.log(conn, { usuario_id:user.id, accion:'reembolso_simulado', entidad:'devolucion', entidad_id:id, detalle:payload, ip:meta.ip });
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    updated = await model.findById(id);
  } else {
    row = await model.findById(id); if (!row) throw err('Solicitud de devolución no encontrada.', 404);
    const conn = await model.pool.getConnection();
    try {
      await conn.beginTransaction();
      await model.updateAdmin(id, payload, conn);
      await logService.log(conn, { usuario_id:user.id, accion:'devolucion_resuelta_admin', entidad:'devolucion', entidad_id:id, detalle:payload, ip:meta.ip });
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    updated = await model.findById(id);
  }
  const sellerId = await model.sellerForStore(row.tienda_id);
  await notificationService.create(null, row.comprador_id, { tipo:'devolucion_resuelta', titulo:statusTitle(payload.estado), mensaje:payload.respuesta_admin || 'El administrador actualizó tu devolución.', entidad_tipo:'devolucion', entidad_id:id });
  await notificationService.create(null, sellerId, { tipo:'devolucion_resuelta', titulo:statusTitle(payload.estado), mensaje:'El administrador actualizó una devolución de tu tienda.', entidad_tipo:'devolucion', entidad_id:id });
  return { return: await model.hydrate(updated) };
}
module.exports = { create, myReturns, detailForUser, sellerReturns, sellerUpdate, adminReturns, adminResolve };
