/* RNF-069 — el propio arnes.
 *
 * #104: `siembraProductos` armaba el slug como 'p-' + Date.now() + '-' + i, sin
 * componente que variase dentro de un mismo milisegundo. Dos siembras para la
 * misma tienda chocaban contra `uk_productos_tienda_slug`, y la suite caia de
 * forma intermitente: en GitHub Actions el commit 23a1ef4 fallo en el primer
 * intento y paso en el segundo sin cambiar una linea.
 *
 * Esperar a que el reloj no avance no es una prueba, es una loteria. Aqui se
 * congela `Date.now` para que el caso sea deterministico: si la unicidad
 * volviese a depender del reloj, estas pruebas fallarian siempre, no a veces.
 *
 * Se comprueban las dos capas: el generador por si solo y una insercion real
 * contra MySQL, que es quien tiene la restriccion UNIQUE.
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

let ctx = null;

before(async () => {
  const b = await banco.preparaTolerante('arnes');
  if (!b) return;
  const a = await banco.siembraActores(b.pool, { compradores: 0 });
  ctx = { ...b, ...a };
});

after(banco.desmonta);

/* Ejecuta `fn` con el reloj detenido y lo restituye pase lo que pase. */
async function conRelojCongelado(fn) {
  const real = Date.now;
  const fijo = real();
  Date.now = () => fijo;
  try {
    return await fn(fijo);
  } finally {
    Date.now = real;
  }
}

/* Ademas del reloj, deja `Math.random` constante.
 *
 * Hace falta para que la prueba discrimine. Congelando solo el reloj, el
 * generador antiguo seguia pasando: su sufijo aleatorio de cinco caracteres
 * base36 da 60.466.176 combinaciones, y en 500 extracciones la colision cae
 * por debajo del 0,3%. Eso no es una prueba, es un detector probabilistico que
 * habria dado verde sobre el codigo defectuoso casi siempre. Con las dos
 * fuentes de variacion detenidas, lo unico que puede garantizar la unicidad es
 * el contador. */
async function sinAzarNiReloj(fn) {
  const real = Math.random;
  Math.random = () => 0.5;
  try {
    return await conRelojCongelado(fn);
  } finally {
    Math.random = real;
  }
}

describe('generador de identificadores unicos', () => {
  test('nuevoSlug no repite sin reloj que avance ni azar que ayude', async () => {
    const vistos = await sinAzarNiReloj(async () => {
      const s = [];
      for (let i = 0; i < 500; i++) s.push(banco.nuevoSlug('p'));
      return s;
    });
    assert.equal(vistos.length, 500);
    assert.equal(new Set(vistos).size, 500,
      'sin reloj ni azar, nuevoSlug devolvio valores repetidos');
  });

  test('el reloj y el azar quedan restituidos tras congelarlos', async () => {
    const antes = Date.now();
    await sinAzarNiReloj(async () => banco.nuevoSlug('p'));
    assert.ok(Date.now() >= antes, 'Date.now quedo parcheado tras la prueba');
    const muestras = new Set(Array.from({ length: 50 }, () => Math.random()));
    assert.ok(muestras.size > 1, 'Math.random quedo parcheado tras la prueba');
  });
});

describe('siembra de productos', () => {
  test('seis siembras seguidas en la misma tienda no chocan con el reloj parado', async () => {
    banco.exigeBanco();
    const antes = await total();

    /* Seis llamadas de dos productos: el mismo patron que catalogo.test.js, que
       es el fichero donde se veia caer la suite. */
    const ids = await conRelojCongelado(async () => {
      const r = [];
      for (let k = 0; k < 6; k++) {
        r.push(...await banco.siembraProductos(ctx.pool, ctx.tiendaId, ctx.categoriaId, 2));
      }
      return r;
    });

    assert.equal(ids.length, 12);
    assert.equal(await total() - antes, 12, 'no se insertaron las 12 filas');

    const [filas] = await ctx.pool.query(
      'SELECT COUNT(DISTINCT slug) AS d FROM productos WHERE id IN (?)', [ids]);
    assert.equal(filas[0].d, 12, 'dos productos de la misma tienda comparten slug');
  });
});

async function total() {
  const [f] = await ctx.pool.query(
    'SELECT COUNT(*) AS n FROM productos WHERE tienda_id=?', [ctx.tiendaId]);
  return f[0].n;
}
