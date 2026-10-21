/* RNF-044 / #105 — el modo SQL estricto en las conexiones del pool.
 *
 * El servidor se deja a proposito en modo permisivo durante toda esta suite:
 * si estuviera estricto, las pruebas pasarian sin que el pool hiciera nada, y
 * no demostrarian lo que dicen demostrar.
 *
 * Lo que se verifica no es que "suele" estar estricto, sino que no existe
 * camino por el que una consulta funcional alcance una sesion sin verificar:
 * conexion nueva, diez simultaneas, reutilizada, sustituida tras destruirla,
 * y el caso en que la verificacion falla.
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

let ctx = null;
let db = null;

/* El sql_mode global del servidor, para restituirlo al terminar. */
let modoOriginal = null;

before(async () => {
  const b = await banco.preparaTolerante('poolmodo');
  if (!b) return;
  ctx = b;
  db = require('../src/config/database');

  /* Conexion propia, ajena al pool de la aplicacion: cambiar el modo global
     desde el propio pool contaminaria lo que se quiere medir. */
  const [filas] = await ctx.pool.query('SELECT @@GLOBAL.sql_mode AS modo');
  modoOriginal = filas[0].modo;
  await ctx.pool.query("SET GLOBAL sql_mode='NO_ENGINE_SUBSTITUTION'");
});

after(async () => {
  if (ctx && modoOriginal !== null) {
    try {
      await ctx.pool.query('SET GLOBAL sql_mode=?', [modoOriginal]);
    } catch { /* el banco ya pudo cerrar su pool */ }
  }
  await banco.desmonta();
});

const EXIGIDAS = ['STRICT_TRANS_TABLES', 'NO_ZERO_DATE', 'NO_ZERO_IN_DATE'];

function esEstricto(modo) {
  const presentes = new Set(String(modo || '').split(','));
  return EXIGIDAS.every((b) => presentes.has(b));
}

async function modoDe(conn) {
  const [filas] = await conn.query('SELECT @@SESSION.sql_mode AS modo, CONNECTION_ID() AS id');
  return filas[0];
}

describe('el servidor esta permisivo mientras corre esta suite', () => {
  test('el global no es estricto, de modo que las pruebas no son vacias', async () => {
    banco.exigeBanco();
    const [filas] = await ctx.pool.query('SELECT @@GLOBAL.sql_mode AS modo');
    assert.equal(esEstricto(filas[0].modo), false,
      'el servidor esta estricto: estas pruebas no demostrarian nada');
  });
});

describe('modo estricto por conexion', () => {
  test('B7-A una conexion nueva llega con las banderas puestas', async () => {
    banco.exigeBanco();
    const conn = await db.pool.getConnection();
    try {
      const { modo } = await modoDe(conn);
      assert.ok(esEstricto(modo), 'la conexion no esta estricta: ' + modo);
    } finally {
      conn.release();
    }
  });

  test('B7-A bis pool.query tambien corre estricto, sin adquirir a mano', async () => {
    banco.exigeBanco();
    const [filas] = await db.pool.query('SELECT @@SESSION.sql_mode AS modo');
    assert.ok(esEstricto(filas[0].modo), 'pool.query corrio permisivo: ' + filas[0].modo);
  });

  test('B7-B diez conexiones fisicas simultaneas, todas estrictas y distintas', async () => {
    banco.exigeBanco();
    const conns = await Promise.all(Array.from({ length: 10 }, () => db.pool.getConnection()));
    try {
      const datos = await Promise.all(conns.map(modoDe));
      for (const d of datos) {
        assert.ok(esEstricto(d.modo), 'conexion ' + d.id + ' permisiva: ' + d.modo);
      }
      assert.equal(new Set(datos.map((d) => d.id)).size, 10,
        'no se abrieron diez conexiones fisicas distintas');
    } finally {
      for (const c of conns) c.release();
    }
  });

  test('B7-C una conexion devuelta y vuelta a tomar sigue estricta', async () => {
    banco.exigeBanco();
    const a = await db.pool.getConnection();
    const antes = await modoDe(a);
    a.release();
    const b = await db.pool.getConnection();
    const despues = await modoDe(b);
    b.release();
    assert.equal(despues.id, antes.id, 'no se reutilizo la misma conexion fisica');
    assert.ok(esEstricto(despues.modo), 'la reutilizada perdio el modo: ' + despues.modo);
  });

  test('B7-D destruida la conexion, la sustituta tambien llega estricta', async () => {
    banco.exigeBanco();
    const a = await db.pool.getConnection();
    const antes = await modoDe(a);
    a.destroy();
    const b = await db.pool.getConnection();
    const despues = await modoDe(b);
    b.release();
    assert.notEqual(despues.id, antes.id, 'no se creo una conexion nueva');
    assert.ok(esEstricto(despues.modo), 'la sustituta llego permisiva: ' + despues.modo);
  });

  test('B7-E la primera consulta nunca se adelanta a la inicializacion', async () => {
    banco.exigeBanco();
    /* Veinte consultas lanzadas a la vez sobre un pool de diez: las diez
       primeras crean conexion fisica y las otras diez esperan turno. Si la
       inicializacion no se esperase, alguna leeria el modo del servidor. */
    const modos = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const [filas] = await db.pool.query('SELECT @@SESSION.sql_mode AS modo');
        return filas[0].modo;
      }),
    );
    const permisivas = modos.filter((m) => !esEstricto(m));
    assert.equal(permisivas.length, 0,
      permisivas.length + ' de 20 consultas corrieron permisivas');
  });

  test('B7-F si la verificacion falla, no se entrega la conexion', async () => {
    banco.exigeBanco();
    /* Control negativo determinista: se fuerza el fallo haciendo que la
       comprobacion no encuentre lo que exige, y se comprueba que el error
       sube y que NO se devuelve ninguna conexion utilizable. */
    const sinEnvolver = db.pool.sinEnvolver;
    const original = sinEnvolver.getConnection.bind(sinEnvolver);
    let entregada = null;
    sinEnvolver.getConnection = async (...args) => {
      const conn = await original(...args);
      /* La conexion fisica ya puede venir marcada de las pruebas anteriores,
         y entonces aseguraModo saldria antes de hacer el SET y el control no
         probaria nada. Se retira la marca para forzar el camino completo. */
      const nucleo = conn.connection || conn;
      for (const s of Object.getOwnPropertySymbols(nucleo)) {
        if (String(s).includes('sql_mode')) delete nucleo[s];
      }
      /* Se sabotea la sesion despues del SET que hara aseguraModo, imitando
         un servidor que ignora la peticion. */
      const queryOriginal = conn.query.bind(conn);
      let primera = true;
      conn.query = async (sql, ...resto) => {
        if (primera && /SET SESSION sql_mode/i.test(String(sql))) {
          primera = false;
          return queryOriginal("SET SESSION sql_mode='NO_ENGINE_SUBSTITUTION'");
        }
        return queryOriginal(sql, ...resto);
      };
      entregada = conn;
      return conn;
    };

    try {
      await assert.rejects(
        () => db.pool.getConnection(),
        (e) => e.code === 'SQL_MODE_NO_ESTRICTO',
        'getConnection debio rechazar y no lo hizo',
      );
      await assert.rejects(
        () => db.pool.query('SELECT 1'),
        (e) => e.code === 'SQL_MODE_NO_ESTRICTO',
        'pool.query debio rechazar y no lo hizo',
      );
      assert.ok(entregada, 'el control negativo no llego a interceptar nada');
    } finally {
      sinEnvolver.getConnection = original;
    }

    /* Y despues del fallo el pool sigue sirviendo conexiones correctas. */
    const sana = await db.pool.getConnection();
    try {
      const { modo } = await modoDe(sana);
      assert.ok(esEstricto(modo), 'tras el fallo el pool entrega sesiones permisivas');
    } finally {
      sana.release();
    }
  });
});

describe('el contrato publico del pool se conserva', () => {
  test('query, execute, getConnection y las transacciones siguen funcionando', async () => {
    banco.exigeBanco();
    const [q] = await db.pool.query('SELECT 1 AS uno');
    assert.equal(q[0].uno, 1);

    const [e] = await db.pool.execute('SELECT ? AS dos', [2]);
    assert.equal(e[0].dos, 2);

    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query('SELECT 3 AS tres');
      assert.equal(r[0].tres, 3);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    for (const metodo of ['query', 'execute', 'getConnection', 'end', 'escape', 'format']) {
      assert.equal(typeof db.pool[metodo], 'function', 'falta pool.' + metodo);
    }
  });

  test('el modo estricto rechaza de verdad un dato invalido a traves del pool', async () => {
    banco.exigeBanco();
    await db.pool.query('CREATE TEMPORARY TABLE IF NOT EXISTS _p105 (v VARCHAR(5) NOT NULL)');
    /* Una tabla temporal vive en la sesion, asi que hay que usar una sola
       conexion para crearla y escribirla. */
    const conn = await db.pool.getConnection();
    try {
      await conn.query('CREATE TEMPORARY TABLE _p105b (v VARCHAR(5) NOT NULL)');
      await assert.rejects(
        () => conn.query("INSERT INTO _p105b (v) VALUES ('demasiado largo')"),
        (e) => e.errno === 1406,
        'el modo permisivo habria truncado en silencio',
      );
    } finally {
      conn.release();
    }
  });
});
