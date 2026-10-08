const { errorResponse } = require('../utils/response');

/* RNF-010: antes se reflejaba req.originalUrl, que incluye la query completa.
   Si alguien pone por error un token o una credencial en la query de una ruta
   inexistente, el backend se lo devolvia en el mensaje -- y ese mensaje acaba en
   logs de cliente, de proxy y en capturas. Medido con un token centinela: se
   reflejaba integro.
   Ahora solo se devuelve la ruta, sin query. */
function notFound(req, res, next) {
  return res.status(404).json(
    errorResponse(`Ruta no encontrada: ${req.method} ${req.path}`)
  );
}

module.exports = notFound;
