// RF-288: unica fuente de verdad del estado de conexion del chat.
// Un usuario esta "en linea" si registro actividad autenticada dentro de la
// ventana. La marca se refresca como maximo una vez por intervalo de latido,
// para no escribir en cada peticion.
const PRESENCE_WINDOW_MINUTES = 5;
const PRESENCE_TOUCH_SECONDS = 60;

module.exports = { PRESENCE_WINDOW_MINUTES, PRESENCE_TOUCH_SECONDS };
