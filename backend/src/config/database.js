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
 * por `aseguraModo` ANTES de volver a quien la pidio, y la propiedad que se
 * busca queda sostenida por la estructura del codigo y no por el orden de los
 * sucesos: no hay forma de obtener una conexion de este modulo sin que su
 * sesion haya quedado verificada.
 *
 * La marca vive en la conexion FISICA (`conn.connection`), que el pool reusa;
 * el envoltorio de promesas es nuevo en cada adquisicion. Verificado: tras
 * release y nueva adquisicion, `a.connection === b.connection` y la marca
 * sobrevive, de modo que el SET se paga una vez por conexion fisica y no una
 * vez por consulta.
 *
 * Si el SET o su comprobacion fallan, la conexion se DESTRUYE en vez de
 * devolverse al pool: una sesion cuyo modo no se pudo confirmar no debe
 * reutilizarse, y el error se propaga. Nunca se sigue en permisivo.
 */
const mysql = require('mysql2/promise');
const env = require('./env');

/* El estricto por defecto de MySQL 8.4, nombrado entero: lo que no se puede
   dar por supuesto es precisamente el modo del servidor. */
const MODO_ESTRICTO = [
  'ONLY_FULL_GROUP_BY',
  'STRICT_TRANS_TABLES',
  'NO_ZERO_IN_DATE',
  'NO_ZERO_DATE',
  'ERROR_FOR_DIVISION_BY_ZERO',
  'NO_ENGINE_SUBSTITUTION',
].join(',');

/* Las que no pueden faltar para que un dato invalido sea error y no aviso. */
const EXIGIDAS = ['STRICT_TRANS_TABLES', 'NO_ZERO_DATE', 'NO_ZERO_IN_DATE'];

/* Symbol para que la marca no colisione con nada de mysql2. */
const VERIFICADA = Symbol('sql_mode estricto verificado');

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

/* La conexion fisica que el pool reutiliza, bajo el envoltorio de promesas. */
function fisica(conn) {
  return conn.connection || conn;
}

async function aseguraModo(conn) {
  const nucleo = fisica(conn);
  if (nucleo[VERIFICADA]) return;

  await conn.query(`SET SESSION sql_mode = '${MODO_ESTRICTO}'`);

  /* Se relee de la MISMA conexion: es el unico sitio donde el valor significa
     algo. @@GLOBAL diria otra cosa, y otra conexion del pool, otra distinta. */
  const [filas] = await conn.query('SELECT @@SESSION.sql_mode AS modo');
  const efectivo = (filas[0] && filas[0].modo) || '';
  const presentes = new Set(efectivo.split(','));
  const faltan = EXIGIDAS.filter((bandera) => !presentes.has(bandera));

  if (faltan.length) {
    const e = new Error(
      'La conexion no quedo en modo SQL estricto: faltan ' + faltan.join(', ')
      + '. sql_mode efectivo: ' + (efectivo || '(vacio)')
      + '. No se ejecuta ninguna consulta sobre ella.',
    );
    e.code = 'SQL_MODE_NO_ESTRICTO';
    throw e;
  }

  nucleo[VERIFICADA] = true;
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
   y las transacciones usan la conexion devuelta. */
const pool = {
  query,
  execute,
  getConnection,
  end: (...args) => base.end(...args),
  escape: (...args) => base.escape(...args),
  escapeId: (...args) => base.escapeId(...args),
  format: (...args) => base.format(...args),
  on: (...args) => base.on(...args),
  /* El pool sin envolver, para pruebas y diagnostico. No lo use el codigo de
     la aplicacion: sus conexiones no pasan por aseguraModo. */
  sinEnvolver: base,
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
  MODO_ESTRICTO,
  EXIGIDAS,
};
