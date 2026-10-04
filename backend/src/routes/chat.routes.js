const express=require('express'); const c=require('../controllers/chat.controller'); const authRequired=require('../middlewares/authRequired'); const requireRole=require('../middlewares/requireRole'); const presenceTouch=require('../middlewares/presenceTouch'); const {createConversationValidator,messageValidator}=require('../validators/chat.validators'); const { chatUpload, multerErrorHandler } = require('../middlewares/upload.middleware');
const router=express.Router();
/* RNF-004: el canonico titula el bloque "R. Modulo de Chat Interno
   Comprador-Vendedor", RF-287 define la conversacion entre comprador y
   vendedor y RF-290 el historial entre esos dos actores. Un administrador no
   tiene funcion asignada aqui, asi que debe recibir el 403 de RF-020 en TODAS
   las rutas del modulo, no solo al crear: antes obtenia 200 en
   GET /conversations aunque la lista saliera vacia.
   La guardia va despues de authRequired y ANTES de presenceTouch para que un
   rol rechazado no escriba marca de presencia. */
const chatAuth=[authRequired,requireRole('comprador','vendedor'),presenceTouch];
router.get('/conversations',...chatAuth,c.list);
router.post('/conversations',...chatAuth,createConversationValidator,c.create);
router.get('/conversations/:id/messages',...chatAuth,c.messages);
router.post('/conversations/:id/messages',...chatAuth,chatUpload.array('files',5),multerErrorHandler,messageValidator,c.send);
router.patch('/conversations/:id/read',...chatAuth,c.read);
router.patch('/messages/:id/report',...chatAuth,c.report);
router.delete('/messages/:id',...chatAuth,c.remove);
module.exports=router;
