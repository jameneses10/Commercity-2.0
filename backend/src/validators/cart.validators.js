const {body}=require('express-validator');
/* RNF-016: `items` pasa a ser OPCIONAL. La fuente de verdad es el carrito
   persistente del usuario, asi que POST /cart/validate con cuerpo vacio es
   valido. Si un cliente antiguo todavia envia `items`, se siguen validando sus
   formas para no cambiarle el codigo de respuesta, pero el servicio lo ignora. */
const cartValidator=[body('items').optional().isArray({min:1}).withMessage('items debe ser un arreglo con al menos un producto.'),body('items.*.producto_id').optional().isInt({min:1}).withMessage('producto_id inválido.').toInt(),body('items.*.cantidad').optional().isInt({min:1}).withMessage('cantidad debe ser mayor que cero.').toInt()];
module.exports={cartValidator};
