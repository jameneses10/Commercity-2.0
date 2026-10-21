/* RNF-049 / RNF-050 — #81 y #82: el carrito se consume al crear el pedido, y
 * un pedido rechazado se puede reintentar.
 *
 * Lo que medía el defecto, antes de corregirlo: cinco checkouts simultáneos
 * del mismo carrito producían cinco pedidos, cinco pagos aprobados, cinco
 * comisiones, cinco envíos y cinco descuentos de existencias. El comprador
 * quedaba con N cobros cuando pretendía uno.
 *
 * Estas pruebas comprueban filas y respuestas, no solo códigos HTTP: un 400
 * del validador de entrada se parece a una protección de negocio y no lo es
 * —durante la auditoría de #81 dio dos falsos positivos—, así que el cuerpo
 * de `POST /orders` siempre lleva `items` aunque el servicio los ignore.
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

let ctx = null;

/* El gateway sandbox decide por el número de tarjeta. */
const APROBADA = '4111111111111111';
const RECHAZADA = '4000000000000002';

before(async () => {
  const b = await banco.preparaTolerante('carritoatomico');
  if (!b) return;
  const a = await banco.siembraActores(b.pool, { compradores: 1 });
  const api = banco.cliente(b.base);
  const dir = await banco.siembraDireccion(b.pool, a.compradorIds[0]);
  ctx = {
    ...b, ...a, ...api, dir,
    token: await api.entra('comprador0@prueba.test'),
    tokenAdmin: await api.entra('admin@prueba.test'),
  };
});

after(banco.desmonta);

/* Cada prueba parte de un carrito y un catálogo limpios: lo que se mide es el
   efecto del checkout, no lo que dejó la prueba anterior. */
beforeEach(async () => {
  if (!ctx) return;
  /* El orden importa: lo derivado primero. liquidaciones_simuladas apunta a
     comisiones, comprobantes a pagos, y casi todo a pedidos. */
  for (const tabla of ['liquidaciones_simuladas', 'reembolsos_simulados',
    'devolucion_items', 'devolucion_evidencias', 'devoluciones', 'resenas',
    'comisiones', 'comprobantes', 'pagos', 'envios',
    'pedido_detalles', 'pedidos', 'carrito_items']) {
    await ctx.pool.query('DELETE FROM ' + tabla);
  }
});

const cuenta = async (tabla, donde = '1=1') =>
  (await ctx.pool.query(`SELECT COUNT(*) n FROM ${tabla} WHERE ${donde}`))[0][0].n;

const itemsCarrito = () => cuenta('carrito_items');

async function sembrarProducto(extra = {}) {
  const [id] = await banco.siembraProductos(ctx.pool, ctx.tiendaId, ctx.categoriaId, 1,
    { precio: 10000, stock: 50, ...extra });
  return id;
}

async function alCarrito(productoId, cantidad = 1) {
  const r = await ctx.pide('POST', '/cart/items', {
    token: ctx.token, json: { producto_id: productoId, cantidad },
  });
  assert.equal(r.status, 201, 'no se pudo llenar el carrito: ' + JSON.stringify(r.json).slice(0, 120));
}

/* El validador exige `items` aunque el servicio lea el carrito persistente. */
const cuerpoPedido = (productoId, cantidad = 1) => ({
  direccion_id: ctx.dir,
  items: [{ producto_id: productoId, cantidad }],
});

const checkout = (productoId, cantidad = 1) =>
  ctx.pide('POST', '/orders', { token: ctx.token, json: cuerpoPedido(productoId, cantidad) });

const pagar = (pedidoId, tarjeta) => ctx.pide('POST', '/payments/sandbox', {
  token: ctx.token,
  json: {
    pedido_id: pedidoId, card_number: tarjeta, card_holder: 'PRUEBA 81',
    exp_month: 12, exp_year: 2030, cvv: '123',
  },
});

const ultimoPedido = async () =>
  (await ctx.pool.query('SELECT id FROM pedidos ORDER BY id DESC LIMIT 1'))[0][0]?.id;

const stockDe = async (id) =>
  Number((await ctx.pool.query('SELECT stock FROM productos WHERE id=?', [id]))[0][0].stock);

describe('#81 el carrito se consume al crear el pedido', () => {
  test('C3 un checkout consume el carrito', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    await alCarrito(prod, 2);
    assert.equal(await itemsCarrito(), 1);

    const r = await checkout(prod, 2);
    assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 140));
    assert.equal(await itemsCarrito(), 0, 'el carrito sobrevivio al checkout');
    assert.equal(await cuenta('pedidos'), 1);
    assert.equal(await cuenta('pedido_detalles'), 1);
  });

  test('C3 el segundo checkout seguido no crea otro pedido', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    await alCarrito(prod, 2);

    assert.equal((await checkout(prod, 2)).status, 201);
    const segundo = await checkout(prod, 2);
    assert.ok(segundo.status >= 400, 'el segundo checkout creo otro pedido: ' + segundo.status);
    assert.equal(await cuenta('pedidos'), 1, 'se crearon ' + await cuenta('pedidos') + ' pedidos');
  });

  test('C3 cinco checkouts simultaneos producen exactamente un pedido', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    await alCarrito(prod, 2);

    const res = await Promise.all(Array.from({ length: 5 }, () => checkout(prod, 2)));
    const creados = res.filter((r) => r.status === 201).length;
    assert.equal(creados, 1, creados + ' de 5 checkouts simultaneos crearon pedido');
    assert.equal(await cuenta('pedidos'), 1);
    assert.equal(await itemsCarrito(), 0);
  });

  test('C7 cinco checkouts simultaneos no duplican cobros ni existencias', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    const antes = await stockDe(prod);
    await alCarrito(prod, 2);
    await Promise.all(Array.from({ length: 5 }, () => checkout(prod, 2)));

    /* Se pagan TODOS los pedidos que hayan quedado, no solo el ultimo: de otro
       modo la prueba daria verde incluso con cinco pedidos creados, porque
       cuatro se quedarian sin cobrar. Lo que se mide es cuantos cobros puede
       llegar a sufrir el comprador. */
    assert.equal(await cuenta('pedidos'), 1,
      'quedaron ' + await cuenta('pedidos') + ' pedidos de un solo carrito');
    const todos = (await ctx.pool.query('SELECT id FROM pedidos ORDER BY id'))[0];
    for (const p of todos) await pagar(p.id, APROBADA);

    assert.equal(await cuenta('pagos', "estado='aprobado'"), 1);
    assert.equal(await cuenta('comprobantes'), 1);
    assert.equal(await cuenta('envios'), 1);
    assert.equal(await cuenta('comisiones'), 1);
    assert.equal(await stockDe(prod), antes - 2, 'se descontaron existencias de mas');
  });

  test('C8 dos compras legitimas sucesivas del mismo usuario funcionan', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();

    await alCarrito(prod, 1);
    assert.equal((await checkout(prod, 1)).status, 201);
    const primero = await ultimoPedido();
    assert.equal((await pagar(primero, APROBADA)).status, 200);

    /* Segunda compra: carrito nuevo, pedido nuevo. El carrito activo sigue
       siendo el mismo contenedor, de ahi que no se marque como 'comprado':
       uq_carritos_usuario_estado lo impediria. */
    await alCarrito(prod, 3);
    assert.equal((await checkout(prod, 3)).status, 201);
    const segundo = await ultimoPedido();
    assert.notEqual(segundo, primero);
    assert.equal((await pagar(segundo, APROBADA)).status, 200);

    assert.equal(await cuenta('pedidos'), 2);
    assert.equal(await cuenta('pagos', "estado='aprobado'"), 2);
    assert.equal(await itemsCarrito(), 0);
  });

  test('C1 un checkout fallido no consume el carrito ni deja pedido', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    await alCarrito(prod, 1);
    /* Una direccion ajena hace fallar el checkout antes de tocar nada. */
    const r = await ctx.pide('POST', '/orders', {
      token: ctx.token,
      json: { direccion_id: 999999, items: [{ producto_id: prod, cantidad: 1 }] },
    });
    assert.ok(r.status >= 400);
    assert.equal(await cuenta('pedidos'), 0);
    assert.equal(await cuenta('pedido_detalles'), 0);
    assert.equal(await itemsCarrito(), 1, 'el carrito se perdio en un checkout fallido');
  });
});

describe('#81 los escritores del carrito respetan el mismo bloqueo', () => {
  test('C4 borrar un articulo espera al checkout en curso', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    await alCarrito(prod, 1);
    const [[item]] = await ctx.pool.query('SELECT id, carrito_id FROM carrito_items LIMIT 1');

    /* Se imita el bloqueo que toma el checkout y se comprueba que DELETE y
       PATCH esperan. Antes de #81 entraban en 12 y 15 ms con la fila
       bloqueada, porque borrar o actualizar un hijo no toca al padre. */
    const bloqueo = await ctx.pool.getConnection();
    try {
      await bloqueo.beginTransaction();
      await bloqueo.query('SELECT id FROM carritos WHERE id=? FOR UPDATE', [item.carrito_id]);

      for (const [metodo, ruta, json] of [
        ['DELETE', '/cart/items/' + item.id, undefined],
        ['PATCH', '/cart/items/' + item.id, { cantidad: 3 }],
      ]) {
        const peticion = ctx.pide(metodo, ruta, { token: ctx.token, json });
        const carrera = await Promise.race([
          peticion.then(() => 'entro'),
          new Promise((res) => setTimeout(() => res('espera'), 700)),
        ]);
        assert.equal(carrera, 'espera',
          metodo + ' ' + ruta + ' entro sin esperar al bloqueo del carrito');
        /* se libera y se consume la respuesta para no dejarla colgando */
        await bloqueo.rollback();
        await peticion;
        await bloqueo.beginTransaction();
        await bloqueo.query('SELECT id FROM carritos WHERE id=? FOR UPDATE', [item.carrito_id]);
      }
      await bloqueo.rollback();
    } finally {
      bloqueo.release();
    }
  });
});

describe('#81 cambios de precio: el comprador no queda atrapado', () => {
  test('C5 un precio cambiado rechaza, avanza el snapshot y deja reintentar', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto({ precio: 10000 });
    await alCarrito(prod, 1);

    /* El precio sube despues de añadirlo al carrito. */
    await ctx.pool.query('UPDATE productos SET precio=? WHERE id=?', [12000, prod]);

    const primero = await checkout(prod, 1);
    assert.equal(primero.status, 409, 'un precio cambiado deberia rechazar el checkout');
    assert.equal(await cuenta('pedidos'), 0, 'se creo un pedido pese al rechazo');
    assert.equal(await itemsCarrito(), 1, 'el checkout rechazado consumio el carrito');

    const [[item]] = await ctx.pool.query(
      'SELECT precio_unitario_snapshot FROM carrito_items LIMIT 1');
    assert.equal(Number(item.precio_unitario_snapshot), 12000,
      'el snapshot no avanzo: el comprador repetiria el mismo 409 para siempre');

    /* Sin nuevos cambios, el segundo intento debe poder crear el pedido. */
    const segundo = await checkout(prod, 1);
    assert.equal(segundo.status, 201, 'el segundo intento siguio rechazado: ' + JSON.stringify(segundo.json).slice(0, 120));
    assert.equal(await itemsCarrito(), 0);
  });
});

describe('#82 un pedido rechazado se puede reintentar', () => {
  test('C6 reintento por la via sandbox sobre el mismo pedido', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    const antes = await stockDe(prod);
    await alCarrito(prod, 1);
    await checkout(prod, 1);
    const pedido = await ultimoPedido();

    const rechazo = await pagar(pedido, RECHAZADA);
    assert.equal(rechazo.status, 200);
    assert.equal(rechazo.json.data.payment.estado, 'rechazado');

    /* C5 del gate B: el rechazo deja constancia y no toca nada mas. */
    assert.equal(await cuenta('pagos', "estado='rechazado'"), 1);
    assert.equal(await cuenta('comisiones'), 0);
    assert.equal(await cuenta('envios'), 0);
    assert.equal(await cuenta('comprobantes'), 0);
    assert.equal(await stockDe(prod), antes, 'un rechazo descontó existencias');

    const reintento = await pagar(pedido, APROBADA);
    assert.equal(reintento.status, 200, 'no se pudo reintentar: ' + JSON.stringify(reintento.json).slice(0, 120));

    const [[p]] = await ctx.pool.query('SELECT estado_pago FROM pedidos WHERE id=?', [pedido]);
    assert.equal(p.estado_pago, 'pagado');
  });

  test('C6 reintento por la via webhook sobre el mismo pedido', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    await alCarrito(prod, 1);
    await checkout(prod, 1);
    const pedido = await ultimoPedido();
    await pagar(pedido, RECHAZADA);

    const w = await ctx.pide('POST', '/payments/webhook-simulated', {
      token: ctx.tokenAdmin, json: { pedido_id: pedido, approved: true },
    });
    assert.equal(w.status, 200, 'el webhook no admitio el reintento: ' + JSON.stringify(w.json).slice(0, 120));
    const [[p]] = await ctx.pool.query('SELECT estado_pago FROM pedidos WHERE id=?', [pedido]);
    assert.equal(p.estado_pago, 'pagado');
  });

  test('C7 rechazo y luego aprobacion no duplican nada', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    const antes = await stockDe(prod);
    await alCarrito(prod, 2);
    await checkout(prod, 2);
    const pedido = await ultimoPedido();

    await pagar(pedido, RECHAZADA);
    await pagar(pedido, RECHAZADA);
    await pagar(pedido, APROBADA);

    assert.equal(await cuenta('pagos', "estado='rechazado'"), 2, 'se perdio constancia de los rechazos');
    assert.equal(await cuenta('pagos', "estado='aprobado'"), 1);
    assert.equal(await cuenta('comprobantes'), 1);
    assert.equal(await cuenta('envios'), 1);
    assert.equal(await cuenta('comisiones'), 1);
    assert.equal(await stockDe(prod), antes - 2);
  });

  test('C6 un pedido ya pagado sigue sin poder pagarse otra vez', async () => {
    banco.exigeBanco();
    const prod = await sembrarProducto();
    await alCarrito(prod, 1);
    await checkout(prod, 1);
    const pedido = await ultimoPedido();
    assert.equal((await pagar(pedido, APROBADA)).status, 200);

    const otra = await pagar(pedido, APROBADA);
    assert.equal(otra.status, 409, 'un pedido pagado admitio un segundo cobro');
    assert.equal(await cuenta('pagos', "estado='aprobado'"), 1);
  });
});
