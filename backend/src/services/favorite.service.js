const model = require('../models/favorite.model');
const notificationService = require('./notification.service');
const logService = require('./log.service');
function err(message, statusCode) { const e = new Error(message); e.statusCode = statusCode; return e; }
function assertBuyer(user) { if (!['comprador','vendedor','administrador'].includes(user.rol)) throw err('Rol no autorizado para favoritos.', 403); }
const FAVORITE_EVENT_ORDER = ['agotado', 'desactivado', 'precio'];
const FAVORITE_EVENT_PAYLOADS = {
  agotado: { tipo: 'favorito_agotado', titulo: 'Producto favorito agotado', mensaje: (nombre) => `El producto ${nombre} de tus favoritos quedó agotado.` },
  desactivado: { tipo: 'favorito_desactivado', titulo: 'Producto favorito desactivado', mensaje: (nombre) => `El producto ${nombre} de tus favoritos fue desactivado.` },
  precio: { tipo: 'favorito_precio_cambiado', titulo: 'Producto favorito cambió de precio', mensaje: (nombre) => `El producto ${nombre} de tus favoritos cambió de precio.` },
};
async function notifyFavoriteProductEvents(conn, product, events) {
  const requested = new Set(events || []);
  const keys = FAVORITE_EVENT_ORDER.filter((key) => requested.has(key));
  if (!keys.length) return 0;
  const userIds = await model.listFavoriterIds(product.id, conn);
  if (!userIds.length) return 0;
  for (const userId of userIds) {
    for (const key of keys) {
      const payload = FAVORITE_EVENT_PAYLOADS[key];
      await notificationService.create(conn, userId, { tipo: payload.tipo, titulo: payload.titulo, mensaje: payload.mensaje(product.nombre), entidad_tipo: 'producto', entidad_id: product.id });
    }
  }
  return userIds.length * keys.length;
}
async function list(user) { return { favorites: await model.list(user.id) }; }
async function add(user, productId, meta = {}) {
  assertBuyer(user);
  const product = await model.findActiveProduct(productId);
  if (!product) throw err('Producto no encontrado.', 404);
  if (product.estado !== 'activo' || product.tienda_estado !== 'activa') throw err('No se puede agregar un producto inactivo u oculto a favoritos.', 409);
  const created = await model.add(user.id, productId);
  if (!created) throw err('El producto ya está en tus favoritos.', 409);
  await notificationService.create(null, user.id, { tipo: 'favorito_agregado', titulo: 'Producto agregado a favoritos', mensaje: product.nombre, entidad_tipo: 'producto', entidad_id: productId, url_destino: `/producto.html?id=${productId}` });
  await logService.log(null, { usuario_id: user.id, accion: 'favorito_agregado', entidad: 'favorito', entidad_id: productId, detalle: { producto_id: productId }, ip: meta.ip });
  return { added: true, product_id: Number(productId) };
}
async function remove(user, productId, meta = {}) {
  const removed = await model.remove(user.id, productId);
  if (!removed) throw err('Favorito no encontrado.', 404);
  await logService.log(null, { usuario_id: user.id, accion: 'favorito_removido', entidad: 'favorito', entidad_id: productId, detalle: { producto_id: productId }, ip: meta.ip });
  return { removed: true, product_id: Number(productId) };
}
module.exports = { list, add, remove, notifyFavoriteProductEvents };
