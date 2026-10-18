/* Regresion de #57 y #61 — alta y edicion de productos desde el formulario del
 * vendedor. Cerrados e integrados en 47339ce; estas pruebas son la guarda.
 *
 * Por que existe: el formulario enviaba los nombres de campo en ingles (`name`,
 * `category`, `price`, `description`, `status`) mientras el backend exige
 * `nombre`, `categoria_id`, `precio`, `descripcion`, `estado`, y adjuntaba la
 * imagen bajo la clave `imagen` cuando la ruta declara `.array('images', 6)`.
 * Resultado: POST /products devolvia 400 y la subida 400 «Unexpected field»,
 * de modo que un vendedor no podia dar de alta un producto desde la interfaz.
 *
 * El fichero tiene dos mitades deliberadamente separadas:
 *   1. CONTRATO (estatico)  — lee el HTML y seller.js. No necesita MySQL.
 *      Son las guardas de regresion: fallan si alguien vuelve a desalinear los
 *      nombres de campo.
 *   2. COMPORTAMIENTO (ejecucion) — levanta la app contra un banco desechable
 *      y comprueba que el contrato aceptado persiste de verdad.
 *
 * La mitad de ejecucion se apoya en tests/apoyo/banco.js; lea su cabecera para
 * las garantias de aislamiento y limpieza.
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const banco = require('./apoyo/banco');

const RAIZ = banco.RAIZ;
const FORM = path.join(RAIZ, 'frontend-web', 'vendedor-producto-form.html');
const SELLER = path.join(RAIZ, 'frontend-web', 'js', 'seller.js');

/* El backend es la fuente de verdad del contrato; estos valores se repiten aqui
   a proposito, para que la prueba falle si alguien los cambia sin querer. */
const CAMPOS_ALTA = ['nombre', 'descripcion', 'precio', 'stock', 'categoria_id'];
const ESTADOS = ['activo', 'agotado', 'oculto', 'eliminado'];
const CAMPO_IMAGEN = 'images';

/* ─────────────────────────── 1. CONTRATO (estatico) ─────────────────────── */

function cuerpoDelFormulario() {
  const html = fs.readFileSync(FORM, 'utf8');
  const i = html.indexOf('id="sellerProductForm"');
  assert.notEqual(i, -1, 'no se encontro el formulario #sellerProductForm');
  const ini = html.lastIndexOf('<form', i);
  const fin = html.indexOf('</form>', i);
  assert.ok(ini !== -1 && fin !== -1, 'el formulario no esta bien delimitado');
  return html.slice(ini, fin);
}

function nombresDeCampo(cuerpo) {
  return [...cuerpo.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
}

describe('contrato del formulario de producto', () => {
  test('declara todos los campos que exige createProductValidator', () => {
    const nombres = nombresDeCampo(cuerpoDelFormulario());
    const faltan = CAMPOS_ALTA.filter((c) => !nombres.includes(c));
    assert.deepEqual(faltan, [], 'campos ausentes en el formulario: ' + faltan.join(', ') +
      ' (declara: ' + nombres.join(', ') + ')');
  });

  test('no quedan nombres de campo en ingles', () => {
    const nombres = nombresDeCampo(cuerpoDelFormulario());
    const ingles = ['name', 'category', 'price', 'description', 'status'].filter((c) => nombres.includes(c));
    assert.deepEqual(ingles, [], 'el formulario aun envia: ' + ingles.join(', '));
  });

  test('la categoria se elige de una lista y viaja como identificador', () => {
    const sel = cuerpoDelFormulario().match(/<select\b[^>]*\bname="categoria_id"[^>]*>/);
    assert.ok(sel, 'categoria_id debe ser un <select>; un campo de texto libre no produce un identificador entero');
  });

  test('los estados ofrecidos pertenecen al enum del backend', () => {
    const bloque = cuerpoDelFormulario().match(/<select\b[^>]*\bname="estado"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(bloque, 'no hay un <select name="estado"> en el formulario');
    const valores = [...bloque[1].matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    assert.ok(valores.length > 0, 'el selector de estado no ofrece ningun valor');
    const invalidos = valores.filter((v) => !ESTADOS.includes(v));
    assert.deepEqual(invalidos, [], 'valores fuera del enum: ' + invalidos.join(', '));
  });

  test('la edicion preselecciona la categoria actual', () => {
    const js = fs.readFileSync(SELLER, 'utf8');
    assert.ok(!/form\.categoria(?![_A-Za-z0-9])/.test(js),
      'seller.js precarga form.categoria, un campo que no existe en el HTML; debe usar categoria_id');
  });

  test('seller.js adjunta la imagen bajo el campo que declara la ruta', () => {
    const js = fs.readFileSync(SELLER, 'utf8');
    assert.ok(js.includes("append('" + CAMPO_IMAGEN + "'") || js.includes('append("' + CAMPO_IMAGEN + '"'),
      "seller.js debe adjuntar la imagen como '" + CAMPO_IMAGEN + "'");
    assert.ok(!/append\(\s*['"]imagen['"]/.test(js),
      "seller.js aun adjunta la imagen como 'imagen'; multer responde 400 Unexpected field");
  });
});

/* ──────────────────────── 2. COMPORTAMIENTO (ejecucion) ─────────────────── */

let ctx = null;

before(async () => {
  const b = await banco.preparaTolerante('productos');
  if (!b) return;
  const actores = await banco.siembraActores(b.pool);
  const api = banco.cliente(b.base);
  ctx = {
    ...b, ...actores, ...api,
    tokenVendedor: await api.entra('vendedor@prueba.test'),
    tokenComprador: await api.entra('comprador0@prueba.test'),
  };
});

after(banco.desmonta);

function payloadValido(extra = {}) {
  const fd = new FormData();
  fd.append('nombre', 'Producto de regresion');
  fd.append('descripcion', 'Descripcion suficientemente larga para el validador.');
  fd.append('precio', '15000');
  fd.append('stock', '7');
  fd.append('categoria_id', String(ctx.categoriaId));
  /* set, no append: repetir una clave convierte el valor en array y el
     servicio recibe algo que no es una cadena. */
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function pngMinimo() {
  return new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')], { type: 'image/png' });
}

describe('comportamiento del alta y la edicion', () => {
  test('el alta con el contrato del backend persiste el producto', async () => {
    banco.exigeBanco();
    const { status, json } = await ctx.pide('POST', '/products', { token: ctx.tokenVendedor, body: payloadValido() });
    assert.equal(status, 201, 'respuesta inesperada: ' + JSON.stringify(json).slice(0, 200));

    const [filas] = await ctx.pool.query(
      'SELECT nombre, precio, stock, categoria_id, estado FROM productos WHERE nombre=?',
      ['Producto de regresion']);
    assert.equal(filas.length, 1, 'el producto no quedo persistido');
    assert.equal(Number(filas[0].precio), 15000);
    assert.equal(Number(filas[0].stock), 7);
    assert.equal(Number(filas[0].categoria_id), ctx.categoriaId);
  });

  test('la imagen bajo el campo images es aceptada', async () => {
    banco.exigeBanco();
    const fd = payloadValido({ nombre: 'Producto con imagen' });
    fd.append(CAMPO_IMAGEN, pngMinimo(), 'p.png');
    const { status, json } = await ctx.pide('POST', '/products', { token: ctx.tokenVendedor, body: fd });
    assert.equal(status, 201, 'respuesta inesperada: ' + JSON.stringify(json).slice(0, 200));
  });

  test('la imagen bajo el campo imagen la rechaza el middleware', async () => {
    banco.exigeBanco();
    const fd = payloadValido({ nombre: 'Producto campo erroneo' });
    fd.append('imagen', pngMinimo(), 'p.png');
    const { status, json } = await ctx.pide('POST', '/products', { token: ctx.tokenVendedor, body: fd });
    assert.equal(status, 400);
    assert.match(String(json.message || ''), /Unexpected field/i);
  });

  test('la edicion acepta oculto y rechaza pausado', async () => {
    banco.exigeBanco();
    const alta = await ctx.pide('POST', '/products', { token: ctx.tokenVendedor, body: payloadValido({ nombre: 'Producto editable' }) });
    const id = alta.json?.data?.product?.id ?? alta.json?.data?.producto?.id;
    assert.ok(id, 'no se obtuvo el id del producto creado: ' + JSON.stringify(alta.json).slice(0, 200));

    const ok = new FormData(); ok.append('estado', 'oculto');
    const r1 = await ctx.pide('PATCH', '/products/' + id, { token: ctx.tokenVendedor, body: ok });
    assert.equal(r1.status, 200, 'oculto deberia aceptarse: ' + JSON.stringify(r1.json).slice(0, 160));

    const mal = new FormData(); mal.append('estado', 'pausado');
    const r2 = await ctx.pide('PATCH', '/products/' + id, { token: ctx.tokenVendedor, body: mal });
    assert.equal(r2.status, 400, 'pausado no pertenece al enum y debe rechazarse');
  });

  test('el payload en ingles que enviaba el formulario sigue siendo rechazado', async () => {
    banco.exigeBanco();
    /* Firma exacta del defecto #57: estos eran los name= del formulario. */
    const fd = new FormData();
    fd.append('name', 'Producto en ingles');
    fd.append('category', String(ctx.categoriaId));
    fd.append('price', '15000');
    fd.append('stock', '7');
    fd.append('description', 'Descripcion suficientemente larga para el validador.');
    fd.append('status', 'activo');
    const { status } = await ctx.pide('POST', '/products', { token: ctx.tokenVendedor, body: fd });
    assert.equal(status, 400, 'el backend no debe aceptar el contrato en ingles');

    const [filas] = await ctx.pool.query('SELECT id FROM productos WHERE nombre=?', ['Producto en ingles']);
    assert.equal(filas.length, 0, 'no debe persistir nada de un alta rechazada');
  });

  test('un comprador no puede crear productos', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('POST', '/products', { token: ctx.tokenComprador, body: payloadValido({ nombre: 'Producto prohibido' }) });
    assert.equal(status, 403);
  });

  test('los campos obligatorios invalidos se siguen rechazando', async () => {
    banco.exigeBanco();
    const fd = new FormData();
    fd.append('nombre', 'x');            // menos del minimo
    fd.append('descripcion', 'corta');   // menos de 10
    fd.append('precio', '0');            // no > 0
    fd.append('stock', '-1');            // no >= 0
    const { status } = await ctx.pide('POST', '/products', { token: ctx.tokenVendedor, body: fd });
    assert.equal(status, 400);
  });

  test('/categories entrega categorias utilizables por el selector', async () => {
    banco.exigeBanco();
    const { status, json } = await ctx.pide('GET', '/categories');
    assert.equal(status, 200);
    const cats = json?.data?.categories || [];
    assert.ok(cats.length > 0, '/categories no devolvio ninguna categoria');
    assert.ok(cats.every((c) => Number.isInteger(Number(c.id)) && c.nombre),
      'cada categoria necesita id entero y nombre para poblar el <select>');
  });
});
