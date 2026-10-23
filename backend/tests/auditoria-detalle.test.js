/* #107 — el detalle de la auditoria.
 *
 * `safeDetail` hacia `JSON.stringify(d).slice(0, 2000)`: recortaba el texto YA
 * SERIALIZADO, de modo que el corte podia caer dentro de una cadena y dejar el
 * documento sin su comilla de cierre. Como `logs_acciones.detalle` es de tipo
 * JSON y la escritura ocurre dentro de la transaccion de quien audita, MySQL
 * respondia ER_INVALID_JSON_TEXT y tumbaba la operacion comercial entera.
 *
 * Medido antes de corregirlo: un vendedor que respondia una devolucion con
 * 1925 caracteres -el validador admite 2000- recibia un 500 y la devolucion
 * NO se guardaba. Por la via del administrador el umbral era 1927, porque el
 * nombre de la clave tambien ocupa sitio dentro del documento.
 *
 * ── El oraculo son DOS cosas, no una ──────────────────────────────────────
 * `JSON.parse` no basta. Un suplente sin pareja se serializa como \udXXX, que
 * `JSON.parse` acepta y MySQL rechaza. Por eso cada salida se inserta ademas
 * en una columna JSON real. Si alguien sustituye esa insercion por una
 * comprobacion en memoria, esta prueba dejara de detectar ese caso.
 *
 * ── El limite se mide en BYTES ────────────────────────────────────────────
 * `'漢'.length` es 1 y ocupa 3 bytes; un emoji mide 2 y ocupa 4. Contar
 * caracteres acotaria solo el texto ASCII.
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

const LIMITE = 2000;
const x = (n) => 'x'.repeat(n);
const CARRO = '\u{1F6D2}';          /* U+1F6D2: dos unidades UTF-16, 4 bytes */
const bytes = (t) => Buffer.byteLength(t, 'utf8');

const circular = { a: 1 };
circular.yo = circular;

/* Las 27 entradas de la bateria. Cada una existe por un motivo distinto:
   el escapado, el multibyte, los suplentes, la anchura, la profundidad y
   los valores que `JSON.stringify` no sabe serializar. */
const CASOS = [
  ['null', null],
  ['undefined', undefined],
  ['cadena vacia', ''],
  ['objeto vacio', {}],
  ['detalle tipico de pago', { metodo: 'sandbox_card', estado_pago: 'pagado', createdShipments: 1 }],
  ['frontera justo por debajo', { t: x(1900) }],
  ['frontera justo por encima', { t: x(1990) }],
  ['el caso medido de la devolucion', { estado_anterior: 'solicitada', estado: 'aprobada', respuesta_vendedor: x(2000) }],
  ['cadena enorme', { t: x(200000) }],
  ['solo comillas (el escapado duplica)', { t: '"'.repeat(1500) }],
  ['solo barras invertidas', { t: '\\'.repeat(1500) }],
  ['saltos de linea y tabuladores', { t: '\n\t'.repeat(1200) }],
  ['caracteres de control', { t: '\u0001\u0002\u0003'.repeat(900) }],
  ['acentos y enies', { t: 'áéíóúñÁÉÍÓÚÑ'.repeat(400) }],
  ['emojis en la frontera', { t: CARRO.repeat(1200) }],
  ['suplente suelto de entrada', { t: '\ud83d' + x(2100) }],
  ['CJK', { t: '漢字仮名'.repeat(800) }],
  ['combinantes', { t: 'é'.repeat(1500) }],
  ['arreglo largo', { items: Array.from({ length: 5000 }, (_, i) => i) }],
  ['arreglo de objetos', { items: Array.from({ length: 400 }, (_, i) => ({ id: i, nombre: x(40) })) }],
  ['anidamiento profundo', (() => { let o = { hoja: x(3000) }; for (let i = 0; i < 40; i += 1) o = { n: o }; return o; })()],
  ['muchas claves', Object.fromEntries(Array.from({ length: 900 }, (_, i) => ['k' + i, i]))],
  ['referencia circular', circular],
  ['BigInt', { n: BigInt(10) ** BigInt(30) }],
  ['fechas y NaN', { f: new Date(0), n: NaN, i: Infinity }],
  ['valor suelto que no es objeto', 'una cadena larga ' + x(3000)],
  ['arreglo en la raiz', Array.from({ length: 2000 }, () => 'texto')],
];

let ctx = null;
let safeDetail = null;

before(async () => {
  const b = await banco.preparaTolerante('auditoria');
  if (!b) return;
  /* `prepara` fija DB_NAME antes de que nadie cargue la configuracion, asi
     que el modelo se pide DESPUES y no antes, como en el resto de la suite. */
  ({ safeDetail } = require('../src/models/log.model'));
  await b.pool.query('CREATE TABLE sonda_detalle (id INT AUTO_INCREMENT PRIMARY KEY, d JSON NULL) ENGINE=InnoDB');
  ctx = b;
});

after(async () => { await banco.desmonta(); });

describe('#107 — el detalle de auditoria siempre es JSON que MySQL acepta', () => {
  for (const [nombre, entrada] of CASOS) {
    test(nombre, async () => {
      banco.exigeBanco(ctx);
      const salida = safeDetail(entrada);        /* no debe lanzar jamas */

      if (salida === null) return;               /* ausencia de detalle: valido */
      assert.equal(typeof salida, 'string', 'cuando devuelve algo, devuelve texto');

      /* Primer oraculo: es JSON para JavaScript. */
      assert.doesNotThrow(() => JSON.parse(salida), 'la salida debe ser JSON valido');

      /* Segundo oraculo, el que de verdad decide: MySQL lo acepta en una
         columna JSON. Sin esto, un suplente suelto pasaria desapercibido. */
      await assert.doesNotReject(
        ctx.pool.query('INSERT INTO sonda_detalle (d) VALUES (?)', [salida]),
        'MySQL debe aceptar la salida en una columna JSON'
      );

      /* El limite, en bytes. */
      assert.ok(bytes(salida) <= LIMITE,
        `la salida ocupa ${bytes(salida)} bytes y el limite es ${LIMITE}`);
    });
  }
});

describe('#107 — el limite se mide en bytes, no en caracteres', () => {
  test('un detalle en CJK no supera el limite en BYTES', () => {
    banco.exigeBanco(ctx);
    const salida = safeDetail({ t: '漢'.repeat(100000) });
    assert.ok(bytes(salida) <= LIMITE, `ocupa ${bytes(salida)} bytes`);
    /* Y la comprobacion que distingue las dos magnitudes: si la cota fuese
       en caracteres, aqui cabrian ~2000 y el documento pesaria ~6000 bytes. */
    assert.ok(salida.length < LIMITE,
      'con texto multibyte deben caber MENOS caracteres que el limite de bytes');
  });

  test('un detalle con emojis tampoco', () => {
    banco.exigeBanco(ctx);
    const salida = safeDetail({ t: CARRO.repeat(100000) });
    assert.ok(bytes(salida) <= LIMITE, `ocupa ${bytes(salida)} bytes`);
  });

  test('un detalle ASCII aprovecha casi todo el limite', () => {
    banco.exigeBanco(ctx);
    const salida = safeDetail({ t: x(100000) });
    assert.ok(bytes(salida) > LIMITE * 0.9,
      'con ASCII no debe desperdiciarse el espacio disponible');
  });
});

describe('#107 — el registro dice lo que falta y no filtra lo que guarda', () => {
  test('conserva los campos del caso real y marca el recorte', () => {
    banco.exigeBanco(ctx);
    const salida = safeDetail({ estado_anterior: 'solicitada', estado: 'aprobada', respuesta_vendedor: x(2000) });
    const obj = JSON.parse(salida);
    assert.equal(obj.estado_anterior, 'solicitada', 'los campos cortos se conservan enteros');
    assert.equal(obj.estado, 'aprobada');
    assert.ok(obj.respuesta_vendedor.length > 1500, 'se conserva la mayor parte del texto largo');
    assert.ok('_recortado' in obj, 'el recorte se declara, no se oculta');
  });

  test('un detalle que no se puede serializar deja constancia de la causa', () => {
    banco.exigeBanco(ctx);
    for (const entrada of [circular, { n: BigInt(1) }]) {
      const obj = JSON.parse(safeDetail(entrada));
      assert.equal(obj._recortado, true);
      assert.equal(obj._motivo, 'detalle no serializable');
      assert.ok(obj._causa, 'se nombra la causa');
    }
  });

  test('la causa no arrastra el mensaje de la excepcion', () => {
    banco.exigeBanco(ctx);
    /* El mensaje de una referencia circular enumera el camino de propiedades
       del objeto auditado; guardarlo filtraria estructura del detalle. */
    const sensible = { token_secreto: 'abc123' };
    sensible.yo = sensible;
    const salida = safeDetail(sensible);
    assert.ok(!salida.includes('token_secreto'), 'no debe aparecer ninguna clave del detalle');
    assert.ok(!salida.includes('circular structure'), 'no debe aparecer el mensaje de la excepcion');
  });

  test('nunca lanza, pase lo que pase', () => {
    banco.exigeBanco(ctx);
    const hostiles = [circular, { n: BigInt(1) }, Symbol('s'), () => {}, new Map(), new Set([1, 2])];
    for (const h of hostiles) assert.doesNotThrow(() => safeDetail(h));
  });
});

describe('#107 — control negativo: el serializador anterior falla esta bateria', () => {
  /* Si esta prueba deja de fallar con el algoritmo viejo, la bateria ha
     dejado de discriminar y las demas no prueban nada. */
  const roto = (d) => (d ? JSON.stringify(d).slice(0, 2000) : null);

  test('el algoritmo publicado en f4d29af produce JSON invalido o lanza', () => {
    banco.exigeBanco(ctx);
    let malos = 0;
    for (const [, entrada] of CASOS) {
      let s = null;
      try { s = roto(entrada); } catch (e) { malos += 1; continue; }
      if (s === null) continue;
      try { JSON.parse(s); } catch (e) { malos += 1; }
    }
    assert.ok(malos > 0,
      'el control debe fallar con el algoritmo viejo; si no, la bateria no discrimina');
  });
});
