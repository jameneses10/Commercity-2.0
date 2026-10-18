/* RNF-069 — carrito.
 *
 * Cubre el carrito persistente por usuario: alta, actualizacion, borrado,
 * vaciado y la validacion previa al pedido, que es la que decide si una compra
 * puede continuar.
 *
 * `POST /cart/validate` responde { valid_items, invalid_items, price_changes,
 * total, advertencias }. Una linea se invalida cuando el producto no esta
 * activo, su tienda o categoria no lo estan, o el stock no alcanza; y se
 * señala un cambio de precio cuando el precio actual difiere del que se
 * congelo al añadir.
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

let ctx = null;

before(async () => {
  const b = await banco.preparaTolerante('carrito');
  if (!b) return;
  const a = await banco.siembraActores(b.pool, { compradores: 2 });
  const api = banco.cliente(b.base);
  const prods = await banco.siembraProductos(b.pool, a.tiendaId, a.categoriaId, 3, { precio: 10000, stock: 10 });
  ctx = {
    ...b, ...a, ...api, prods,
    tokenA: await api.entra('comprador0@prueba.test'),
    tokenB: await api.entra('comprador1@prueba.test'),
  };
});

after(banco.desmonta);

const lineas = (j) => j?.data?.items || j?.data?.cart?.items || j?.data?.valid_items || [];

async function vacia(token) {
  await ctx.pide('DELETE', '/cart', { token });
}

describe('acceso', () => {
  test('el carrito exige sesion', async () => {
    banco.exigeBanco();
    /* GET y DELETE van sin cuerpo: fetch rechaza un GET con body. */
    const casos = [
      ['GET', '/cart', undefined],
      ['DELETE', '/cart', undefined],
      ['POST', '/cart/items', { product_id: 1, cantidad: 1 }],
      ['POST', '/cart/validate', {}],
    ];
    for (const [m, r, cuerpo] of casos) {
      const { status } = await ctx.pide(m, r, cuerpo === undefined ? {} : { json: cuerpo });
      assert.equal(status, 401, m + ' ' + r + ' sin token deberia ser 401');
    }
  });
});

describe('operaciones sobre las lineas', () => {
  test('un carrito recien creado esta vacio', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    const { status, json } = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    assert.equal(status, 200);
    assert.equal(lineas(json).length, 0);
  });

  test('añadir un producto lo deja en el carrito', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    const alta = await ctx.pide('POST', '/cart/items', {
      token: ctx.tokenA, json: { product_id: ctx.prods[0], cantidad: 2 },
    });
    assert.equal(alta.status, 201, JSON.stringify(alta.json).slice(0, 180));

    const { json } = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    const items = lineas(json);
    assert.equal(items.length, 1);
    assert.equal(Number(items[0].cantidad), 2);
  });

  test('añadir dos veces el mismo producto no duplica la linea', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[0], cantidad: 2 } });
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[0], cantidad: 3 } });

    const { json } = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    const items = lineas(json);
    assert.equal(items.length, 1, 'debe seguir habiendo una sola linea para ese producto');

    const [[fila]] = await ctx.pool.query(
      'SELECT COUNT(*) n FROM carrito_items ci INNER JOIN carritos c ON c.id=ci.carrito_id WHERE c.usuario_id=? AND ci.producto_id=?',
      [ctx.compradorIds[0], ctx.prods[0]]);
    assert.equal(Number(fila.n), 1, 'tampoco debe haber dos filas en la base');
  });

  test('actualizar la cantidad de una linea la cambia', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[1], cantidad: 1 } });
    const antes = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    const itemId = lineas(antes.json)[0].id;

    const upd = await ctx.pide('PATCH', '/cart/items/' + itemId, { token: ctx.tokenA, json: { cantidad: 4 } });
    assert.equal(upd.status, 200, JSON.stringify(upd.json).slice(0, 180));

    const despues = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    assert.equal(Number(lineas(despues.json)[0].cantidad), 4);
  });

  test('eliminar una linea la retira y deja las demas', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[0], cantidad: 1 } });
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[1], cantidad: 1 } });
    const lista = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    assert.equal(lineas(lista.json).length, 2);

    const id = lineas(lista.json)[0].id;
    const del = await ctx.pide('DELETE', '/cart/items/' + id, { token: ctx.tokenA });
    assert.equal(del.status, 200);

    const resto = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    assert.equal(lineas(resto.json).length, 1);
  });

  test('vaciar el carrito lo deja sin lineas', async () => {
    banco.exigeBanco();
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[2], cantidad: 1 } });
    const vaciado = await ctx.pide('DELETE', '/cart', { token: ctx.tokenA });
    assert.equal(vaciado.status, 200);
    const { json } = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    assert.equal(lineas(json).length, 0);
  });

  test('una cantidad no positiva se rechaza', async () => {
    banco.exigeBanco();
    for (const cantidad of [0, -1]) {
      const { status } = await ctx.pide('POST', '/cart/items', {
        token: ctx.tokenA, json: { product_id: ctx.prods[0], cantidad },
      });
      assert.ok(status >= 400, 'cantidad ' + cantidad + ' deberia rechazarse, llego ' + status);
    }
  });
});

describe('aislamiento entre compradores', () => {
  test('cada comprador ve solo su carrito', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    await vacia(ctx.tokenB);
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[0], cantidad: 1 } });

    const deB = await ctx.pide('GET', '/cart', { token: ctx.tokenB });
    assert.equal(lineas(deB.json).length, 0, 'el carrito de A no debe verse desde B');
  });

  test('un comprador no puede modificar la linea de otro', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[0], cantidad: 1 } });
    const deA = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    const idDeA = lineas(deA.json)[0].id;

    const intento = await ctx.pide('PATCH', '/cart/items/' + idDeA, { token: ctx.tokenB, json: { cantidad: 99 } });
    assert.ok(intento.status >= 400, 'B no deberia poder tocar la linea de A, llego ' + intento.status);

    const sigue = await ctx.pide('GET', '/cart', { token: ctx.tokenA });
    assert.equal(Number(lineas(sigue.json)[0].cantidad), 1, 'la cantidad de A no debe haber cambiado');
  });
});

describe('validacion previa al pedido', () => {
  /* Regresion de #66, cerrado en b2d639e. */
  test('validar un carrito vacio se rechaza con 400', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    const { status, json } = await ctx.pide('POST', '/cart/validate', { token: ctx.tokenA, json: {} });
    assert.equal(status, 400);
    assert.match(String(json.message || ''), /vac/i, 'el mensaje debe decir que el carrito esta vacio');
  });

  test('un carrito valido suma el total de sus lineas', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[0], cantidad: 2 } });
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[1], cantidad: 1 } });

    const { status, json } = await ctx.pide('POST', '/cart/validate', { token: ctx.tokenA, json: {} });
    assert.equal(status, 200, JSON.stringify(json).slice(0, 180));
    const d = json.data;
    assert.equal(d.valid_items.length, 2);
    assert.equal(d.invalid_items.length, 0);
    assert.equal(Number(d.total), 30000, '2x10000 + 1x10100 no cuadra: ' + d.total);
  });

  test('una linea cuyo producto deja de estar activo se marca invalida', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[2], cantidad: 1 } });
    await ctx.pool.query("UPDATE productos SET estado='oculto' WHERE id=?", [ctx.prods[2]]);
    try {
      const { json } = await ctx.pide('POST', '/cart/validate', { token: ctx.tokenA, json: {} });
      assert.equal(json.data.valid_items.length, 0);
      assert.equal(json.data.invalid_items.length, 1);
      assert.match(String(json.data.advertencias[0] || ''), /activo/i);
    } finally {
      await ctx.pool.query("UPDATE productos SET estado='activo' WHERE id=?", [ctx.prods[2]]);
    }
  });

  test('una linea que excede el stock se marca invalida', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[0], cantidad: 5 } });
    await ctx.pool.query('UPDATE productos SET stock=2 WHERE id=?', [ctx.prods[0]]);
    try {
      const { json } = await ctx.pide('POST', '/cart/validate', { token: ctx.tokenA, json: {} });
      assert.equal(json.data.invalid_items.length, 1, 'pidiendo 5 con stock 2 la linea debe invalidarse');
      assert.match(String(json.data.advertencias[0] || ''), /stock/i);
    } finally {
      await ctx.pool.query('UPDATE productos SET stock=10 WHERE id=?', [ctx.prods[0]]);
    }
  });

  test('un cambio de precio posterior se señala sin invalidar la linea', async () => {
    banco.exigeBanco();
    await vacia(ctx.tokenA);
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: ctx.prods[1], cantidad: 1 } });
    const original = (await ctx.pool.query('SELECT precio FROM productos WHERE id=?', [ctx.prods[1]]))[0][0].precio;
    await ctx.pool.query('UPDATE productos SET precio=? WHERE id=?', [Number(original) + 7000, ctx.prods[1]]);
    try {
      const { json } = await ctx.pide('POST', '/cart/validate', { token: ctx.tokenA, json: {} });
      assert.equal(json.data.price_changes.length, 1, 'el cambio de precio debe reportarse');
      const c = json.data.price_changes[0];
      assert.equal(Number(c.precio_anterior), Number(original));
      assert.equal(Number(c.precio_actual), Number(original) + 7000);
    } finally {
      await ctx.pool.query('UPDATE productos SET precio=? WHERE id=?', [original, ctx.prods[1]]);
    }
  });
});
