/* Infraestructura compartida de las pruebas: una base desechable por fichero,
 * la aplicacion escuchando en un puerto efimero y sesiones ya iniciadas.
 *
 * ── DEPENDENCIA CRITICA, no la rompa ──────────────────────────────────────
 * `node --test` arranca UN PROCESO POR FICHERO. Verificado: dos ficheros de
 * sonda dieron PID distintos y no compartieron globales. De ahi depende todo
 * este modulo, porque `prepara()` fija `process.env.DB_NAME` y solo despues
 * hace `require('src/config/database')`, que lee esa variable al cargarse y
 * queda cacheado por el resolvedor de modulos.
 *
 * Si dos ficheros de prueba llegaran a compartir proceso, el segundo recibiria
 * el pool del primero, apuntando a la base equivocada, y las suites se
 * contaminarian EN SILENCIO: sin error, con datos de otro modulo. Por eso:
 *
 *   - un unico `prepara()` por fichero, nunca dos;
 *   - no se ejecutan las pruebas con un corredor que agrupe ficheros en un
 *     mismo proceso;
 *   - cada fichero obtiene su propio nombre de base, exclusivo por ejecucion.
 *
 * ── Coste ─────────────────────────────────────────────────────────────────
 * Montar la base (crear + 20 migraciones + 2 seeders) cuesta ~3,5 s dentro de
 * Node. Hacerlo desde el shell lanzando `mysql` por fichero cuesta ~54 s: son
 * 22 arranques de proceso. Por eso aqui se usa una sola conexion con
 * `multipleStatements`.
 *
 * ── Garantias de limpieza ─────────────────────────────────────────────────
 * El desmontaje NO depende de que `prepara()` termine. Cada recurso se
 * registra en cuanto existe, se libera por separado y cualquier fallo de
 * limpieza se anuncia por stderr en vez de tragarse. Las conexiones se cierran
 * en `finally`: una conexion filtrada no deja terminar el proceso y cuelga la
 * ejecucion en lugar de fallar.
 *
 * `commercity_db` NUNCA se usa como base de ensayo; hay una guarda explicita.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BACK = path.join(__dirname, '..', '..');
const RAIZ = path.join(BACK, '..');
const SUBIDAS = path.join(BACK, 'uploads');

const CLAVE = 'Prueba#2026';

/* Estado del fichero en curso. Un solo prepara() por proceso. */
const estado = {
  bd: null,
  cfgRaiz: null,
  bdCreada: false,
  pool: null,
  srv: null,
  subidasPrevias: null,
  preparado: false,
  motivoFallo: null,
};

/* Identificador unico para columnas con restriccion UNIQUE (slug de tienda y
   de producto). Dejarlas vacias hace que la segunda insercion choque. */
function nuevoSlug(prefijo) {
  return prefijo + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function nombreDeBase(etiqueta) {
  const limpia = String(etiqueta || 'test').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'test';
  return 'cc_t_' + limpia + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/* Lista recursiva de los ficheros bajo uploads/, para saber que borrar luego. */
function fotoDeSubidas() {
  const vistos = new Set();
  const recorre = (dir, rel) => {
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) recorre(path.join(dir, e.name), r);
      else vistos.add(r);
    }
  };
  recorre(SUBIDAS, '');
  return vistos;
}

/**
 * Levanta base, migraciones, seeders y la aplicacion.
 * @param {string} etiqueta  nombre corto del modulo, solo para identificar la base
 * @returns {Promise<{base:string, pool:object, bd:string}>}
 */
async function prepara(etiqueta) {
  assert.ok(!estado.preparado, 'prepara() se llamo dos veces en el mismo proceso');

  require('dotenv').config({ path: path.join(BACK, '.env') });

  /* Antes de tocar nada, para que el desmontaje sepa que borrar aunque la
     preparacion falle en cualquier punto posterior. */
  estado.subidasPrevias = fotoDeSubidas();

  const mysql = require('mysql2/promise');
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  };
  estado.cfgRaiz = cfg;

  const operativa = (process.env.DB_NAME || 'commercity_db').toLowerCase();
  const bd = nombreDeBase(etiqueta);
  assert.notEqual(bd.toLowerCase(), operativa, 'la base de pruebas no puede ser la operativa');
  assert.ok(bd.startsWith('cc_t_'), 'nombre de base de pruebas inesperado: ' + bd);
  estado.bd = bd;

  const raiz = await mysql.createConnection(cfg);
  try {
    await raiz.query('CREATE DATABASE ' + bd + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    estado.bdCreada = true;
  } finally {
    await raiz.end();
  }

  const con = await mysql.createConnection({ ...cfg, database: bd });
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

  /* Solo ahora la aplicacion puede cargarse: lee DB_NAME al requerirse. */
  process.env.DB_NAME = bd;
  const { pool } = require(path.join(BACK, 'src', 'config', 'database'));
  estado.pool = pool;
  const app = require(path.join(BACK, 'src', 'app'));

  const srv = app.listen(0);
  estado.srv = srv;
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/v1';

  estado.preparado = true;
  return { base, pool, bd };
}

/** Libera todo lo que llegara a crearse, pase lo que pase. */
async function desmonta() {
  const avisos = [];

  if (estado.srv) {
    try { estado.srv.close(); } catch (e) { avisos.push('no se pudo cerrar el servidor: ' + e.message); }
  }
  if (estado.pool) {
    try { await estado.pool.end(); } catch (e) { avisos.push('no se pudo cerrar el pool: ' + e.message); }
  }

  if (estado.bdCreada && estado.cfgRaiz) {
    let raiz = null;
    try {
      const mysql = require('mysql2/promise');
      raiz = await mysql.createConnection(estado.cfgRaiz);
      await raiz.query('DROP DATABASE IF EXISTS ' + estado.bd);
    } catch (e) {
      avisos.push('LA BASE ' + estado.bd + ' NO SE PUDO ELIMINAR, borrela a mano: ' + e.message);
    } finally {
      if (raiz) {
        try { await raiz.end(); } catch (e) { avisos.push('no se pudo cerrar la conexion de limpieza: ' + e.message); }
      }
    }
  }

  if (estado.subidasPrevias) {
    const ahora = fotoDeSubidas();
    for (const f of ahora) {
      if (estado.subidasPrevias.has(f)) continue;
      try { fs.unlinkSync(path.join(SUBIDAS, f)); }
      catch (e) { if (e.code !== 'ENOENT') avisos.push('no se pudo borrar la subida ' + f + ': ' + e.message); }
    }
  }

  if (avisos.length) console.error('\nLIMPIEZA INCOMPLETA:\n  ' + avisos.join('\n  ') + '\n');
}

/**
 * Un fallo de preparacion NO es evidencia de un defecto del producto.
 * Llamar al principio de toda prueba que necesite el banco.
 */
function exigeBanco() {
  if (!estado.preparado) {
    assert.fail('BANCO NO DISPONIBLE, no es evidencia del defecto: ' + estado.motivoFallo);
  }
}

/** Envuelve prepara() para que un fallo no reviente el before(). */
async function preparaTolerante(etiqueta) {
  try {
    return await prepara(etiqueta);
  } catch (e) {
    estado.motivoFallo = e.message;
    return null;
  }
}

/* ── Siembra de actores, compartida por las cinco suites ─────────────────── */

async function siembraActores(pool, { compradores = 1 } = {}) {
  const { hashPassword } = require(path.join(BACK, 'src', 'utils', 'password'));
  const clave = await hashPassword(CLAVE);
  const rol = async (n) => (await pool.query('SELECT id FROM roles WHERE nombre=? LIMIT 1', [n]))[0][0].id;
  const alta = async (rolId, nombre, correo) => (await pool.query(
    "INSERT INTO usuarios (rol_id,nombre,correo,password_hash,estado) VALUES (?,?,?,?,'activo')",
    [rolId, nombre, correo, clave]))[0].insertId;

  const adminId = await alta(await rol('administrador'), 'Admin Prueba', 'admin@prueba.test');
  const vendedorId = await alta(await rol('vendedor'), 'Vendedora Prueba', 'vendedor@prueba.test');
  /* `tiendas` tiene slug unico: sin valor explicito dos tiendas chocan en ''. */
  const [t] = await pool.query(
    "INSERT INTO tiendas (usuario_id,nombre,slug,descripcion,estado) VALUES (?,?,?,?,'activa')",
    [vendedorId, 'Tienda Prueba', nuevoSlug('tienda-prueba'), 'tienda de regresion']);

  const rolComprador = await rol('comprador');
  const compradorIds = [];
  for (let i = 0; i < compradores; i++) {
    compradorIds.push(await alta(rolComprador, 'Comprador ' + i, 'comprador' + i + '@prueba.test'));
  }

  const [[cat]] = await pool.query('SELECT id FROM categorias LIMIT 1');
  return { adminId, vendedorId, tiendaId: t.insertId, compradorIds, categoriaId: cat.id };
}

async function siembraProductos(pool, tiendaId, categoriaId, n = 1, extra = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const [r] = await pool.query(
      "INSERT INTO productos (tienda_id,categoria_id,nombre,slug,descripcion,precio,stock,estado) VALUES (?,?,?,?,?,?,?,?)",
      [tiendaId, categoriaId, (extra.nombre || 'Producto') + ' ' + i, 'p-' + Date.now().toString(36) + '-' + i,
        'Descripcion de prueba suficientemente larga.', extra.precio ?? (10000 + i * 100),
        extra.stock ?? 10, extra.estado || 'activo']);
    ids.push(r.insertId);
  }
  return ids;
}

async function siembraDireccion(pool, usuarioId) {
  const [d] = await pool.query(
    "INSERT INTO direcciones (usuario_id,departamento,ciudad,direccion,telefono) VALUES (?,?,?,?,?)",
    [usuarioId, 'Antioquia', 'Medellin', 'Calle 10 #20-30', '3001112233']);
  return d.insertId;
}

/* ── Cliente HTTP minimo ──────────────────────────────────────────────────── */

function cliente(base) {
  const entra = async (correo) => {
    const r = await fetch(base + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, password: CLAVE }),
    });
    const j = await r.json();
    assert.ok(j?.data?.token, 'no se pudo iniciar sesion como ' + correo + ': ' + JSON.stringify(j).slice(0, 160));
    return j.data.token;
  };

  const pide = async (metodo, ruta, { token, json, body } = {}) => {
    const cab = {};
    if (token) cab.Authorization = 'Bearer ' + token;
    if (json !== undefined) cab['Content-Type'] = 'application/json';
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: cab,
      body: json !== undefined ? JSON.stringify(json) : body,
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };

  return { entra, pide };
}

module.exports = {
  CLAVE, BACK, RAIZ, SUBIDAS, nuevoSlug,
  prepara, preparaTolerante, desmonta, exigeBanco,
  siembraActores, siembraProductos, siembraDireccion, cliente,
};
