const { validationResult } = require('express-validator');
const service = require('../services/store.service');
const reputationService = require('../services/reputation.service');
const { mapFile } = require('../middlewares/upload.middleware');
const { successResponse, errorResponse } = require('../utils/response');

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json(errorResponse('Datos de entrada inválidos.', errors.array().map(e => ({ field: e.path, message: e.msg }))));
    return true;
  }
  return false;
}

function mergeUploadUrls(req) {
  const data = { ...req.body };
  const logo = mapFile(req.files?.logo?.[0], 'stores');
  const banner = mapFile(req.files?.banner?.[0], 'stores');
  if (logo) data.logo_url = logo.url;
  if (banner) data.banner_url = banner.url;
  return data;
}
async function create(req, res, next) { try { if (validate(req,res)) return; const store = await service.createStoreForSeller(req.user.id, mergeUploadUrls(req)); res.status(201).json(successResponse('Tienda creada correctamente.', { store })); } catch(e){ next(e); } }
async function getById(req, res, next) { try { const store = await service.getPublicStore(req.params.id); res.json(successResponse('Tienda obtenida correctamente.', { store })); } catch(e){ next(e); } }
async function me(req, res, next) { try { const store = await service.getMyStore(req.user.id); res.json(successResponse('Tienda propia obtenida correctamente.', { store })); } catch(e){ next(e); } }
async function updateMe(req, res, next) { try { if (validate(req,res)) return; const store = await service.updateMyStore(req.user.id, mergeUploadUrls(req)); res.json(successResponse('Tienda actualizada correctamente.', { store })); } catch(e){ next(e); } }
async function pause(req, res, next) { try { const store = await service.changeStoreStatus({ storeId: req.params.id, user: req.user, status: 'pausada', ip: req.ip }); res.json(successResponse('Tienda pausada correctamente.', { store })); } catch(e){ next(e); } }
async function activate(req, res, next) { try { const store = await service.changeStoreStatus({ storeId: req.params.id, user: req.user, status: 'activa', ip: req.ip }); res.json(successResponse('Tienda activada correctamente.', { store })); } catch(e){ next(e); } }
async function products(req, res, next) { try { const result = await service.listStoreProducts(req.params.id, req.query); res.json(successResponse('Productos de tienda obtenidos correctamente.', result)); } catch(e){ next(e); } }
async function reputation(req, res, next) { try { const result = await reputationService.getStoreReputation(req.params.id); res.json(successResponse('Reputación de tienda obtenida correctamente.', result)); } catch(e){ next(e); } }

module.exports = { create, getById, me, updateMe, pause, activate, products, reputation };
