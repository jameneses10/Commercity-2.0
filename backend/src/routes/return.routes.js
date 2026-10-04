const express = require('express');
const authRequired = require('../middlewares/authRequired');
const requireRole = require('../middlewares/requireRole');
const c = require('../controllers/return.controller');
const { returnUpload, multerErrorHandler } = require('../middlewares/upload.middleware');
const { idParam, createValidator } = require('../validators/return.validators');
const router = express.Router();
router.use(authRequired);
router.post('/', returnUpload.array('evidencias', 5), multerErrorHandler, createValidator, c.create);
/* RNF-004: RF-209 asigna al comprador la consulta de SU historial, y RF-210
   (vendedor) y RF-212 (administrador) tienen sus propias rutas. myReturns()
   era el unico metodo del servicio sin guardia de rol: sellerReturns(),
   adminReturns(), update() y resolve() si la tienen. Es ademas el analogo
   exacto de GET /orders/my-orders, que ya es requireRole('comprador').
   Las otras dos rutas NO llevan guardia a proposito: POST / valida comprador
   en el servicio y GET /:id es autorizacion contextual por participante. */
router.get('/my-returns', requireRole('comprador'), c.myReturns);
/* RNF-006: descarga de evidencia privada. Sin requireRole a proposito: por
   RF-209/RF-210/RF-212 acceden el comprador propietario, el vendedor dueño de
   la tienda y el administrador, asi que la autorizacion es contextual y la
   resuelve el servicio contra la devolucion padre. Se declara antes de /:id
   por legibilidad; no hay ambiguedad porque tiene dos segmentos. */
router.get('/evidences/:evidenceId', c.evidence);
router.get('/:id', idParam, c.detail);
module.exports = router;
