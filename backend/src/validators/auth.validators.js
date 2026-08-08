const { body } = require('express-validator');
const { isAdult } = require('../utils/age');

const allowedPublicRoles = ['comprador', 'vendedor'];

const registerValidator = [
  body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio.').isLength({ min: 2, max: 120 }).withMessage('El nombre debe tener entre 2 y 120 caracteres.'),
  body('correo').trim().notEmpty().withMessage('El correo es obligatorio.').isEmail().withMessage('El correo debe tener un formato válido.').normalizeEmail(),
  body('password').notEmpty().withMessage('La contraseña es obligatoria.').isLength({ min: 8 }).withMessage('La contraseña debe tener mínimo 8 caracteres.'),
  body('confirmPassword').notEmpty().withMessage('La confirmación de contraseña es obligatoria.').custom((value, { req }) => value === req.body.password).withMessage('La contraseña y su confirmación no coinciden.'),
  body('rol').trim().notEmpty().withMessage('El rol es obligatorio.').customSanitizer((value) => String(value).toLowerCase()).isIn(allowedPublicRoles).withMessage('Solo se permite registro público como comprador o vendedor.'),
  body('telefono').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 30 }).withMessage('El teléfono no debe superar 30 caracteres.'),
  body('fecha_nacimiento').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('fecha_nacimiento debe tener formato de fecha válido.').custom((value,{req})=>{
    if (req.body.rol !== 'vendedor') return true;
    if (!value) throw new Error('fecha_nacimiento es obligatoria para vendedores.');
    if (!isAdult(value)) throw new Error('El vendedor debe ser mayor de 18 años.');
    return true;
  }),
  body('acepta_terminos').custom((value, { req }) => value === true || value === 'true' || req.body.terms_accepted === true || req.body.terms_accepted === 'true').withMessage('Debe aceptar los términos y condiciones.'),
  body('terminos_version').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 20 }).withMessage('La versión de términos no debe superar 20 caracteres.'),
];

const loginValidator = [
  body('correo').trim().notEmpty().withMessage('El correo es obligatorio.').isEmail().withMessage('El correo debe tener un formato válido.').normalizeEmail(),
  body('password').notEmpty().withMessage('La contraseña es obligatoria.'),
];
const reactivateValidator = [
  body('correo').trim().notEmpty().withMessage('El correo es obligatorio.').isEmail().withMessage('El correo debe tener un formato válido.').normalizeEmail(),
  body('password').notEmpty().withMessage('La contraseña es obligatoria.'),
];
const forgotPasswordValidator=[ body('correo').trim().notEmpty().withMessage('El correo es obligatorio.').isEmail().withMessage('El correo debe tener un formato válido.').normalizeEmail() ];
const resetPasswordValidator=[ body('correo').trim().notEmpty().isEmail().withMessage('El correo debe tener un formato válido.').normalizeEmail(), body('codigo').optional({nullable:true,checkFalsy:true}).trim().isLength({min:6,max:120}), body('token').optional({nullable:true,checkFalsy:true}).trim().isLength({min:6,max:200}), body('password').isLength({min:8}).withMessage('La nueva contraseña debe tener mínimo 8 caracteres.'), body('confirmPassword').custom((v,{req})=>v===req.body.password).withMessage('La contraseña y su confirmación no coinciden.') ];
const changePasswordValidator=[ body('currentPassword').notEmpty().withMessage('La contraseña actual es obligatoria.'), body('newPassword').isLength({min:8}).withMessage('La nueva contraseña debe tener mínimo 8 caracteres.'), body('confirmPassword').custom((v,{req})=>v===req.body.newPassword).withMessage('La nueva contraseña y su confirmación no coinciden.') ];

module.exports = { registerValidator, loginValidator, forgotPasswordValidator, resetPasswordValidator, changePasswordValidator, reactivateValidator };
