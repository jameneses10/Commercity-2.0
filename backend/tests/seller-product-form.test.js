/* Regresion de #57 y #61 — alta y edicion de productos desde el formulario del vendedor.
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
 * Requisitos para la mitad de ejecucion: MySQL accesible con las credenciales
 * de backend/.env. Crea y destruye una base propia con nombre exclusivo por
 * ejecucion, `cc_f00_test_<marca>_<aleatorio>`, de modo que nunca borra una
 * base preexistente ni colisiona con otra ejecucion; NUNCA toca
 * commercity_db. Si no puede prepararla, aborta con un mensaje explicito en
 * lugar de fallar como si el defecto se hubiera reproducido.
 *
 *   cd backend && node --test tests/
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const FORM = path.join(RAIZ, 'frontend-web', 'vendedor-producto-form.html');
const SELLER = path.join(RAIZ, 'frontend-web', 'js', 'seller.js');
const SUBIDAS = path.join(RAIZ, 'backend', 'uploads', 'products');

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
    const cuerpo = cuerpoDelFormulario();
    const sel = cuerpo.match(/<select\b[^>]*\bname="categoria_id"[^>]*>/);
    assert.ok(sel, 'categoria_id debe ser un <select>; un campo de texto libre no produce un identificador entero');
  });

  test('los estados ofrecidos pertenecen al enum del backend', () => {
    const cuerpo = cuerpoDelFormulario();
    const bloque = cuerpo.match(/<select\b[^>]*\bname="estado"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(bloque, 'no hay un <select name="estado"> en el formulario');
    const valores = [...bloque[1].matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    assert.ok(valores.length > 0, 'el selector de estado no ofrece ningun valor');
    const invalidos = valores.filter((v) => !ESTADOS.includes(v));
    assert.deepEqual(invalidos, [], 'valores fuera del enum: ' + invalidos.join(', '));
  });

  test('la edicion preselecciona la categoria actual', () => {
    const js = fs.readFileSync(SELLER, 'utf8');
    assert.ok(!/form.categoria(?![_A-Za-z0-9])/.test(js),
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

/* Nombre exclusivo por ejecucion: nunca se reutiliza ni se borra una base que
   ya existiera. Si por un choque astronomico el nombre estuviera ocupado,
   CREATE falla y la prueba aborta, que es lo seguro. */
const BD = 'cc_f00_test_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

let ctx = null;          // {srv, base, pool, tokenVendedor, tokenComprador, categoriaId}
let motivoOmision = null;
let cfgRaiz = null;      // credenciales, para poder limpiar aunque prepara() falle
let bdCreada = false;    // se marca en cuanto la base existe, no al final
let poolAbierto = null;  // referencias vivas desde que se crean, no desde ctx
let srvAbierto = null;
let subidasPrevias = null;

async function prepara() {
  const BACK = path.join(RAIZ, 'backend');
  require('dotenv').config({ path: path.join(BACK, '.env') });

  /* Fotografia de las subidas antes de tocar nada, para que el desmontaje sepa
     que borrar aunque la preparacion falle en cualquier punto posterior. */
  subidasPrevias = new Set(fs.existsSync(SUBIDAS) ? fs.readdirSync(SUBIDAS) : []);

  const mysql = require('mysql2/promise');
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  };
  cfgRaiz = cfg;

  /* Guarda explicita: la base de ensayo jamas puede ser la operativa. */
  const operativa = (process.env.DB_NAME || 'commercity_db').toLowerCase();
  assert.notEqual(BD.toLowerCase(), operativa, 'la base de pruebas no puede ser la operativa');
  assert.ok(BD.startsWith('cc_f00_test_'), 'nombre de base de pruebas inesperado: ' + BD);

  /* finally en ambas conexiones: una conexion filtrada mantiene vivo el proceso
     y un fallo de preparacion colgaria la ejecucion en lugar de terminar. */
  const raiz = await mysql.createConnection(cfg);
  try {
    await raiz.query('CREATE DATABASE ' + BD + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    bdCreada = true;
  } finally {
    await raiz.end();
  }

  const con = await mysql.createConnection({ ...cfg, database: BD });
  try {
    for (const dir of ['migrations', 'seeders']) {
      const d = path.join(BACK, 'database', dir);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.sql')).sort()) {
        await con.query(fs.readFileSync(path.join(d, f), 'utf8'));
      }
    }
  } finally {
    await con.end();
  }

  process.env.DB_NAME = BD;
  const { pool } = require(path.join(BACK, 'src', 'config', 'database'));
  const { hashPassword } = require(path.join(BACK, 'src', 'utils', 'password'));
  const app = require(path.join(BACK, 'src', 'app'));
  /* Se registran en cuanto existen, no al final: si la preparacion falla mas
     adelante (por ejemplo en el login), el desmontaje debe poder cerrarlos
     igualmente. Nada que haya que liberar depende de que ctx llegue a existir. */
  poolAbierto = pool;

  const rol = async (n) => (await pool.query('SELECT id FROM roles WHERE nombre=? LIMIT 1', [n]))[0][0].id;
  const clave = await hashPassword('Prueba#2026');
  const alta = async (rolId, nombre, correo) => (await pool.query(
    "INSERT INTO usuarios (rol_id,nombre,correo,password_hash,estado) VALUES (?,?,?,?,'activo')",
    [rolId, nombre, correo, clave]))[0].insertId;

  const vendedorId = await alta(await rol('vendedor'), 'Vendedora F00', 'vendedor@f00.test');
  await alta(await rol('comprador'), 'Comprador F00', 'comprador@f00.test');
  await pool.query("INSERT INTO tiendas (usuario_id,nombre,descripcion,estado) VALUES (?,?,?,'activa')",
    [vendedorId, 'Tienda F00', 'tienda de regresion']);
  const [[cat]] = await pool.query('SELECT id FROM categorias LIMIT 1');

  const srv = app.listen(0);
  srvAbierto = srv;
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/v1';

  const entra = async (correo) => {
    const r = await fetch(base + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, password: 'Prueba#2026' }),
    });
    const j = await r.json();
    assert.ok(j?.data?.token, 'no se pudo iniciar sesion como ' + correo);
    return j.data.token;
  };

  ctx = {
    srv, base, pool, categoriaId: cat.id,
    tokenVendedor: await entra('vendedor@f00.test'),
    tokenComprador: await entra('comprador@f00.test'),
  };
}

before(async () => {
  try {
    await prepara();
  } catch (e) {
    motivoOmision = e.message;
  }
});

/* El desmontaje NO depende de que prepara() haya terminado: si fallo a mitad,
   la base pudo quedar creada. Cada paso se intenta por separado y cualquier
   fallo de limpieza se anuncia, nunca se traga en silencio. */
/* El desmontaje NO depende de ctx: libera todo lo que llego a crearse, en
   orden inverso, y cada paso por separado. Cualquier fallo de limpieza se
   anuncia; ninguno se traga en silencio. */
after(async () => {
  const avisos = [];

  if (srvAbierto) {
    try { srvAbierto.close(); } catch (e) { avisos.push('no se pudo cerrar el servidor: ' + e.message); }
  }
  if (poolAbierto) {
    try { await poolAbierto.end(); } catch (e) { avisos.push('no se pudo cerrar el pool: ' + e.message); }
  }

  if (bdCreada && cfgRaiz) {
    let raiz = null;
    try {
      const mysql = require('mysql2/promise');
      raiz = await mysql.createConnection(cfgRaiz);
      await raiz.query('DROP DATABASE IF EXISTS ' + BD);
    } catch (e) {
      avisos.push('LA BASE ' + BD + ' NO SE PUDO ELIMINAR, borrela a mano: ' + e.message);
    } finally {
      if (raiz) { try { await raiz.end(); } catch (e) { avisos.push('no se pudo cerrar la conexion de limpieza: ' + e.message); } }
    }
  }

  /* Las subidas quedan en disco: se borran solo las creadas por esta ejecucion,
     comparando con el listado tomado antes de empezar. */
  if (subidasPrevias) {
    try {
      for (const f of fs.readdirSync(SUBIDAS)) {
        if (!subidasPrevias.has(f)) fs.unlinkSync(path.join(SUBIDAS, f));
      }
    } catch (e) {
      if (e.code !== 'ENOENT') avisos.push('no se pudieron borrar las subidas de prueba: ' + e.message);
    }
  }

  if (avisos.length) console.error('\nLIMPIEZA INCOMPLETA:\n  ' + avisos.join('\n  ') + '\n');
});

/* Un fallo de preparacion NO es evidencia del defecto: se distingue en voz alta. */
function exigeBanco() {
  if (!ctx) {
    assert.fail('BANCO NO DISPONIBLE, no es evidencia del defecto: ' + motivoOmision);
  }
}

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

async function pide(metodo, ruta, { token, body } = {}) {
  const r = await fetch(ctx.base + ruta, {
    method: metodo,
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

describe('comportamiento del alta y la edicion', () => {
  test('el alta con el contrato del backend persiste el producto', async () => {
    exigeBanco();
    const { status, json } = await pide('POST', '/products', { token: ctx.tokenVendedor, body: payloadValido() });
    assert.equal(status, 201, 'respuesta inesperada: ' + JSON.stringify(json).slice(0, 200));

    const [filas] = await ctx.pool.query(
      'SELECT nombre, precio, stock, categoria_id, estado FROM productos WHERE nombre=?',
      ['Producto de regresion']);
    assert.equal(filas.length, 1, 'el producto no quedo persistido');
    const p = filas[0];
    assert.equal(Number(p.precio), 15000);
    assert.equal(Number(p.stock), 7);
    assert.equal(Number(p.categoria_id), ctx.categoriaId);
  });

  test('la imagen bajo el campo images es aceptada', async () => {
    exigeBanco();
    const fd = payloadValido();
    fd.set('nombre', 'Producto con imagen');
    fd.append(CAMPO_IMAGEN, pngMinimo(), 'p.png');
    const { status, json } = await pide('POST', '/products', { token: ctx.tokenVendedor, body: fd });
    assert.equal(status, 201, 'respuesta inesperada: ' + JSON.stringify(json).slice(0, 200));
  });

  test('la imagen bajo el campo imagen la rechaza el middleware', async () => {
    exigeBanco();
    const fd = payloadValido();
    fd.set('nombre', 'Producto campo erroneo');
    fd.append('imagen', pngMinimo(), 'p.png');
    const { status, json } = await pide('POST', '/products', { token: ctx.tokenVendedor, body: fd });
    assert.equal(status, 400);
    assert.match(String(json.message || ''), /Unexpected field/i);
  });

  test('la edicion acepta oculto y rechaza pausado', async () => {
    exigeBanco();
    const alta = await pide('POST', '/products', { token: ctx.tokenVendedor, body: payloadValido({ nombre: 'Producto editable' }) });
    const id = alta.json?.data?.product?.id ?? alta.json?.data?.producto?.id;
    assert.ok(id, 'no se obtuvo el id del producto creado: ' + JSON.stringify(alta.json).slice(0, 200));

    const ok = new FormData(); ok.append('estado', 'oculto');
    const r1 = await pide('PATCH', '/products/' + id, { token: ctx.tokenVendedor, body: ok });
    assert.equal(r1.status, 200, 'oculto deberia aceptarse: ' + JSON.stringify(r1.json).slice(0, 160));

    const mal = new FormData(); mal.append('estado', 'pausado');
    const r2 = await pide('PATCH', '/products/' + id, { token: ctx.tokenVendedor, body: mal });
    assert.equal(r2.status, 400, 'pausado no pertenece al enum y debe rechazarse');
  });

  test('el payload en ingles que enviaba el formulario sigue siendo rechazado', async () => {
    exigeBanco();
    /* Firma exacta del defecto #57: estos eran los name= del formulario. */
    const fd = new FormData();
    fd.append('name', 'Producto en ingles');
    fd.append('category', String(ctx.categoriaId));
    fd.append('price', '15000');
    fd.append('stock', '7');
    fd.append('description', 'Descripcion suficientemente larga para el validador.');
    fd.append('status', 'activo');
    const { status } = await pide('POST', '/products', { token: ctx.tokenVendedor, body: fd });
    assert.equal(status, 400, 'el backend no debe aceptar el contrato en ingles');

    const [filas] = await ctx.pool.query('SELECT id FROM productos WHERE nombre=?', ['Producto en ingles']);
    assert.equal(filas.length, 0, 'no debe persistir nada de un alta rechazada');
  });

  test('un comprador no puede crear productos', async () => {
    exigeBanco();
    const { status } = await pide('POST', '/products', { token: ctx.tokenComprador, body: payloadValido({ nombre: 'Producto prohibido' }) });
    assert.equal(status, 403);
  });

  test('los campos obligatorios invalidos se siguen rechazando', async () => {
    exigeBanco();
    const fd = new FormData();
    fd.append('nombre', 'x');            // menos del minimo
    fd.append('descripcion', 'corta');   // menos de 10
    fd.append('precio', '0');            // no > 0
    fd.append('stock', '-1');            // no >= 0
    const { status } = await pide('POST', '/products', { token: ctx.tokenVendedor, body: fd });
    assert.equal(status, 400);
  });

  test('/categories entrega categorias utilizables por el selector', async () => {
    exigeBanco();
    const r = await fetch(ctx.base + '/categories');
    assert.equal(r.status, 200);
    const j = await r.json();
    const cats = j?.data?.categories || [];
    assert.ok(cats.length > 0, '/categories no devolvio ninguna categoria');
    assert.ok(cats.every((c) => Number.isInteger(Number(c.id)) && c.nombre),
      'cada categoria necesita id entero y nombre para poblar el <select>');
  });
});
