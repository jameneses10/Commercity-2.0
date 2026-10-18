/* RNF-069 — pedidos.
 *
 * Esta suite prueba el ESTADO OBSERVABLE del pedido y sus fronteras de
 * autorizacion: quien lo crea, quien lo ve, con que alcance y que filtros
 * admite el listado administrativo. El proceso de pago se prueba en
 * pagos.test.js; aqui solo se usa un pago aprobado como medio para llegar a
 * un estado, nunca como objeto de prueba.
 *
 * Fronteras del contrato, leidas del codigo:
 *   POST /orders            solo comprador
 *   GET  /orders/my-orders  solo comprador, y solo los suyos
 *   GET  /orders/:id        cualquier autenticado, pero el servicio decide
 *   GET  /seller/orders     solo vendedor, limitado a su tienda
 *   GET  /admin/orders      solo administrador, exige tienda concreta o
 *                           scope=all con al menos un filtro
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

const APRUEBA = '4111111111111111';
let ctx = null;

before(async () => {
  const b = await banco.preparaTolerante('pedidos');
  if (!b) return;
  const a = await banco.siembraActores(b.pool, { compradores: 2 });
  const api = banco.cliente(b.base);

  /* Segunda tienda con su propio vendedor, para probar que el ambito del
     vendedor realmente excluye lo ajeno. */
  const [v2] = await b.pool.query(
    "INSERT INTO usuarios (rol_id,nombre,correo,password_hash,estado) SELECT rol_id,'Vendedor Dos','vendedor2@prueba.test',password_hash,'activo' FROM usuarios WHERE id=?",
    [a.vendedorId]);
  const [t2] = await b.pool.query(
    "INSERT INTO tiendas (usuario_id,nombre,slug,descripcion,estado) VALUES (?,?,?,?,'activa')",
    [v2.insertId, 'Tienda Dos', banco.nuevoSlug('tienda-dos'), 'segunda tienda']);

  ctx = {
    ...b, ...a, ...api, tienda2: t2.insertId,
    tokenA: await api.entra('comprador0@prueba.test'),
    tokenB: await api.entra('comprador1@prueba.test'),
    tokenVendedor: await api.entra('vendedor@prueba.test'),
    tokenVendedor2: await api.entra('vendedor2@prueba.test'),
    tokenAdmin: await api.entra('admin@prueba.test'),
    dirA: await banco.siembraDireccion(b.pool, a.compradorIds[0]),
    dirB: await banco.siembraDireccion(b.pool, a.compradorIds[1]),
  };
});

after(banco.desmonta);

const uno = async (sql, p) => (await ctx.pool.query(sql, p))[0][0];
const listaDe = (j) => j?.data?.orders || j?.data?.pedidos || [];

async function crearPedido({ token, dir, tienda = null, cantidad = 1 } = {}) {
  const t = tienda || ctx.tiendaId;
  const [prod] = await banco.siembraProductos(ctx.pool, t, ctx.categoriaId, 1, { precio: 20000, stock: 20 });
  await ctx.pide('DELETE', '/cart', { token });
  await ctx.pide('POST', '/cart/items', { token, json: { product_id: prod, cantidad } });
  const r = await ctx.pide('POST', '/orders', {
    token, json: { direccion_id: dir, items: [{ producto_id: prod, cantidad }] },
  });
  assert.ok(r.status === 201 || r.status === 200, 'no se pudo crear el pedido: ' + JSON.stringify(r.json).slice(0, 180));
  const id = r.json?.data?.order?.id ?? r.json?.data?.pedido?.id ?? r.json?.data?.id;
  assert.ok(id, 'sin id de pedido: ' + JSON.stringify(r.json).slice(0, 180));
  return { pedidoId: id, productoId: prod };
}

/* Pagar es aqui un MEDIO para alcanzar un estado, no el objeto de prueba. */
async function pagar(pedidoId, token) {
  const r = await ctx.pide('POST', '/payments/sandbox', {
    token, json: { pedido_id: pedidoId, card_number: APRUEBA, card_holder: 'X', exp_month: 12, exp_year: 2030, cvv: '123' },
  });
  assert.equal(r.status, 200, 'el pago previo fallo: ' + JSON.stringify(r.json).slice(0, 160));
}

describe('creacion', () => {
  test('solo un comprador crea pedidos', async () => {
    banco.exigeBanco();
    const cuerpo = { direccion_id: ctx.dirA, items: [{ producto_id: 1, cantidad: 1 }] };
    const anonimo = await ctx.pide('POST', '/orders', { json: cuerpo });
    assert.equal(anonimo.status, 401);
    const vendedor = await ctx.pide('POST', '/orders', { token: ctx.tokenVendedor, json: cuerpo });
    assert.equal(vendedor.status, 403);
    const admin = await ctx.pide('POST', '/orders', { token: ctx.tokenAdmin, json: cuerpo });
    assert.equal(admin.status, 403);
  });

  test('el pedido nace pendiente de pago y con sus lineas', async () => {
    banco.exigeBanco();
    const { pedidoId, productoId } = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA, cantidad: 2 });
    const p = await uno('SELECT comprador_id, estado_pago, estado_general, total FROM pedidos WHERE id=?', [pedidoId]);
    assert.equal(Number(p.comprador_id), ctx.compradorIds[0]);
    assert.equal(p.estado_pago, 'pendiente');
    assert.equal(p.estado_general, 'creado');
    assert.equal(Number(p.total), 40000, '2 x 20000');

    const d = await uno('SELECT COUNT(*) n, SUM(cantidad) c FROM pedido_detalles WHERE pedido_id=? AND producto_id=?', [pedidoId, productoId]);
    assert.equal(Number(d.n), 1);
    assert.equal(Number(d.c), 2);
  });

  test('el detalle congela el precio de compra', async () => {
    banco.exigeBanco();
    const { pedidoId, productoId } = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA });
    await ctx.pool.query('UPDATE productos SET precio=999999 WHERE id=?', [productoId]);
    const d = await uno('SELECT precio_unitario FROM pedido_detalles WHERE pedido_id=?', [pedidoId]);
    assert.equal(Number(d.precio_unitario), 20000, 'el precio del pedido no debe seguir al del catalogo');
  });

  test('sin direccion valida el pedido se rechaza', async () => {
    banco.exigeBanco();
    const [prod] = await banco.siembraProductos(ctx.pool, ctx.tiendaId, ctx.categoriaId, 1);
    await ctx.pide('DELETE', '/cart', { token: ctx.tokenA });
    await ctx.pide('POST', '/cart/items', { token: ctx.tokenA, json: { product_id: prod, cantidad: 1 } });
    const sin = await ctx.pide('POST', '/orders', { token: ctx.tokenA, json: { items: [{ producto_id: prod, cantidad: 1 }] } });
    assert.equal(sin.status, 400, 'direccion_id es obligatoria');
  });
});

describe('alcance del comprador', () => {
  test('my-orders devuelve los propios y ninguno ajeno', async () => {
    banco.exigeBanco();
    const mio = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA });
    const ajeno = await crearPedido({ token: ctx.tokenB, dir: ctx.dirB });

    const { status, json } = await ctx.pide('GET', '/orders/my-orders', { token: ctx.tokenA });
    assert.equal(status, 200);
    const ids = listaDe(json).map((o) => Number(o.id));
    assert.ok(ids.includes(Number(mio.pedidoId)), 'falta su propio pedido');
    assert.ok(!ids.includes(Number(ajeno.pedidoId)), 'se filtro el pedido de otro comprador');
  });

  test('un comprador no puede ver el pedido de otro por id', async () => {
    banco.exigeBanco();
    const ajeno = await crearPedido({ token: ctx.tokenB, dir: ctx.dirB });
    const { status } = await ctx.pide('GET', '/orders/' + ajeno.pedidoId, { token: ctx.tokenA });
    assert.equal(status, 403);
  });

  test('un identificador inexistente responde 404', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('GET', '/orders/99999999', { token: ctx.tokenA });
    assert.equal(status, 404);
  });

  test('my-orders exige el rol comprador', async () => {
    banco.exigeBanco();
    assert.equal((await ctx.pide('GET', '/orders/my-orders')).status, 401);
    assert.equal((await ctx.pide('GET', '/orders/my-orders', { token: ctx.tokenVendedor })).status, 403);
  });

  test('el comprobante solo existe tras pagar', async () => {
    banco.exigeBanco();
    const { pedidoId } = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA });
    const antes = await ctx.pide('GET', '/orders/' + pedidoId + '/comprobante', { token: ctx.tokenA });
    assert.equal(antes.status, 404, 'sin pago no hay comprobante');

    await pagar(pedidoId, ctx.tokenA);
    const despues = await ctx.pide('GET', '/orders/' + pedidoId + '/comprobante', { token: ctx.tokenA });
    assert.equal(despues.status, 200, 'tras pagar debe existir comprobante');
  });

  test('el comprobante de otro comprador no es accesible', async () => {
    banco.exigeBanco();
    const ajeno = await crearPedido({ token: ctx.tokenB, dir: ctx.dirB });
    await pagar(ajeno.pedidoId, ctx.tokenB);
    const { status } = await ctx.pide('GET', '/orders/' + ajeno.pedidoId + '/comprobante', { token: ctx.tokenA });
    assert.ok(status === 403 || status === 404, 'no debe entregarse el comprobante ajeno, llego ' + status);
  });
});

describe('alcance del vendedor', () => {
  test('ve los pedidos en los que participa su tienda', async () => {
    banco.exigeBanco();
    const propio = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA, tienda: ctx.tiendaId });
    await pagar(propio.pedidoId, ctx.tokenA);

    const { status, json } = await ctx.pide('GET', '/seller/orders', { token: ctx.tokenVendedor });
    assert.equal(status, 200);
    const ids = listaDe(json).map((o) => Number(o.id));
    assert.ok(ids.includes(Number(propio.pedidoId)), 'el vendedor debe ver el pedido de su tienda');
  });

  test('no ve los pedidos de otra tienda', async () => {
    banco.exigeBanco();
    const deLaOtra = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA, tienda: ctx.tienda2 });
    await pagar(deLaOtra.pedidoId, ctx.tokenA);

    const { json } = await ctx.pide('GET', '/seller/orders', { token: ctx.tokenVendedor });
    const ids = listaDe(json).map((o) => Number(o.id));
    assert.ok(!ids.includes(Number(deLaOtra.pedidoId)), 'se filtro un pedido de otra tienda');
  });

  test('el listado del vendedor exige su rol', async () => {
    banco.exigeBanco();
    assert.equal((await ctx.pide('GET', '/seller/orders')).status, 401);
    assert.equal((await ctx.pide('GET', '/seller/orders', { token: ctx.tokenA })).status, 403);
    assert.equal((await ctx.pide('GET', '/seller/orders', { token: ctx.tokenAdmin })).status, 403);
  });
});

describe('alcance del administrador', () => {
  test('el listado exige rol de administrador', async () => {
    banco.exigeBanco();
    assert.equal((await ctx.pide('GET', '/admin/orders?tienda_id=' + ctx.tiendaId)).status, 401);
    assert.equal((await ctx.pide('GET', '/admin/orders?tienda_id=' + ctx.tiendaId, { token: ctx.tokenA })).status, 403);
    assert.equal((await ctx.pide('GET', '/admin/orders?tienda_id=' + ctx.tiendaId, { token: ctx.tokenVendedor })).status, 403);
  });

  /* RF-260: el panel no carga todos los pedidos sin pedirlo explicitamente. */
  test('sin tienda ni scope el listado se niega a responder', async () => {
    banco.exigeBanco();
    const { status, json } = await ctx.pide('GET', '/admin/orders', { token: ctx.tokenAdmin });
    assert.equal(status, 400, 'debe exigir una tienda o scope=all con filtro');
    assert.match(String(json.message || ''), /tienda|filtro/i);
  });

  test('scope=all sin ningun filtro tambien se niega', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('GET', '/admin/orders?scope=all', { token: ctx.tokenAdmin });
    assert.equal(status, 400, 'scope=all exige al menos un filtro');
  });

  test('scope=all junto a una tienda concreta es contradictorio', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('GET', '/admin/orders?scope=all&tienda_id=' + ctx.tiendaId, { token: ctx.tokenAdmin });
    assert.equal(status, 400);
  });

  test('filtrando por tienda devuelve solo los de esa tienda', async () => {
    banco.exigeBanco();
    const deUno = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA, tienda: ctx.tiendaId });
    const deDos = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA, tienda: ctx.tienda2 });
    await pagar(deUno.pedidoId, ctx.tokenA);
    await pagar(deDos.pedidoId, ctx.tokenA);

    const { status, json } = await ctx.pide('GET', '/admin/orders?tienda_id=' + ctx.tienda2, { token: ctx.tokenAdmin });
    assert.equal(status, 200);
    const ids = listaDe(json).map((o) => Number(o.id));
    assert.ok(ids.includes(Number(deDos.pedidoId)), 'falta el pedido de la tienda filtrada');
    assert.ok(!ids.includes(Number(deUno.pedidoId)), 'se colo un pedido de otra tienda');
  });

  test('el filtro por estado de pago discrimina', async () => {
    banco.exigeBanco();
    const pendiente = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA });
    const pagado = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA });
    await pagar(pagado.pedidoId, ctx.tokenA);

    const { json } = await ctx.pide('GET', '/admin/orders?scope=all&estado_pago=pagado', { token: ctx.tokenAdmin });
    const ids = listaDe(json).map((o) => Number(o.id));
    assert.ok(ids.includes(Number(pagado.pedidoId)));
    assert.ok(!ids.includes(Number(pendiente.pedidoId)), 'un pedido pendiente no debe salir al filtrar por pagado');
  });

  test('un filtro con valor no admitido se rechaza', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('GET', '/admin/orders?scope=all&estado_pago=inventado', { token: ctx.tokenAdmin });
    assert.equal(status, 400);
  });
});

describe('estado observable tras el pago', () => {
  test('el pedido pagado se ve pagado por su comprador', async () => {
    banco.exigeBanco();
    const { pedidoId } = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA });
    await pagar(pedidoId, ctx.tokenA);

    const { status, json } = await ctx.pide('GET', '/orders/' + pedidoId, { token: ctx.tokenA });
    assert.equal(status, 200);
    const o = json?.data?.order ?? json?.data?.pedido ?? json?.data;
    assert.equal(o.estado_pago, 'pagado');
    assert.equal(o.estado_general, 'procesando');
  });

  test('el ciclo de vida del pedido avanza mas alla de procesando', { todo: '#100 — ninguna ruta escribe enviado, completado ni cancelado: el unico UPDATE de estado_general lo fija en procesando' }, async () => {
    banco.exigeBanco();
    const { pedidoId } = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA });
    await pagar(pedidoId, ctx.tokenA);

    const [envios] = await ctx.pool.query('SELECT id FROM envios WHERE pedido_id=?', [pedidoId]);
    assert.ok(envios.length > 0, 'hace falta un envio para avanzar el pedido');
    await ctx.pide('PATCH', '/shipments/' + envios[0].id + '/dispatch', {
      token: ctx.tokenVendedor, json: { transportadora: 'Servientrega', numero_guia: 'G1' },
    });
    await ctx.pide('PATCH', '/shipments/' + envios[0].id + '/status', { token: ctx.tokenVendedor, json: { estado: 'en_camino' } });
    await ctx.pide('PATCH', '/shipments/' + envios[0].id + '/status', { token: ctx.tokenVendedor, json: { estado: 'entregado' } });

    const p = await uno('SELECT estado_general FROM pedidos WHERE id=?', [pedidoId]);
    assert.notEqual(p.estado_general, 'procesando',
      'entregado el envio, el pedido deberia dejar de estar en procesando');
  });

  test('un pedido pagado sigue visible en my-orders con su estado', async () => {
    banco.exigeBanco();
    const { pedidoId } = await crearPedido({ token: ctx.tokenA, dir: ctx.dirA });
    await pagar(pedidoId, ctx.tokenA);
    const { json } = await ctx.pide('GET', '/orders/my-orders', { token: ctx.tokenA });
    const encontrado = listaDe(json).find((o) => Number(o.id) === Number(pedidoId));
    assert.ok(encontrado, 'el pedido pagado debe seguir en el listado del comprador');
    assert.equal(encontrado.estado_pago, 'pagado');
  });
});
