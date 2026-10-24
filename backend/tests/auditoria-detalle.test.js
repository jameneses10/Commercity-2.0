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

describe('#107 — suplentes sueltos, sean cortos o largos', () => {
  /* El caso corto escapa a la biseccion: entra por el camino rapido. La
     primera correccion solo miraba la cadena ya serializada, donde
     `JSON.stringify` ha convertido el suplente en el texto ASCII \udXXX, de
     modo que {t:'\uD83D'} salia sin limpiar y MySQL lo rechazaba aunque
     `JSON.parse` lo aceptase. De ahi que la longitud sea una dimension de
     esta tabla y no un detalle. */
  const ALTO = '\uD83D';          /* mitad alta sin su pareja */
  const BAJO = '\uDC00';          /* mitad baja sin su pareja */
  const EMOJI = '\u{1F600}';      /* par completo: no debe tocarse */

  const SUPLENTES = [
    ['alto suelto, corto', { t: ALTO }],
    ['bajo suelto, corto', { t: BAJO }],
    ['alto suelto en la clave, corto', { [ALTO]: 'x' }],
    ['bajo suelto en la clave, corto', { [BAJO]: 'x' }],
    ['alto suelto, anidado y corto', { a: { b: [ALTO] } }],
    ['alto suelto, largo', { t: ALTO + x(2100) }],
    ['bajo suelto, largo', { t: BAJO + x(2100) }],
    ['alto suelto en la clave, largo', { [ALTO]: x(2100) }],
    ['los dos sueltos y en orden invertido', { t: BAJO + ALTO }],
  ];

  for (const [nombre, entrada] of SUPLENTES) {
    test(nombre, async () => {
      banco.exigeBanco(ctx);
      const salida = safeDetail(entrada);
      assert.doesNotThrow(() => JSON.parse(salida));
      await assert.doesNotReject(
        ctx.pool.query('INSERT INTO sonda_detalle (d) VALUES (?)', [salida]),
        'MySQL debe aceptar la salida; `JSON.parse` solo no lo garantiza'
      );
      assert.ok(bytes(salida) <= LIMITE);
    });
  }

  test('un par valido se conserva intacto, corto y largo', async () => {
    banco.exigeBanco(ctx);
    for (const entrada of [{ t: EMOJI }, { t: 'hola ' + EMOJI + ' mundo' }]) {
      const salida = safeDetail(entrada);
      assert.ok(JSON.parse(salida).t.includes(EMOJI),
        'neutralizar los sueltos no debe tocar los pares completos');
      await assert.doesNotReject(ctx.pool.query('INSERT INTO sonda_detalle (d) VALUES (?)', [salida]));
    }
  });

  test('un detalle corto y limpio sale tal cual, sin marca de recorte', () => {
    banco.exigeBanco(ctx);
    const salida = safeDetail({ metodo: 'sandbox_card', estado_pago: 'pagado' });
    assert.equal(salida, JSON.stringify({ metodo: 'sandbox_card', estado_pago: 'pagado' }),
      'el camino rapido no debe alterar un detalle que no lo necesita');
  });

  test('un objeto ancho pero pequeno no se recorta por pasar a normalizar', () => {
    banco.exigeBanco(ctx);
    /* Mas claves que ANCHURA, pero cabe de sobra: normalizar no debe
       aplicarle las cotas de anchura, que son del camino de recorte. */
    const ancho = Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['k' + i, ALTO]));
    const obj = JSON.parse(safeDetail(ancho));
    assert.equal(Object.keys(obj).length, 80, 'no debe perder claves');
    assert.ok(!('_recortado' in obj), 'no es un recorte, es una normalizacion');
  });
});

describe('#107 — se conserva lo que `JSON.stringify` ya habia decidido', () => {
  /* `normaliza` y `acota` recorrian el OBJETO ORIGINAL en vez de la
     representacion serializada, y eso rompia dos cosas a la vez:

       · una `Date` desaparecia. `Object.keys(new Date())` esta vacio, asi
         que la copia quedaba en {} en lugar de su cadena ISO. Ocurria en
         los dos caminos, el de normalizacion y el de recorte.
       · un objeto con ciclo y `toJSON` lo resolvia `JSON.stringify` sin
         problema, pero el recorrido volvia a entrar en el ciclo y lanzaba
         RangeError: justo la clase de excepcion que este serializador
         existe para no provocar.

     El oraculo de este bloque es el propio `JSON.stringify`: lo que
     `safeDetail` guarde debe coincidir con lo que aquel habria guardado,
     salvo por el recorte y la limpieza, que se declaran aparte. */
  const FECHA = new Date('2026-10-23T19:00:00.000Z');
  const ISO = '2026-10-23T19:00:00.000Z';
  const ALTO = '\uD83D';

  /* Ciclo que `toJSON` resuelve: stringify termina, recorrerlo no. */
  const conToJSON = { nombre: 'pedido' };
  conToJSON.padre = conToJSON;
  conToJSON.toJSON = function () { return { nombre: this.nombre, resumen: 'ok' }; };

  test('una fecha sobrevive a que otro campo obligue a normalizar', () => {
    banco.exigeBanco(ctx);
    const obj = JSON.parse(safeDetail({ fecha: FECHA, respuesta: ALTO }));
    assert.equal(obj.fecha, ISO, 'la fecha no debe convertirse en {}');
  });

  test('una fecha sobrevive al camino de recorte', () => {
    banco.exigeBanco(ctx);
    const obj = JSON.parse(safeDetail({ fecha: FECHA, texto: x(3000) }));
    assert.equal(obj.fecha, ISO);
  });

  test('un objeto con ciclo y toJSON no provoca recursion', () => {
    banco.exigeBanco(ctx);
    for (const entrada of [{ d: conToJSON, t: ALTO }, { d: conToJSON, texto: x(3000) }]) {
      let salida;
      assert.doesNotThrow(() => { salida = safeDetail(entrada); },
        'toJSON resuelve el ciclo; recorrer el original lo reintroducia');
      assert.deepEqual(JSON.parse(salida).d, { nombre: 'pedido', resumen: 'ok' });
    }
  });

  test('normalizar no pierde claves que caben', () => {
    banco.exigeBanco(ctx);
    const ancho = Object.fromEntries([['s', ALTO],
      ...Array.from({ length: 20 }, (_, i) => ['f' + i, FECHA])]);
    const obj = JSON.parse(safeDetail(ancho));
    assert.equal(Object.keys(obj).length, 21, 'no debe perder ninguna clave');
    assert.equal(obj.f0, ISO, 'ni convertir las fechas en objetos vacios');
  });

  test('el recorte conserva la semantica, no solo el texto', () => {
    banco.exigeBanco(ctx);
    /* Un detalle largo con varias representaciones personalizadas. */
    const raro = {
      fecha: FECHA,
      conToJSON: { toJSON: () => 'representacion propia' },
      texto: x(3000),
    };
    const obj = JSON.parse(safeDetail(raro));
    assert.equal(obj.fecha, ISO);
    assert.equal(obj.conToJSON, 'representacion propia');
    assert.ok(obj.texto.length > 100, 'y sigue conservando parte del texto largo');
  });
});

describe('#107 — reconstruir el documento no pierde claves', () => {
  /* `normaliza` y `acota` rehacian el objeto sobre un `{}` corriente, y ahi
     `salida['__proto__'] = v` dispara el `setter` heredado de
     `Object.prototype`: no crea propiedad ninguna y la clave desaparecia
     del registro sin avisar. Medido contra 4db075a en los dos caminos.

     Ojo al construir los casos: el literal {'__proto__': v} FIJA EL
     PROTOTIPO en vez de crear la clave, asi que una prueba escrita con un
     literal no probaria nada -el primer control que escribi para esto no
     probaba nada por eso-. Hay que partir de `JSON.parse`, que si la crea
     como propiedad propia, igual que haria un detalle real llegado por
     HTTP. */
  const conProto = (txt) => JSON.parse(txt);

  const CLAVES = [
    ['__proto__ junto a un suplente corto', '{"__proto__":{"a":1},"s":"\\ud83d","normal":"ok"}'],
    ['__proto__ en un detalle largo', '{"__proto__":{"a":1},"texto":"' + x(3000) + '","normal":"ok"}'],
    ['__proto__ como unica clave', '{"__proto__":"valor"}'],
    ['constructor y prototype', '{"constructor":"c","prototype":"p","s":"\\ud83d"}'],
    ['__proto__ anidado', '{"a":{"__proto__":"hondo"},"s":"\\ud83d"}'],
  ];

  for (const [nombre, texto] of CLAVES) {
    test(nombre, async () => {
      banco.exigeBanco(ctx);
      const entrada = conProto(texto);
      const esperadas = Object.keys(entrada);
      const salida = safeDetail(entrada);
      const obj = JSON.parse(salida);
      for (const k of esperadas) {
        assert.ok(Object.prototype.hasOwnProperty.call(obj, k),
          `la clave ${JSON.stringify(k)} no debe desaparecer del registro`);
      }
      await assert.doesNotReject(ctx.pool.query('INSERT INTO sonda_detalle (d) VALUES (?)', [salida]));
    });
  }

  test('el objeto reconstruido no queda con el prototipo contaminado', () => {
    banco.exigeBanco(ctx);
    const salida = safeDetail(conProto('{"__proto__":{"colado":1},"s":"\\ud83d"}'));
    assert.equal({}.colado, undefined, 'nada debe haberse colado en Object.prototype');
    assert.deepEqual(JSON.parse(salida).__proto__, { colado: 1 },
      'y la clave debe seguir siendo un dato normal');
  });

  test('dos claves que colisionan al limpiar: se conserva una y se declara', () => {
    banco.exigeBanco(ctx);
    /* U+D800 y U+DC00 sueltos se sustituyen los dos por U+FFFD, de modo que
       dos claves distintas se vuelven una. Pisar la primera en silencio
       seria la misma clase de perdida que el `__proto__`. */
    const salida = safeDetail(JSON.parse('{"\\ud800":"primera","\\udc00":"segunda","normal":1}'));
    const obj = JSON.parse(salida);
    assert.equal(obj.normal, 1, 'las claves ordinarias no se tocan');
    assert.equal(obj['\uFFFD'], 'primera', 'se conserva la primera, no la ultima');
    assert.ok(obj._recortado.includes('claves_colisionadas'),
      'la colision debe declararse, no ocurrir en silencio');
  });

  test('sin colision no aparece la marca', () => {
    banco.exigeBanco(ctx);
    const obj = JSON.parse(safeDetail(JSON.parse('{"a":"\\ud83d","b":"ok"}')));
    assert.ok(!('_recortado' in obj), 'limpiar sin perder nada no es un recorte');
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
