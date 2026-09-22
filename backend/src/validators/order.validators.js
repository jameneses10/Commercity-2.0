const {body,query}=require('express-validator');
const createOrderValidator=[body('direccion_id').isInt({min:1}).withMessage('direccion_id inválido.').toInt(),body('items').isArray({min:1}).withMessage('items debe tener productos.'),body('items.*.producto_id').isInt({min:1}).toInt(),body('items.*.cantidad').isInt({min:1}).toInt()];
const adminOrdersValidator=[query('tienda_id').optional().isInt({min:1}).withMessage('tienda_id inválido.').toInt()];
module.exports={createOrderValidator,adminOrdersValidator};
