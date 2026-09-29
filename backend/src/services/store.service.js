const storeModel = require('../models/store.model');
const { createSlug } = require('../utils/slug');
const logService = require('./log.service');

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function ensureUniqueStore({ nombre, slug, ignoreId = null }) {
  const byName = await storeModel.findStoreByName(nombre);
  if (byName && byName.id !== ignoreId) throw httpError('Ya existe una tienda con ese nombre.', 409);
  const bySlug = await storeModel.findStoreBySlug(slug);
  if (bySlug && bySlug.id !== ignoreId) throw httpError('Ya existe una tienda con ese slug.', 409);
}

async function createStoreForSeller(userId, payload) {
  const existing = await storeModel.findStoreBySellerId(userId);
  if (existing) throw httpError('El vendedor ya tiene una tienda registrada.', 409);
  const slug = createSlug(payload.nombre);
  await ensureUniqueStore({ nombre: payload.nombre.trim(), slug });
  return storeModel.createStore({
    usuario_id: userId,
    nombre: payload.nombre.trim(),
    slug,
    descripcion: payload.descripcion || null,
    logo_url: payload.logo_url || null,
    banner_url: payload.banner_url || null,
  });
}

async function getPublicStore(id) {
  const store = await storeModel.findStoreById(id);
  if (!store) throw httpError('Tienda no encontrada.', 404);
  return store;
}

async function getMyStore(userId) {
  const store = await storeModel.findStoreBySellerId(userId);
  if (!store) throw httpError('El vendedor aún no tiene tienda.', 404);
  return store;
}

async function updateMyStore(userId, payload) {
  const store = await getMyStore(userId);
  const data = {};
  if (payload.nombre !== undefined) {
    data.nombre = payload.nombre.trim();
    data.slug = createSlug(payload.nombre);
    await ensureUniqueStore({ nombre: data.nombre, slug: data.slug, ignoreId: store.id });
  }
  for (const key of ['descripcion', 'logo_url', 'banner_url']) {
    if (payload[key] !== undefined) data[key] = payload[key] || null;
  }
  return storeModel.updateStoreById(store.id, data);
}

async function changeStoreStatus({ storeId, user, status, ip = null }) {
  const store = await storeModel.findStoreById(storeId);
  if (!store) throw httpError('Tienda no encontrada.', 404);
  const isOwner = user.rol === 'vendedor' && store.usuario_id === user.id;
  const isAdmin = user.rol === 'administrador';
  if (!isOwner && !isAdmin) throw httpError('No tiene permisos para modificar esta tienda.', 403);
  const updated = await storeModel.updateStoreById(store.id, { estado: status });
  // RF-283: el cambio de estado de tienda es una accion critica; se audita el actor.
  await logService.log(null, { usuario_id: user.id, accion: 'tienda_estado_actualizado', entidad: 'tiendas', entidad_id: store.id, detalle: { rol: user.rol ?? null, estado_anterior: store.estado ?? null, estado_nuevo: status }, ip: ip ?? null });
  return updated;
}

async function listStoreProducts(storeId, query) {
  const store = await storeModel.findStoreById(storeId);
  if (!store) throw httpError('Tienda no encontrada.', 404);
  if (store.estado !== 'activa') return { store, products: [], pagination: { page: 1, limit: 0, total: 0, pages: 0 } };
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '12', 10), 1), 50);
  const offset = (page - 1) * limit;
  const { rows, total } = await storeModel.listActiveProductsByStore(storeId, { limit, offset });
  return { store, products: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

module.exports = { createStoreForSeller, getPublicStore, getMyStore, updateMyStore, changeStoreStatus, listStoreProducts };
