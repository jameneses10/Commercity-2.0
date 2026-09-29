const categoryModel = require('../models/category.model');
const { createSlug } = require('../utils/slug');

const logService = require('./log.service');

function httpError(message, statusCode) { const e = new Error(message); e.statusCode = statusCode; return e; }

// RF-283: auditar las acciones criticas del administrador sobre el catalogo.
async function auditCategory(actor, accion, category) {
  if (!actor || !actor.id) return;
  await logService.log(null, { usuario_id: actor.id, accion, entidad: 'categorias', entidad_id: category?.id ?? null, detalle: { rol: actor.rol ?? null, nombre: category?.nombre ?? null, estado: category?.estado ?? null }, ip: actor.ip ?? null });
}

async function ensureUniqueCategory({ nombre, slug, ignoreId = null }) {
  const byName = await categoryModel.findCategoryByName(nombre);
  if (byName && byName.id !== ignoreId) throw httpError('Ya existe una categoría con ese nombre.', 409);
  const bySlug = await categoryModel.findCategoryBySlug(slug);
  if (bySlug && bySlug.id !== ignoreId) throw httpError('Ya existe una categoría con ese slug.', 409);
}

async function listCategories() { return categoryModel.listActiveCategories(); }

async function createCategory(payload, actor = null) {
  const nombre = payload.nombre.trim();
  const slug = createSlug(nombre);
  await ensureUniqueCategory({ nombre, slug });
  const created = await categoryModel.createCategory({ nombre, slug, descripcion: payload.descripcion || null, estado: payload.estado || 'activa' });
  await auditCategory(actor, 'categoria_creada', created);
  return created;
}

async function updateCategory(id, payload, actor = null) {
  const category = await categoryModel.findCategoryById(id);
  if (!category) throw httpError('Categoría no encontrada.', 404);
  const data = {};
  if (payload.nombre !== undefined) {
    data.nombre = payload.nombre.trim();
    data.slug = createSlug(payload.nombre);
    await ensureUniqueCategory({ nombre: data.nombre, slug: data.slug, ignoreId: category.id });
  }
  if (payload.descripcion !== undefined) data.descripcion = payload.descripcion || null;
  if (payload.estado !== undefined) data.estado = payload.estado;
  const updated = await categoryModel.updateCategoryById(category.id, data);
  await auditCategory(actor, 'categoria_actualizada', updated || category);
  return updated;
}

async function deleteCategory(id, actor = null) {
  const category = await categoryModel.findCategoryById(id);
  if (!category) throw httpError('Categoría no encontrada.', 404);
  const activeProducts = await categoryModel.countActiveProducts(id);
  if (activeProducts > 0) throw httpError('No se puede eliminar/inactivar una categoría con productos activos.', 409);
  const inactivated = await categoryModel.updateCategoryById(category.id, { estado: 'inactiva' });
  await auditCategory(actor, 'categoria_inactivada', inactivated || category);
  return inactivated;
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
