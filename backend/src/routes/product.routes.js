const express = require('express');
const controller = require('../controllers/product.controller');
const authRequired = require('../middlewares/authRequired');
const requireRole = require('../middlewares/requireRole');
const { productUpload, multerErrorHandler } = require('../middlewares/upload.middleware');
const { createProductValidator, updateProductValidator, visibilityValidator, listProductsValidator } = require('../validators/product.validators');
const reviewController = require('../controllers/review.controller');

const router = express.Router();

router.get('/', listProductsValidator, controller.list);
router.get('/:id/reviews', reviewController.listProduct);
router.get('/:id', controller.getById);
router.post('/', authRequired, requireRole('vendedor'), productUpload.array('images', 6), multerErrorHandler, createProductValidator, controller.create);
router.patch('/:id', authRequired, requireRole('vendedor', 'administrador'), productUpload.array('images', 6), multerErrorHandler, updateProductValidator, controller.update);
router.delete('/:id/images/:imageId', authRequired, requireRole('vendedor', 'administrador'), controller.deleteImage);
router.patch('/:id/visibility', authRequired, requireRole('vendedor', 'administrador'), visibilityValidator, controller.visibility);
router.delete('/:id', authRequired, requireRole('vendedor', 'administrador'), controller.remove);

module.exports = router;
