const { errorResponse } = require('../utils/response');
const env = require('../config/env');

/* RNF-010: el cliente no debe recibir informacion sensible en los errores.

   Antes, con NODE_ENV=development -- que es el valor por defecto de env.js y el
   de .env.example -- CUALQUIER error devolvia al cliente err.message y el stack
   completo. Medido: un 500 por un fallo de MySQL entregaba 1.280 bytes con la
   traza, las rutas fisicas del proyecto, el mensaje del motor y el nombre de la
   base de datos. El diagnostico no se pierde: pasa al log del servidor.

   Y habia una fuga que ocurria TAMBIEN en produccion: para los 4xx se devolvia
   err.message tal cual, asi que el ENOENT de express.static publicaba la ruta
   absoluta del fichero a cualquiera sin autenticar.

   La distincion la da el propio framework. http-errors marca expose=false en los
   errores cuyo mensaje no es presentable -- el ENOENT del estatico, por ejemplo
   -- y expose=true en los de cliente que si lo son, como el cuerpo mal formado.
   Los errores propios de la aplicacion se crean con `new Error(mensaje)` mas
   statusCode y no traen expose, de modo que su mensaje funcional se conserva:
   "Producto no encontrado", "No tiene permisos para acceder a este recurso". */

// Errores de sistema o de driver cuyo mensaje nunca es presentable.
const CODIGOS_INTERNOS = /^(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|EBUSY|EMFILE|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|ER_|PROTOCOL_|POOL_)/;

function esMensajePresentable(err) {
  if (err.expose === false) return false;
  if (typeof err.code === 'string' && CODIGOS_INTERNOS.test(err.code)) return false;
  if (typeof err.sqlMessage === 'string') return false;
  return typeof err.message === 'string' && err.message.trim() !== '';
}

const GENERICO_POR_ESTADO = {
  400: 'Solicitud inválida.',
  401: 'No autenticado.',
  403: 'No tiene permisos para acceder a este recurso.',
  404: 'Recurso no encontrado.',
  409: 'La solicitud entra en conflicto con el estado actual.',
  413: 'La solicitud es demasiado grande.',
  415: 'Tipo de contenido no soportado.',
  429: 'Demasiados intentos. Intenta nuevamente más tarde.',
};

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;

  /* El detalle se registra en el servidor, donde si hace falta para diagnosticar.
     Nunca viaja al cliente. */
  const traza = statusCode >= 500 || env.nodeEnv === 'development';
  if (traza) {
    console.error(`[error] ${req.method} ${req.path} -> ${statusCode}`, err.stack || err.message);
  }

  const mensaje = statusCode >= 500
    ? 'Error interno del servidor'
    : (esMensajePresentable(err) ? err.message : (GENERICO_POR_ESTADO[statusCode] || 'Solicitud no procesada.'));

  return res.status(statusCode).json(errorResponse(mensaje, []));
}

module.exports = errorHandler;
