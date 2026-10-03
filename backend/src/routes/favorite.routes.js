const express = require('express');
const { param } = require('express-validator');
const authRequired = require('../middlewares/authRequired');
const requireRole = require('../middlewares/requireRole');
const c = require('../controllers/favorite.controller');
const router = express.Router();
const productParam = [param('productId').isInt({ min: 1 }).withMessage('Producto inválido.')];
/* RNF-004: el canonico titula el bloque "G. Modulo de Favoritos del Comprador"
   y RF-125/RF-126 asignan agregar y quitar al comprador, asi que las tres
   operaciones son suyas. Sin esta guardia un vendedor o un administrador
   autenticado operaba el modulo sin recibir el 403 que exige RF-020.
   Mismo criterio ya aplicado en /cart, /addresses y /orders/my-orders. */
router.use(authRequired, requireRole('comprador'));
router.get('/', c.list);
router.post('/:productId', productParam, c.add);
router.delete('/:productId', productParam, c.remove);
module.exports = router;
