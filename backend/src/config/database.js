/* El pool de la aplicacion, con el modo SQL estricto garantizado por conexion.
 *
 * #105: mysql2 no ofrece ninguna opcion de configuracion para el sql_mode
 * —comprobado en la 3.22.5 instalada, no aparece ni como sql_mode ni como
 * initSql—, asi que las conexiones heredaban el del servidor. Medido, las
 * sesiones corrian en `IGNORE_SPACE,NO_ENGINE_SUBSTITUTION`: ni estricto, ni
 * siquiera igual al global, porque mysql2 anade IGNORE_SPACE por su cuenta.
 * Comprobar el modo desde otro cliente da una respuesta que no es la que vale.
 *
 * El modo permisivo no provoca el fallo: deja de avisar de el. Un texto mas
 * largo que su columna se guarda truncado, una fecha invalida se guarda como
 * fecha cero y un entero fuera de rango se recorta al maximo del tipo, todo
 * con un aviso que nadie lee.
 *
 * Por que NO se usa pool.on('connection'): en lib/base/pool.js de mysql2, el
 * emit va inmediatamente antes de entregar la conexion al que la pidio:
 *
 *     this.emit('connection', connection);
 *     this.emit('acquire', connection);
 *     return cb(null, connection);
 *
 * El manejador puede ser asincrono, pero nadie lo espera. Quien pidio la
 * conexion la recibe mientras el SET sigue en vuelo: una carrera, no una
 * garantia.
 *
 * Lo que se hace en su lugar es envolver la adquisicion. Toda conexion pasa
 * por `aseguraModo` ANTES de volver a quien la pidio, y la propiedad queda
 * sostenida por la estructura del codigo y no por el orden de los sucesos: no
 * hay forma de obtener una conexion de este modulo sin que su sesion se haya
 * LEIDO y resultado conforme.
 *
 * Por que se lee en cada adquisicion y no se recuerda: una marca solo prueba
 * que la sesion estuvo estricta alguna vez, no que lo siga estando. Cualquiera
 * que tenga la conexion puede ejecutar `SET SESSION sql_mode` y devolverla al
 * pool; con una marca, la siguiente adquisicion la daria por buena sin mirar.
 * El coste es un viaje de ida y vuelta por adquisicion —un SELECT sobre una
 * variable de sesion, sin tocar disco— y a cambio la garantia no depende de
 * que nadie haga algo que el pool no puede impedir.
 *
 * Si el SET o su comprobacion fallan, la conexion se DESTRUYE en vez de
 * devolverse al pool: una sesion cuyo modo no se pudo confirmar no debe
 * reutilizarse, y el error se propaga. Nunca se sigue en permisivo.
 */
const mysql = require('mysql2/promise');
const env = require('./env');

/* El estricto por defecto de MySQL 8.4, nombrado entero: lo que no se puede
   dar por supuesto es precisamente el modo del servidor. */
const BANDERAS = Object.freeze([
  'ONLY_FULL_GROUP_BY',
  'STRICT_TRANS_TABLES',
  'NO_ZERO_IN_DATE',
  'NO_ZERO_DATE',
  'ERROR_FOR_DIVISION_BY_ZERO',
  'NO_ENGINE_SUBSTITUTION',
]);

const MODO_ESTRICTO = BANDERAS.join(',');

/* Se exigen LAS SEIS que se configuran, no un subconjunto. ONLY_FULL_GROUP_BY
   entra aqui con las demas: las consultas agrupadas se auditaron contra ella,
   de modo que una sesion sin esa bandera no es la que se verifico.
   Se admiten banderas de mas —mysql2 anade IGNORE_SPACE—; lo que no se admite
   es que falte alguna de las seis. */
function cumpleModo(modo) {
  const presentes = new Set(String(modo || '').split(','));
  return BANDERAS.every((bandera) => presentes.has(bandera));
}

function faltantes(modo) {
  const presentes = new Set(String(modo || '').split(','));
  return BANDERAS.filter((bandera) => !presentes.has(bandera));
}

const base = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function modoDeLaSesion(conn) {
  const [filas] = await conn.query('SELECT @@SESSION.sql_mode AS modo');
  return (filas[0] && filas[0].modo) || '';
}

/* Deja la sesion en modo estricto, o lanza. Nunca devuelve sin haberlo
   comprobado leyendo el valor efectivo de ESA conexion. */
async function aseguraModo(conn) {
  let modo = await modoDeLaSesion(conn);
  if (cumpleModo(modo)) return modo;

  await conn.query(`SET SESSION sql_mode = '${MODO_ESTRICTO}'`);
  modo = await modoDeLaSesion(conn);

  if (!cumpleModo(modo)) {
    const error = new Error(
      'La conexion no quedo en modo SQL estricto: faltan ' + faltantes(modo).join(', ')
      + '. sql_mode efectivo: ' + (modo || '(vacio)')
      + '. No se ejecuta ninguna consulta sobre ella.',
    );
    error.code = 'SQL_MODE_NO_ESTRICTO';
    throw error;
  }
  return modo;
}

/* Unica puerta de entrada a una conexion. Si la verificacion falla, la
   conexion se descarta del pool y el error sube; no hay camino alternativo. */
async function getConnection() {
  const conn = await base.getConnection();
  try {
    await aseguraModo(conn);
  } catch (error) {
    try { conn.destroy(); } catch { /* ya caida: no hay nada que devolver */ }
    throw error;
  }
  return conn;
}

/* pool.query y pool.execute de mysql2 toman una conexion por su cuenta, sin
   pasar por getConnection, asi que no basta con envolver la adquisicion
   explicita: se reconstruyen sobre ella. */
async function query(...args) {
  const conn = await getConnection();
  try {
    return await conn.query(...args);
  } finally {
    conn.release();
  }
}

async function execute(...args) {
  const conn = await getConnection();
  try {
    return await conn.execute(...args);
  } finally {
    conn.release();
  }
}

/* Misma superficie publica que antes: los modelos usan query y getConnection,
   y las transacciones usan la conexion devuelta.
   No se expone el pool sin envolver: seria una via para obtener conexiones sin
   verificar, que es justo lo que este modulo existe para impedir. */
const pool = {
  query,
  execute,
  getConnection,
  end: (...args) => base.end(...args),
  escape: (...args) => base.escape(...args),
  escapeId: (...args) => base.escapeId(...args),
  format: (...args) => base.format(...args),
  on: (...args) => base.on(...args),
};

async function testConnection() {
  const connection = await getConnection();
  try {
    await connection.ping();
    return true;
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  testConnection,
  /* Expuestos para poder comprobarlos desde las pruebas sin abrir una via de
     adquisicion: son el contrato declarado, no un atajo al pool. */
  MODO_ESTRICTO,
  BANDERAS,
  cumpleModo,
};
