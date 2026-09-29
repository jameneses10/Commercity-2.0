const { touchActivity } = require('../models/user.model');
const { PRESENCE_TOUCH_SECONDS } = require('../config/presence');

// RF-288: latido de presencia del CHAT. Se monta solo en las rutas del modulo de
// chat, de modo que "en linea" signifique actividad en el chat y no cualquier
// peticion autenticada de CommerCity (abrir perfil, pedidos, carrito o
// notificaciones no debe marcar al usuario como conectado en el chat).
// Va siempre despues de authRequired, porque necesita req.user.
// Un fallo del latido nunca debe afectar a la peticion.
async function presenceTouch(req, _res, next) {
  const userId = req.user && req.user.id;
  if (!userId) return next();
  try {
    await touchActivity(userId, PRESENCE_TOUCH_SECONDS);
  } catch (presenceError) {
    console.warn('No fue posible registrar la actividad de chat del usuario.', presenceError.message);
  }
  return next();
}

module.exports = presenceTouch;
