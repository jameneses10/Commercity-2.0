/* Ejecuta las migraciones en una unica sesion, y en modo SQL estricto.
 *
 * #105: el pool no fija `sql_mode`, asi que sus conexiones heredan el del
 * servidor. Medido contra este proyecto, las sesiones del pool corrian en
 * `IGNORE_SPACE,NO_ENGINE_SUBSTITUTION`: ni estricto, ni igual al global
 * —mysql2 anade IGNORE_SPACE por su cuenta—, de modo que comprobar el modo
 * desde otro cliente da una respuesta que no es la que vale.
 *
 * El modo permisivo no provoca el fallo: deja de avisar de el. Una fecha cero
 * o un truncamiento pasan a ser advertencia en vez de error, y la migracion
 * los escribe en silencio. Es lo que mantuvo invisible el defecto del indice
 * funcional de la 020 durante toda la serie de requisitos.
 *
 * Por eso aqui se reserva UNA conexion, se le fija el modo, se comprueba que
 * lo tiene de verdad y se ejecutan por ella las veinte migraciones. La
 * comprobacion no es ceremonia: si el SET no surtiese efecto, migrariamos sin
 * red creyendo lo contrario, y es justo entonces cuando hay que pararse.
 *
 * Una sola conexion tambien es un requisito funcional, no una comodidad: las
 * migraciones 012, 019 y 020 usan variables de sesion (@sql, @expr_actual) con
 * PREPARE/EXECUTE. Repartidas entre conexiones del pool, esas variables
 * vendrian vacias y las sentencias preparadas fallarian.
 *
 * Esto arregla el migrador, no el backend: las conexiones de la aplicacion
 * siguen heredando el modo del servidor. Ese es el resto de #105.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

/* El estricto por defecto de MySQL 8.4. Se nombra entero en vez de confiar en
   el del servidor, que es precisamente lo que no se puede dar por supuesto. */
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

async function fijaModoEstricto(connection) {
  await connection.query(`SET SESSION sql_mode = '${MODO_ESTRICTO}'`);

  /* Se relee de la MISMA conexion: es el unico sitio donde el valor significa
     algo. @@GLOBAL diria otra cosa, y otra conexion del pool, otra distinta. */
  const [filas] = await connection.query('SELECT @@SESSION.sql_mode AS modo');
  const efectivo = (filas[0] && filas[0].modo) || '';
  const presentes = new Set(efectivo.split(','));
  const faltan = EXIGIDAS.filter((bandera) => !presentes.has(bandera));

  if (faltan.length) {
    throw new Error(
      'la sesion de migracion no quedo en modo estricto: faltan ' + faltan.join(', ')
      + '. sql_mode efectivo: ' + (efectivo || '(vacio)')
      + '. No se ejecuta ninguna migracion.',
    );
  }

  return efectivo;
}

async function runSqlFile(connection, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await connection.query(statement);
  }
}

async function migrate() {
  const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const connection = await pool.getConnection();
  try {
    const modo = await fijaModoEstricto(connection);
    console.log(`Modo SQL de la sesión: ${modo}`);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      await runSqlFile(connection, filePath);
      console.log(`Migración ejecutada: ${file}`);
    }
  } finally {
    /* En finally para que una migracion fallida no deje la conexion retenida:
       el pool no termina de cerrarse mientras quede una prestada. */
    connection.release();
  }
}

migrate()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error('Error ejecutando migraciones:', error.message);
    await pool.end();
    process.exit(1);
  });
