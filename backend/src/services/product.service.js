const productModel = require('../models/product.model');
const storeModel = require('../models/store.model');
const categoryModel = require('../models/category.model');
const { createSlug } = require('../utils/slug');
const favoriteService = require('./favorite.service');

function httpError(message, statusCode) { const e = new Error(message); e.statusCode = statusCode; return e; }
function toCents(value) { return Math.round(Number(value) * 100); }
function detectFavoriteStateEvents(before, after) {
  const events = [];
  if (before.estado !== 'agotado' && after.estado === 'agotado') events.push('agotado');
  if (before.estado !== 'oculto' && after.estado === 'oculto') events.push('desactivado');
  return events;
}

async function getSellerActiveStore(userId) {
  const store = await storeModel.findStoreBySellerId(userId);
  if (!store) throw httpError('El vendedor no tiene tienda registrada.', 404);
  if (store.estado !== 'activa') throw httpError('La tienda debe estar activa para gestionar productos.', 409);
  return store;
}

async function ensureActiveCategory(categoryId) {
  const category = await categoryModel.findActiveCategoryById(categoryId);
  if (!category) throw httpError('La categoría no existe o no está activa.', 404);
  return category;
}

async function ensureUniqueProductSlug(tiendaId, slug, ignoreId = null) {
  const product = await productModel.findProductByStoreSlug(tiendaId, slug);
  if (product && product.id !== ignoreId) throw httpError('Ya existe un producto con ese nombre en la tienda.', 409);
}

function normalizeProductState(stock, currentState = 'activo') {
  const numericStock = Number(stock);
  if (numericStock === 0 && currentState === 'activo') return 'agotado';
  if (numericStock > 0 && currentState === 'agotado') return 'activo';
  return currentState;
}
function extraProductFields(payload) {
  const data = {};
  if (payload.precio_anterior !== undefined) data.precio_anterior = payload.precio_anterior || null;
  if (payload.descuento_porcentaje !== undefined) data.descuento_porcentaje = Number(payload.descuento_porcentaje || 0);
  if (payload.fecha_publicacion !== undefined) data.fecha_publicacion = payload.fecha_publicacion || null;
  if (payload.fecha_caducidad !== undefined) data.fecha_caducidad = payload.fecha_caducidad || null;
  const pub = data.fecha_publicacion ? new Date(data.fecha_publicacion) : null;
  const cad = data.fecha_caducidad ? new Date(data.fecha_caducidad) : null;
  if (pub && cad && cad <= pub) throw httpError('fecha_caducidad debe ser posterior a fecha_publicacion.', 400);
  return data;
}

async function listPublicProducts(query) {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '12', 10), 1), 50);
  const offset = (page - 1) * limit;
  const filters = {
    q: query.q || null,
    category_id: query.category_id ? Number(query.category_id) : null,
    store_id: query.store_id ? Number(query.store_id) : null,
    min_price: query.min_price !== undefined ? Number(query.min_price) : undefined,
    max_price: query.max_price !== undefined ? Number(query.max_price) : undefined,
    sort: query.sort || 'newest',
    limit,
    offset,
  };
  const { rows, total } = await productModel.listPublicProducts(filters);
  return { products: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function getPublicProduct(id) {
  const product = await productModel.findProductDetailById(id);
  if (!product) throw httpError('Producto no encontrado o no disponible.', 404);
  return product;
}

async function createProductForSeller(userId, payload, images = []) {
  const store = await getSellerActiveStore(userId);
  await ensureActiveCategory(payload.categoria_id);
  const slug = createSlug(payload.nombre);
  await ensureUniqueProductSlug(store.id, slug);
  const stock = Number(payload.stock);
  const estado = stock === 0 ? 'agotado' : 'activo';
  const product = await productModel.createProduct({
    tienda_id: store.id,
    categoria_id: payload.categoria_id,
    nombre: payload.nombre.trim(),
    slug,
    descripcion: payload.descripcion.trim(),
    precio: payload.precio,
    ...extraProductFields(payload),
    stock,
    estado,
    imagen_url: payload.imagen_url || null,
  });
  if (images.length) await productModel.addProductImages(product.id, images);
  return productModel.findProductById(product.id);
}

async function assertProductPermission(product, user) {
  if (!product) throw httpError('Producto no encontrado.', 404);
  if (user.rol === 'administrador') return;
  if (user.rol !== 'vendedor') throw httpError('No tiene permisos para modificar este producto.', 403);
  const store = await storeModel.findStoreBySellerId(user.id);
  if (!store || store.id !== product.tienda_id) throw httpError('No tiene permisos para modificar productos de otra tienda.', 403);
}

async function updateProduct(user, productId, payload, images = []) {
  const product = await productModel.findProductById(productId);
  await assertProductPermission(product, user);
  const data = {};
  if (payload.categoria_id !== undefined) { await ensureActiveCategory(payload.categoria_id); data.categoria_id = payload.categoria_id; }
  if (payload.nombre !== undefined) { data.nombre = payload.nombre.trim(); data.slug = createSlug(payload.nombre); await ensureUniqueProductSlug(product.tienda_id, data.slug, product.id); }
  if (payload.descripcion !== undefined) data.descripcion = payload.descripcion.trim();
  if (payload.precio !== undefined) data.precio = payload.precio;
  Object.assign(data, extraProductFields(payload));
  if (payload.stock !== undefined) data.stock = Number(payload.stock);
  if (payload.imagen_url !== undefined) data.imagen_url = payload.imagen_url || null;
  if (payload.estado !== undefined) data.estado = payload.estado;
  const finalStock = data.stock !== undefined ? data.stock : product.stock;
  const finalState = data.estado !== undefined ? data.estado : product.estado;
  data.estado = normalizeProductState(finalStock, finalState);
  const updated = await productModel.updateProductById(product.id, data);
  const events = detectFavoriteStateEvents(product, updated);
  if (toCents(product.precio_final) !== toCents(updated.precio_final)) events.push('precio');
  if (events.length) await favoriteService.notifyFavoriteProductEvents(null, updated, events);
  if (images.length) await productModel.addProductImages(product.id, images);
  return productModel.findProductById(updated.id);
}

async function deleteProductImage(user, productId, imageId) {
  const product = await productModel.findProductById(productId);
  await assertProductPermission(product, user);
  const image = await productModel.findImageById(imageId);
  if (!image || Number(image.producto_id) !== Number(productId)) throw httpError('Imagen de producto no encontrada.', 404);
  await productModel.deleteProductImage(imageId);
  return { deleted: true };
}

async function changeProductVisibility(user, productId, estado) {
  if (!['activo', 'oculto', 'agotado', 'eliminado'].includes(estado)) throw httpError('Estado de producto inválido.', 400);
  const product = await productModel.findProductById(productId);
  await assertProductPermission(product, user);
  if (estado === 'activo' && Number(product.stock) === 0) throw httpError('No se puede activar un producto sin stock.', 409);
  const updated = await productModel.updateProductById(product.id, { estado });
  const events = detectFavoriteStateEvents(product, updated);
  if (events.length) await favoriteService.notifyFavoriteProductEvents(null, updated, events);
  return updated;
}

async function logicalDeleteProduct(user, productId) {
  const product = await productModel.findProductById(productId);
  await assertProductPermission(product, user);
  return productModel.updateProductById(product.id, { estado: 'eliminado' });
}

module.exports = { listPublicProducts, getPublicProduct, createProductForSeller, updateProduct, deleteProductImage, changeProductVisibility, logicalDeleteProduct };
