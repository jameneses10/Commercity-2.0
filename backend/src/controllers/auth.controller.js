const { validationResult } = require('express-validator');
const { registerUser, loginUser, getAuthenticatedUser, forgotPassword, resetPassword, changePassword, reactivateUser } = require('../services/auth.service');
const { successResponse, errorResponse } = require('../utils/response');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(errorResponse('Datos de entrada inválidos.', errors.array().map((error) => ({ field: error.path, message: error.msg }))));
  }
  return null;
}

async function register(req, res, next) {
  try { const validationResponse = handleValidation(req, res); if (validationResponse) return validationResponse; const user = await registerUser(req.body,{ip:req.ip,userAgent:req.get('user-agent')}); return res.status(201).json(successResponse('Usuario registrado correctamente.', { user })); } catch (error) { next(error); }
}
async function login(req, res, next) {
  try { const validationResponse = handleValidation(req, res); if (validationResponse) return validationResponse; const result = await loginUser(req.body); return res.status(200).json(successResponse('Inicio de sesión correcto.', result)); } catch (error) { next(error); }
}
async function me(req, res, next) {
  try { const user = await getAuthenticatedUser(req.user.id); return res.status(200).json(successResponse('Perfil autenticado obtenido correctamente.', { user })); } catch (error) { next(error); }
}
async function forgot(req,res,next){ try{const validationResponse=handleValidation(req,res); if(validationResponse) return validationResponse; const result=await forgotPassword(req.body); return res.json(successResponse(result.message,result));}catch(e){next(e)} }
async function reset(req,res,next){ try{const validationResponse=handleValidation(req,res); if(validationResponse) return validationResponse; const result=await resetPassword(req.body); return res.json(successResponse('Contraseña restablecida correctamente.',result));}catch(e){next(e)} }
async function change(req,res,next){ try{const validationResponse=handleValidation(req,res); if(validationResponse) return validationResponse; const result=await changePassword(req.user.id,req.body); return res.json(successResponse('Contraseña actualizada correctamente.',result));}catch(e){next(e)} }
async function reactivate(req,res,next){ try{const validationResponse=handleValidation(req,res); if(validationResponse) return validationResponse; await reactivateUser(req.body,{ip:req.ip,userAgent:req.get('user-agent')}); return res.status(200).json(successResponse('Tu cuenta fue reactivada correctamente.'));}catch(e){next(e)} }
async function adminTest(req, res) { return res.status(200).json(successResponse('Ruta temporal de administrador funcionando correctamente.', { user: req.user, temporary: true })); }
module.exports = { register, login, me, forgot, reset, change, adminTest, reactivate };
