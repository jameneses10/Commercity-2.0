const { verifyToken } = require('../utils/jwt');
const { errorResponse } = require('../utils/response');
const { findUserById } = require('../models/user.model');

async function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(errorResponse('Token de autenticación requerido.'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyToken(token);

    if (payload.token_version === undefined) {
      return res.status(401).json(errorResponse('Sesión inválida o expirada.'));
    }

    const dbUser = await findUserById(payload.id);
    if (!dbUser) {
      return res.status(401).json(errorResponse('Sesión inválida o expirada.'));
    }

    const jwtVersion = Number(payload.token_version);
    const dbVersion = Number(dbUser.token_version ?? 0);

    if (Number.isNaN(jwtVersion) || jwtVersion !== dbVersion) {
      return res.status(401).json(errorResponse('Sesión inválida o expirada.'));
    }

    req.user = {
      id: payload.id,
      correo: payload.correo,
      rol: payload.rol,
    };
    return next();
  } catch (error) {
    return res.status(401).json(errorResponse('Token inválido o expirado.'));
  }
}

module.exports = authRequired;
