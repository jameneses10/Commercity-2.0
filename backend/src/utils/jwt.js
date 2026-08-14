const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      correo: user.correo,
      rol: user.rol,
      token_version: Number(user.token_version ?? 0)
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );
}

function verifyToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

module.exports = {
  signToken,
  verifyToken,
};
