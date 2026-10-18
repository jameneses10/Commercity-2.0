/* RNF-069 — pagos.
 *
 * Esta suite prueba el PROCESO de pago: quien puede pagar, que solicitudes se
 * admiten, que efectos deja un pago aprobado y cuales NO deja uno rechazado.
 * El estado observable del pedido y sus permisos se prueban en pedidos.test.js.
 *
 * Contrato de la pasarela de arena, leido del codigo:
 *   `4111111111111111` aprueba; cualquier otro numero rechaza.
 *
 * Efectos de un pago aprobado: fila de pago 'aprobado', pedido a
 * 'pagado'/'procesando', descuento de stock (y paso a 'agotado' si llega a
 * cero), una comision por tienda, envios y comprobante.
 * Un pago rechazado no debe tocar el inventario ni generar comisiones.
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

const APRUEBA = '4111111111111111';
const RECHAZA = '4000000000000002';

let ctx = null;

before(async () => {
  const b = await banco.preparaTolerante('pagos');
  if (!b) return;
  const a = await banco.siembraActores(b.pool, { compradores: 2 });
  const api = banco.cliente(b.base);
  ctx = {
    ...b, ...a, ...api,
    tokenA: await api.entra('comprador0@prueba.test'),
    tokenB: await api.entra('comprador1@prueba.test'),
    tokenVendedor: await api.entra('vendedor@prueba.test'),
    tokenAdmin: await api.entra('admin@prueba.test'),
    dirA: await banco.siembraDireccion(b.pool, a.compradorIds[0]),
    dirB: await banco.siembraDireccion(b.pool, a.compradorIds[1]),
  };
});

after(banco.desmonta);

function tarjeta(card_number, pedido_id) {
  return { pedido_id, card_number, card_holder: 'PERSONA DE PRUEBA', exp_month: 12, exp_year: 2030, cvv: '123' };
}

/** Crea un pedido pagable: siembra producto, lo mete al carrito y lo confirma. */
async function pedidoNuevo({ token = null, dir = null, stock = 10, cantidad = 1, precio = 10000 } = {}) {
  const t = token || ctx.tokenA;
  const d = dir || ctx.dirA;
  const [prod] = await banco.siembraProductos(ctx.pool, ctx.tiendaId, ctx.categoriaId, 1, { precio, stock });
  await ctx.pide('DELETE', '/cart', { token: t });
  const alta = await ctx.pide('POST', '/cart/items', { token: t, json: { product_id: prod, cantidad } });
  assert.equal(alta.status, 201, 'no se pudo preparar el carrito: ' + JSON.stringify(alta.json).slice(0, 150));
  const ped = await ctx.pide('POST', '/orders', {
    token: t, json: { direccion_id: d, items: [{ producto_id: prod, cantidad }] },
  });
  assert.ok(ped.status === 201 || ped.status === 200, 'no se pudo crear el pedido: ' + JSON.stringify(ped.json).slice(0, 180));
  const id = ped.json?.data?.order?.id ?? ped.json?.data?.pedido?.id ?? ped.json?.data?.id;
  assert.ok(id, 'no se obtuvo el id del pedido: ' + JSON.stringify(ped.json).slice(0, 180));
  return { pedidoId: id, productoId: prod };
}

const uno = async (sql, p) => (await ctx.pool.query(sql, p))[0][0];

describe('acceso y autorizacion', () => {
  test('pagar exige sesion', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('POST', '/payments/sandbox', { json: tarjeta(APRUEBA, 1) });
    assert.equal(status, 401);
  });

  test('un vendedor no puede usar la pasarela de compra', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    const { status } = await ctx.pide('POST', '/payments/sandbox', {
      token: ctx.tokenVendedor, json: tarjeta(APRUEBA, pedidoId),
    });
    assert.equal(status, 403);
  });

  test('un comprador no puede pagar el pedido de otro', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo({ token: ctx.tokenA, dir: ctx.dirA });
    const { status } = await ctx.pide('POST', '/payments/sandbox', {
      token: ctx.tokenB, json: tarjeta(APRUEBA, pedidoId),
    });
    assert.equal(status, 403, 'pagar un pedido ajeno debe ser 403');

    const p = await uno('SELECT estado_pago FROM pedidos WHERE id=?', [pedidoId]);
    assert.equal(p.estado_pago, 'pendiente', 'el intento ajeno no debe alterar el pedido');
  });

  test('un pedido inexistente responde 404', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('POST', '/payments/sandbox', {
      token: ctx.tokenA, json: tarjeta(APRUEBA, 99999999),
    });
    assert.equal(status, 404);
  });
});

describe('solicitud invalida', () => {
  test('faltan datos de la tarjeta o tienen forma incorrecta', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    const casos = {
      'sin card_number': { pedido_id: pedidoId, card_holder: 'X', exp_month: 12, exp_year: 2030, cvv: '123' },
      'numero demasiado corto': tarjeta('411', pedidoId),
      'numero con letras': tarjeta('4111abcd11111111', pedidoId),
      'cvv invalido': { ...tarjeta(APRUEBA, pedidoId), cvv: '1' },
      'mes fuera de rango': { ...tarjeta(APRUEBA, pedidoId), exp_month: 13 },
      'sin pedido_id': { card_number: APRUEBA, card_holder: 'X', exp_month: 12, exp_year: 2030, cvv: '123' },
    };
    for (const [nombre, json] of Object.entries(casos)) {
      const { status } = await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json });
      assert.equal(status, 400, nombre + ' deberia dar 400, llego ' + status);
    }

    const p = await uno('SELECT estado_pago FROM pedidos WHERE id=?', [pedidoId]);
    assert.equal(p.estado_pago, 'pendiente', 'ninguna solicitud invalida debe tocar el pedido');
  });
});

describe('pago aprobado', () => {
  test('deja el pedido pagado y registra el pago', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    const { status, json } = await ctx.pide('POST', '/payments/sandbox', {
      token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId),
    });
    assert.equal(status, 200, JSON.stringify(json).slice(0, 200));
    /* el controlador envuelve el resultado del servicio bajo `payment` */
    assert.equal(json?.data?.payment?.estado, 'aprobado', JSON.stringify(json).slice(0, 200));

    const p = await uno('SELECT estado_pago, estado_general FROM pedidos WHERE id=?', [pedidoId]);
    assert.equal(p.estado_pago, 'pagado');
    assert.equal(p.estado_general, 'procesando');

    const pago = await uno("SELECT estado FROM pagos WHERE pedido_id=? ORDER BY id DESC LIMIT 1", [pedidoId]);
    assert.equal(pago.estado, 'aprobado');
  });

  test('descuenta el inventario exactamente lo comprado', async () => {
    banco.exigeBanco();
    const { pedidoId, productoId } = await pedidoNuevo({ stock: 10, cantidad: 3 });
    const antes = await uno('SELECT stock FROM productos WHERE id=?', [productoId]);
    await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId) });
    const despues = await uno('SELECT stock FROM productos WHERE id=?', [productoId]);
    assert.equal(Number(despues.stock), Number(antes.stock) - 3);
  });

  test('un producto que llega a cero pasa a agotado', async () => {
    banco.exigeBanco();
    const { pedidoId, productoId } = await pedidoNuevo({ stock: 2, cantidad: 2 });
    await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId) });
    const p = await uno('SELECT stock, estado FROM productos WHERE id=?', [productoId]);
    assert.equal(Number(p.stock), 0);
    assert.equal(p.estado, 'agotado');
  });

  test('genera una comision por tienda participante', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo({ precio: 100000, cantidad: 1 });
    await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId) });
    const [filas] = await ctx.pool.query('SELECT tienda_id, valor_comision, subtotal_tienda FROM comisiones WHERE pedido_id=?', [pedidoId]);
    assert.equal(filas.length, 1, 'una tienda, una comision');
    assert.equal(Number(filas[0].tienda_id), ctx.tiendaId);
    assert.ok(Number(filas[0].valor_comision) > 0, 'la comision debe ser positiva');
  });

  test('crea envio y comprobante', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId) });
    const env = await uno('SELECT COUNT(*) n FROM envios WHERE pedido_id=?', [pedidoId]);
    assert.ok(Number(env.n) >= 1, 'debe crearse al menos un envio');
    const comp = await uno('SELECT COUNT(*) n FROM comprobantes WHERE pedido_id=?', [pedidoId]);
    assert.ok(Number(comp.n) >= 1, 'debe emitirse comprobante');
  });

  test('la respuesta no devuelve el numero de tarjeta ni el cvv', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    const { json } = await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId) });
    const texto = JSON.stringify(json);
    assert.ok(!texto.includes(APRUEBA), 'la respuesta incluye el numero de tarjeta');
    assert.ok(!texto.includes('"cvv"'), 'la respuesta incluye el cvv');
  });

  test('el numero de tarjeta no queda guardado en la base', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId) });
    const [filas] = await ctx.pool.query('SELECT * FROM pagos WHERE pedido_id=?', [pedidoId]);
    const serializado = JSON.stringify(filas);
    assert.ok(!serializado.includes(APRUEBA), 'la tabla pagos guarda el numero de tarjeta completo');
    assert.ok(!serializado.includes('123'), 'la tabla pagos podria estar guardando el cvv');
  });

  test('un pedido ya pagado no se cobra dos veces', async () => {
    banco.exigeBanco();
    const { pedidoId, productoId } = await pedidoNuevo({ stock: 10, cantidad: 1 });
    const primero = await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId) });
    assert.equal(primero.status, 200);
    const stockTrasUno = Number((await uno('SELECT stock FROM productos WHERE id=?', [productoId])).stock);

    const segundo = await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId) });
    assert.equal(segundo.status, 409, 'el segundo cobro debe rechazarse');

    const stockFinal = Number((await uno('SELECT stock FROM productos WHERE id=?', [productoId])).stock);
    assert.equal(stockFinal, stockTrasUno, 'el intento repetido no debe volver a descontar');
    const pagos = await uno("SELECT COUNT(*) n FROM pagos WHERE pedido_id=? AND estado='aprobado'", [pedidoId]);
    assert.equal(Number(pagos.n), 1, 'solo puede existir un pago aprobado por pedido');
  });
});

describe('pago rechazado', () => {
  test('registra el rechazo y deja el pedido sin pagar', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    const { status, json } = await ctx.pide('POST', '/payments/sandbox', {
      token: ctx.tokenA, json: tarjeta(RECHAZA, pedidoId),
    });
    assert.ok(status === 200 || status === 402 || status === 409,
      'un rechazo de pasarela es una respuesta de negocio, llego ' + status + ': ' + JSON.stringify(json).slice(0, 150));

    const p = await uno('SELECT estado_pago FROM pedidos WHERE id=?', [pedidoId]);
    assert.notEqual(p.estado_pago, 'pagado', 'un pago rechazado no puede dejar el pedido pagado');
    const pago = await uno('SELECT estado FROM pagos WHERE pedido_id=? ORDER BY id DESC LIMIT 1', [pedidoId]);
    assert.equal(pago.estado, 'rechazado');
  });

  test('no toca el inventario', async () => {
    banco.exigeBanco();
    const { pedidoId, productoId } = await pedidoNuevo({ stock: 7, cantidad: 2 });
    const antes = Number((await uno('SELECT stock FROM productos WHERE id=?', [productoId])).stock);
    await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(RECHAZA, pedidoId) });
    const despues = Number((await uno('SELECT stock FROM productos WHERE id=?', [productoId])).stock);
    assert.equal(despues, antes, 'un rechazo no debe descontar stock');
  });

  test('no genera comisiones ni envios ni comprobante', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(RECHAZA, pedidoId) });
    for (const tabla of ['comisiones', 'envios', 'comprobantes']) {
      const r = await uno('SELECT COUNT(*) n FROM ' + tabla + ' WHERE pedido_id=?', [pedidoId]);
      assert.equal(Number(r.n), 0, 'un rechazo no debe crear filas en ' + tabla);
    }
  });

  test('una tarjeta desconocida tambien rechaza', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta('5555444433332222', pedidoId) });
    const pago = await uno('SELECT estado FROM pagos WHERE pedido_id=? ORDER BY id DESC LIMIT 1', [pedidoId]);
    assert.equal(pago.estado, 'rechazado', 'solo la tarjeta de aprobacion debe aprobar');
  });

  test('tras un rechazo el comprador puede reintentar el pago', { todo: '#82 — el rechazo deja el pedido en estado_pago=rechazado y processPayment exige pendiente, de modo que no hay reintento posible' }, async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(RECHAZA, pedidoId) });

    const reintento = await ctx.pide('POST', '/payments/sandbox', { token: ctx.tokenA, json: tarjeta(APRUEBA, pedidoId) });
    assert.equal(reintento.status, 200, 'un pedido rechazado deberia poder pagarse de nuevo, llego ' + reintento.status);
    const p = await uno('SELECT estado_pago FROM pedidos WHERE id=?', [pedidoId]);
    assert.equal(p.estado_pago, 'pagado');
  });
});

describe('webhook simulado', () => {
  test('solo el administrador puede invocarlo', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    const comprador = await ctx.pide('POST', '/payments/webhook-simulated', {
      token: ctx.tokenA, json: { pedido_id: pedidoId, approved: true },
    });
    assert.equal(comprador.status, 403, 'un comprador no debe disparar el webhook');

    const anonimo = await ctx.pide('POST', '/payments/webhook-simulated', { json: { pedido_id: pedidoId, approved: true } });
    assert.equal(anonimo.status, 401);
  });

  test('aprueba un pedido pendiente y no lo procesa dos veces', async () => {
    banco.exigeBanco();
    const { pedidoId } = await pedidoNuevo();
    const primero = await ctx.pide('POST', '/payments/webhook-simulated', {
      token: ctx.tokenAdmin, json: { pedido_id: pedidoId, approved: true },
    });
    assert.equal(primero.status, 200, JSON.stringify(primero.json).slice(0, 180));
    const p = await uno('SELECT estado_pago FROM pedidos WHERE id=?', [pedidoId]);
    assert.equal(p.estado_pago, 'pagado');

    const segundo = await ctx.pide('POST', '/payments/webhook-simulated', {
      token: ctx.tokenAdmin, json: { pedido_id: pedidoId, approved: true },
    });
    assert.equal(segundo.status, 409, 'el webhook no debe reprocesar un pedido ya pagado');
  });
});
