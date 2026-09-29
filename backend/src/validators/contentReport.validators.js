const {body}=require('express-validator');
const createContentReportValidator=[
  body('motivo').trim().isLength({min:3,max:120}).withMessage('El motivo debe tener entre 3 y 120 caracteres.'),
  body('descripcion').optional({nullable:true,checkFalsy:true}).trim().isLength({max:1000}).withMessage('La descripción no puede superar 1000 caracteres.')
];
const resolveContentReportValidator=[
  body('estado').optional().isIn(['pendiente','revisado','rechazado','accionado']).withMessage('Estado inválido.'),
  body('respuesta_admin').optional({nullable:true,checkFalsy:true}).trim().isLength({max:1000}).withMessage('La respuesta no puede superar 1000 caracteres.'),
  body('accion_target').optional().isString().withMessage('accion_target inválida.')
];
module.exports={createContentReportValidator,resolveContentReportValidator};
