/* RNF-044 / #105 — el modo SQL estricto en las conexiones del pool.
 *
 * Estas pruebas NO tocan la configuracion global del servidor. Hacerlo
 * afectaria a cualquier otra conexion de la instancia, los ficheros de
 * node:test pueden correr a la vez, y una restauracion fallida dejaria el
 * servidor cambiado. En su lugar, lo que se demuestra se demuestra sobre
 * sesiones: se estropea una sesion concreta y se comprueba que el pool no
 * entrega esa sesion estropeada.
 *
 * Esa via es ademas mas fuerte: vale igual si el servidor esta permisivo o
 * estricto, porque no mide lo que la sesion hereda sino lo que el pool impone.
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

let ctx = null;
let db = null;

before(async () => {
  const b = await banco.preparaTolerante('poolmodo');
  if (!b) return;
  ctx = b;
  db = require('../src/config/database');
});

/* Sin try/catch que trague: si el desmontaje falla, la suite debe enterarse. */
after(banco.desmonta);

async function sesionDe(conn) {
  const [filas] = await conn.query('SELECT @@SESSION.sql_mode AS modo, CONNECTION_ID() AS id');
  return filas[0];
}

/* Deja la sesion de esa conexion en un modo dado, por debajo del pool. */
async function estropea(conn, modo) {
  await conn.query('SET SESSION sql_mode = ?', [modo]);
}

const PERMISIVO = 'NO_ENGINE_SUBSTITUTION';
/* Las tres banderas que la primera version de este codigo exigia: una sesion
   asi pasaba la comprobacion antigua y no tiene ONLY_FULL_GROUP_BY. */
const TRES_BANDERAS = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE';

describe('el contrato declarado del modo', () => {
  test('I5 cumpleModo exige las seis banderas configuradas', () => {
    banco.exigeBanco();
    assert.equal(db.BANDERAS.length, 6);
    assert.ok(db.cumpleModo(db.MODO_ESTRICTO), 'el modo que se configura deberia cumplirse a si mismo');
    assert.ok(db.cumpleModo(db.MODO_ESTRICTO + ',IGNORE_SPACE'),
      'una bandera de mas no deberia invalidar la sesion');
    assert.equal(db.cumpleModo(PERMISIVO), false);
    assert.equal(db.cumpleModo(''), false);
  });

  test('I5 control negativo: sin ONLY_FULL_GROUP_BY no se cumple', () => {
    banco.exigeBanco();
    /* Este es el caso que la version anterior aceptaba: tiene las tres
       banderas que entonces se exigian, y le falta la que B6-D audito. */
    assert.equal(db.cumpleModo(TRES_BANDERAS), false,
      'una sesion sin ONLY_FULL_GROUP_BY no debe superar la verificacion');
    for (const bandera of db.BANDERAS) {
      const sinUna = db.BANDERAS.filter((b) => b !== bandera).join(',');
      assert.equal(db.cumpleModo(sinUna), false, 'deberia faltar ' + bandera);
    }
  });
});

describe('modo estricto por conexion', () => {
  test('B7-A una conexion nueva llega con las seis banderas', async () => {
    banco.exigeBanco();
    const conn = await db.pool.getConnection();
    try {
      const { modo } = await sesionDe(conn);
      assert.ok(db.cumpleModo(modo), 'la conexion no esta estricta: ' + modo);
    } finally {
      conn.release();
    }
  });

  test('B7-A bis pool.query tambien corre estricto, sin adquirir a mano', async () => {
    banco.exigeBanco();
    const [filas] = await db.pool.query('SELECT @@SESSION.sql_mode AS modo');
    assert.ok(db.cumpleModo(filas[0].modo), 'pool.query corrio permisivo: ' + filas[0].modo);
  });

  test('B7-B diez conexiones fisicas simultaneas, todas estrictas y distintas', async () => {
    banco.exigeBanco();
    const conns = await Promise.all(Array.from({ length: 10 }, () => db.pool.getConnection()));
    try {
      const datos = await Promise.all(conns.map(sesionDe));
      for (const d of datos) {
        assert.ok(db.cumpleModo(d.modo), 'conexion ' + d.id + ' permisiva: ' + d.modo);
      }
      assert.equal(new Set(datos.map((d) => d.id)).size, 10,
        'no se abrieron diez conexiones fisicas distintas');
    } finally {
      for (const c of conns) c.release();
    }
  });

  test('I3 una sesion devuelta al pool en permisivo no se reutiliza asi', async () => {
    banco.exigeBanco();
    /* El contraejemplo que la version con marca no cubria: la conexion ya
       estuvo verificada, alguien le cambia el modo, y vuelve al pool. */
    const a = await db.pool.getConnection();
    const antes = await sesionDe(a);
    await estropea(a, PERMISIVO);
    const estropeada = await sesionDe(a);
    assert.equal(db.cumpleModo(estropeada.modo), false, 'no se logro estropear la sesion');
    a.release();

    const b = await db.pool.getConnection();
    try {
      const despues = await sesionDe(b);
      assert.equal(despues.id, antes.id,
        'no se reutilizo la misma conexion fisica: el control no probo nada');
      assert.ok(db.cumpleModo(despues.modo),
        'se entrego una sesion permisiva reutilizada: ' + despues.modo);
    } finally {
      b.release();
    }
  });

  test('I4 lo mismo a traves de pool.query, que no adquiere a mano', async () => {
    banco.exigeBanco();
    const a = await db.pool.getConnection();
    const antes = await sesionDe(a);
    await estropea(a, TRES_BANDERAS);
    a.release();

    const [filas] = await db.pool.query(
      'SELECT @@SESSION.sql_mode AS modo, CONNECTION_ID() AS id');
    assert.equal(filas[0].id, antes.id, 'no se reutilizo la misma conexion fisica');
    assert.ok(db.cumpleModo(filas[0].modo),
      'pool.query corrio sobre una sesion sin ONLY_FULL_GROUP_BY: ' + filas[0].modo);
  });

  test('B7-D destruida la conexion, la sustituta tambien llega estricta', async () => {
    banco.exigeBanco();
    const a = await db.pool.getConnection();
    const antes = await sesionDe(a);
    a.destroy();
    const b = await db.pool.getConnection();
    try {
      const despues = await sesionDe(b);
      assert.notEqual(despues.id, antes.id, 'no se creo una conexion nueva');
      assert.ok(db.cumpleModo(despues.modo), 'la sustituta llego permisiva: ' + despues.modo);
    } finally {
      b.release();
    }
  });

  test('B7-E la primera consulta nunca se adelanta a la inicializacion', async () => {
    banco.exigeBanco();
    /* Veinte consultas a la vez sobre un pool de diez: las diez primeras crean
       conexion fisica y las otras diez esperan turno. */
    const modos = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const [filas] = await db.pool.query('SELECT @@SESSION.sql_mode AS modo');
        return filas[0].modo;
      }),
    );
    const permisivas = modos.filter((m) => !db.cumpleModo(m));
    assert.equal(permisivas.length, 0,
      permisivas.length + ' de 20 consultas corrieron permisivas');
  });

  test('B7-F si el SET no surte efecto, no se entrega la conexion', async () => {
    banco.exigeBanco();
    /* Control negativo determinista. Se interviene la conexion FISICA para
       imitar un servidor que acepta el SET y no lo aplica: la lectura siempre
       devuelve permisivo. aseguraModo debe leer, intentar el SET, releer,
       seguir sin cumplir, destruir y lanzar. */
    const victima = await db.pool.getConnection();
    const nucleo = victima.connection;
    const idVictima = (await sesionDe(victima)).id;
    const queryOriginal = nucleo.query.bind(nucleo);
    let interceptadas = 0;

    nucleo.query = function (sql, ...resto) {
      const texto = typeof sql === 'string' ? sql : (sql && sql.sql) || '';
      if (/@@SESSION\.sql_mode/i.test(texto)) {
        interceptadas += 1;
        return queryOriginal("SELECT 'NO_ENGINE_SUBSTITUTION' AS modo", ...resto);
      }
      if (/SET SESSION sql_mode/i.test(texto)) {
        interceptadas += 1;
        return queryOriginal('SELECT 1', ...resto);
      }
      return queryOriginal(sql, ...resto);
    };
    victima.release();

    try {
      await assert.rejects(
        () => db.pool.getConnection(),
        (e) => e.code === 'SQL_MODE_NO_ESTRICTO',
        'getConnection debio rechazar la conexion saboteada',
      );
      assert.ok(interceptadas >= 2,
        'el sabotaje no llego a ejercitar lectura y SET: ' + interceptadas);
    } finally {
      nucleo.query = queryOriginal;
    }

    /* Y la conexion saboteada quedo fuera del pool, no devuelta a la cola. */
    const sana = await db.pool.getConnection();
    try {
      const d = await sesionDe(sana);
      assert.notEqual(d.id, idVictima, 'la conexion rechazada volvio al pool');
      assert.ok(db.cumpleModo(d.modo), 'tras el fallo el pool entrega sesiones permisivas');
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

  test('I6 ninguna PROPIEDAD del pool permite adquirir sin verificar', () => {
    banco.exigeBanco();
    for (const clave of Object.keys(db.pool)) {
      const v = db.pool[clave];
      assert.equal(typeof v === 'object' && v !== null && typeof v.getConnection === 'function',
        false, 'pool.' + clave + ' permite adquirir conexiones sin verificar');
    }
    assert.equal(db.pool.sinEnvolver, undefined, 'sigue expuesto el pool sin envolver');
    assert.equal(db.pool.pool, undefined, 'sigue expuesto el pool interno');
  });

  test('I9-A lo que devuelve on() tampoco permite adquirir sin verificar', () => {
    banco.exigeBanco();
    /* EventEmitter.on devuelve el receptor. Reenviar ese valor entregaria el
       pool de mysql2 sin envolver, y de ahi getConnection sin verificacion. */
    const oyente = () => {};
    const devuelto = db.pool.on('enqueue', oyente);
    try {
      assert.equal(devuelto, db.pool, 'on() no devolvio el envoltorio');
      /* Lo devuelto es el envoltorio, asi que SI tiene getConnection: lo que
         importa es que sea el verificado y no el del pool de mysql2. */
      assert.equal(devuelto.getConnection, db.pool.getConnection,
        'on() devolvio un objeto con un getConnection distinto del verificado');
      assert.equal(typeof devuelto.sinEnvolver, 'undefined');
    } finally {
      db.pool.on('enqueue', () => {});
    }
  });

  test('I10-A el contexto del oyente es el envoltorio, no el pool interno', async () => {
    banco.exigeBanco();
    /* Node llama a un oyente tradicional con `this` en el emisor. Sin
       intermediario, ese emisor es el PromisePool interno y un
       `function () { this.getConnection() }` tendria via libre. */
    const contextos = [];
    db.pool.on('enqueue', function oyenteTradicional() { contextos.push(this); });

    /* El pool tiene 10 conexiones: con 14 consultas a la vez, las ultimas se
       encolan y disparan enqueue. */
    await Promise.all(Array.from({ length: 14 }, () => db.pool.query('SELECT SLEEP(0.05)')));

    assert.ok(contextos.length > 0, 'el evento enqueue no llego a dispararse');
    for (const ctxOyente of contextos) {
      assert.equal(ctxOyente, db.pool, 'el oyente recibio un contexto que no es el envoltorio');
      /* I10-B: y por tanto su getConnection es el verificado, no otro. */
      assert.equal(ctxOyente.getConnection, db.pool.getConnection);
      assert.equal(ctxOyente.sinEnvolver, undefined);
    }
  });

  test('I9-B los eventos que entregan conexiones crudas no se reenvian', async () => {
    banco.exigeBanco();
    /* connection, acquire y release pasan al oyente la PoolConnection anterior
       a aseguraModo. Suscribirse seria una via para usar una sesion sin
       verificar, asi que se rechaza con un error claro. */
    for (const evento of ['connection', 'acquire', 'release']) {
      assert.throws(
        () => db.pool.on(evento, () => {}),
        (e) => e.code === 'EVENTO_NO_EXPUESTO',
        'el evento ' + evento + ' se reenvio pese a entregar conexiones',
      );
    }
    for (const evento of db.pool.EVENTOS_SEGUROS) {
      assert.doesNotThrow(() => db.pool.on(evento, () => {}),
        'el evento seguro ' + evento + ' deberia poder suscribirse');
    }

    /* Y comprobado de verdad: tras intentar suscribirse a los tres, ningun
       oyente recibio conexion alguna durante una adquisicion real. */
    let recibidas = 0;
    for (const evento of ['connection', 'acquire', 'release']) {
      try { db.pool.on(evento, () => { recibidas += 1; }); } catch { /* esperado */ }
    }
    const conn = await db.pool.getConnection();
    conn.release();
    assert.equal(recibidas, 0, 'un oyente recibio ' + recibidas + ' conexiones crudas');
  });

  test('el modo estricto rechaza de verdad un dato invalido a traves del pool', async () => {
    banco.exigeBanco();
    const conn = await db.pool.getConnection();
    try {
      await conn.query('CREATE TEMPORARY TABLE _p105 (v VARCHAR(5) NOT NULL)');
      await assert.rejects(
        () => conn.query("INSERT INTO _p105 (v) VALUES ('demasiado largo')"),
        (e) => e.errno === 1406,
        'el modo permisivo habria truncado en silencio',
      );
    } finally {
      conn.release();
    }
  });
});
