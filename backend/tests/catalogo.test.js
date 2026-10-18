/* RNF-069 — productos: catalogo publico, filtros, orden, paginacion y
 * visibilidad. El alta y la edicion del vendedor viven en
 * seller-product-form.test.js; aqui se cubre el otro lado del modulo.
 *
 * Contrato del listado, leido del codigo y fijado aqui a proposito:
 *   - responde { products, pagination: { page, limit, total, pages } }
 *   - `limit` por defecto 12, acotado a [1, 50]
 *   - solo son visibles los productos en estado 'activo' o 'agotado',
 *     cuya tienda y categoria esten 'activa'
 *   - filtros: q, category_id, store_id, min_price, max_price
 *   - orden: newest, price_asc, price_desc, rating_desc
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

let ctx = null;

before(async () => {
  const b = await banco.preparaTolerante('catalogo');
  if (!b) return;
  const a = await banco.siembraActores(b.pool);
  const api = banco.cliente(b.base);

  /* Segunda tienda y segunda categoria, para que los filtros tengan algo que
     discriminar: un filtro que no excluye nada no demuestra nada. */
  const [v2] = await b.pool.query(
    "INSERT INTO usuarios (rol_id,nombre,correo,password_hash,estado) SELECT rol_id,'Vendedor Dos','vendedor2@prueba.test',password_hash,'activo' FROM usuarios WHERE id=?", [a.vendedorId]);
  const [t2] = await b.pool.query(
    "INSERT INTO tiendas (usuario_id,nombre,slug,descripcion,estado) VALUES (?,?,?,?,'activa')",
    [v2.insertId, 'Tienda Dos', banco.nuevoSlug('tienda-dos'), 'segunda tienda']);
  const [[cat2]] = await b.pool.query('SELECT id FROM categorias WHERE id<>? LIMIT 1', [a.categoriaId]);

  /* 18 productos visibles en la tienda 1, para que 12 por pagina deje resto. */
  await banco.siembraProductos(b.pool, a.tiendaId, a.categoriaId, 18, { nombre: 'Articulo', precio: 10000 });
  /* uno caro y uno barato, para el rango de precio y el orden */
  await banco.siembraProductos(b.pool, a.tiendaId, a.categoriaId, 1, { nombre: 'Carisimo', precio: 990000 });
  await banco.siembraProductos(b.pool, a.tiendaId, a.categoriaId, 1, { nombre: 'Baratisimo', precio: 1000 });
  /* uno en la segunda tienda y segunda categoria */
  await banco.siembraProductos(b.pool, t2.insertId, cat2.id, 1, { nombre: 'DeLaOtraTienda', precio: 50000 });
  /* invisibles: estado oculto y estado eliminado */
  await banco.siembraProductos(b.pool, a.tiendaId, a.categoriaId, 1, { nombre: 'Ocultado', estado: 'oculto' });
  await banco.siembraProductos(b.pool, a.tiendaId, a.categoriaId, 1, { nombre: 'Borrado', estado: 'eliminado' });

  ctx = { ...b, ...a, ...api, tienda2: t2.insertId, categoria2: cat2.id };
});

after(banco.desmonta);

const nombres = (j) => (j?.data?.products || []).map((p) => p.nombre);

describe('contrato del listado', () => {
  test('devuelve productos y metadatos de paginacion completos', async () => {
    banco.exigeBanco();
    const { status, json } = await ctx.pide('GET', '/products');
    assert.equal(status, 200);
    const p = json?.data?.pagination;
    assert.ok(p, 'falta el bloque pagination');
    for (const campo of ['page', 'limit', 'total', 'pages']) {
      assert.ok(Object.hasOwn(p, campo), 'pagination debe incluir ' + campo);
    }
    assert.equal(p.page, 1);
    assert.equal(p.limit, 12, 'el limite por defecto es 12');
    assert.equal(p.pages, Math.ceil(p.total / p.limit), 'pages debe derivar de total y limit');
    assert.equal(json.data.products.length, 12, 'la primera pagina debe venir llena');
  });

  test('el total declarado coincide con los visibles en la base', async () => {
    banco.exigeBanco();
    const { json } = await ctx.pide('GET', '/products');
    const [[fila]] = await ctx.pool.query(`
      SELECT COUNT(*) n FROM productos p
        INNER JOIN tiendas t ON t.id=p.tienda_id
        INNER JOIN categorias c ON c.id=p.categoria_id
       WHERE p.estado IN ('activo','agotado') AND t.estado='activa' AND c.estado='activa'`);
    assert.equal(Number(json.data.pagination.total), Number(fila.n));
  });
});

describe('paginacion', () => {
  test('la segunda pagina trae productos distintos y no repite', async () => {
    banco.exigeBanco();
    const p1 = await ctx.pide('GET', '/products?page=1&limit=5&sort=price_asc');
    const p2 = await ctx.pide('GET', '/products?page=2&limit=5&sort=price_asc');
    assert.equal(p1.json.data.products.length, 5);
    assert.equal(p2.json.data.products.length, 5);
    const ids1 = p1.json.data.products.map((x) => x.id);
    const ids2 = p2.json.data.products.map((x) => x.id);
    const repetidos = ids1.filter((i) => ids2.includes(i));
    assert.deepEqual(repetidos, [], 'las paginas no deben solaparse');
  });

  /* El contrato valida el limite en vez de recortarlo en silencio: pedir 500
     es un error del cliente y se le dice, no se le sirve otra cosa. */
  test('un limite fuera de rango o no numerico se rechaza con 400', async () => {
    banco.exigeBanco();
    for (const q of ['limit=500', 'limit=0', 'limit=-1', 'limit=abc', 'page=0']) {
      const { status } = await ctx.pide('GET', '/products?' + q);
      assert.equal(status, 400, q + ' deberia rechazarse, llego ' + status);
    }
  });

  test('50 es el maximo aceptado y se sirve entero', async () => {
    banco.exigeBanco();
    const { status, json } = await ctx.pide('GET', '/products?limit=50');
    assert.equal(status, 200);
    assert.equal(json.data.pagination.limit, 50);
  });

  test('una pagina mas alla del final viene vacia, no falla', async () => {
    banco.exigeBanco();
    const { status, json } = await ctx.pide('GET', '/products?page=999&limit=12');
    assert.equal(status, 200);
    assert.equal(json.data.products.length, 0);
    assert.ok(Number(json.data.pagination.total) > 0, 'el total sigue siendo el real');
  });
});

describe('filtros y orden', () => {
  test('el filtro por tienda excluye las demas', async () => {
    banco.exigeBanco();
    const { json } = await ctx.pide('GET', '/products?store_id=' + ctx.tienda2 + '&limit=50');
    assert.ok(json.data.products.length > 0, 'la segunda tienda tiene producto');
    assert.deepEqual(nombres(json), ['DeLaOtraTienda 0']);
  });

  test('el filtro por categoria excluye las demas', async () => {
    banco.exigeBanco();
    const { json } = await ctx.pide('GET', '/products?category_id=' + ctx.categoria2 + '&limit=50');
    assert.ok(json.data.products.length > 0);
    assert.ok(json.data.products.every((p) => Number(p.categoria_id) === Number(ctx.categoria2)),
      'se colaron productos de otra categoria');
  });

  test('el rango de precio acota por ambos extremos', async () => {
    banco.exigeBanco();
    const { json } = await ctx.pide('GET', '/products?min_price=500000&limit=50');
    assert.deepEqual(nombres(json), ['Carisimo 0'], 'solo el caro supera 500000');

    const barato = await ctx.pide('GET', '/products?max_price=2000&limit=50');
    assert.deepEqual(nombres(barato.json), ['Baratisimo 0'], 'solo el barato baja de 2000');
  });

  test('la busqueda por texto encuentra por nombre', async () => {
    banco.exigeBanco();
    const { json } = await ctx.pide('GET', '/products?q=Baratisimo&limit=50');
    assert.deepEqual(nombres(json), ['Baratisimo 0']);
  });

  test('price_asc y price_desc ordenan de verdad', async () => {
    banco.exigeBanco();
    const asc = await ctx.pide('GET', '/products?sort=price_asc&limit=50');
    const precios = asc.json.data.products.map((p) => Number(p.precio));
    assert.deepEqual(precios, [...precios].sort((a, b) => a - b), 'price_asc no viene ordenado');
    assert.equal(precios[0], 1000, 'el primero debe ser el mas barato');

    const desc = await ctx.pide('GET', '/products?sort=price_desc&limit=50');
    const pd = desc.json.data.products.map((p) => Number(p.precio));
    assert.deepEqual(pd, [...pd].sort((a, b) => b - a), 'price_desc no viene ordenado');
    assert.equal(pd[0], 990000, 'el primero debe ser el mas caro');
  });

  test('un orden no admitido se rechaza', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('GET', '/products?sort=lo_que_sea');
    assert.equal(status, 400);
  });
});

describe('visibilidad', () => {
  test('los productos ocultos y eliminados no aparecen en el catalogo', async () => {
    banco.exigeBanco();
    const { json } = await ctx.pide('GET', '/products?limit=50');
    const vistos = nombres(json);
    assert.ok(!vistos.includes('Ocultado 0'), 'un producto oculto no debe listarse');
    assert.ok(!vistos.includes('Borrado 0'), 'un producto eliminado no debe listarse');
  });

  test('pausar la tienda retira sus productos del catalogo', async () => {
    banco.exigeBanco();
    const antes = await ctx.pide('GET', '/products?store_id=' + ctx.tienda2 + '&limit=50');
    assert.equal(antes.json.data.products.length, 1);

    await ctx.pool.query("UPDATE tiendas SET estado='pausada' WHERE id=?", [ctx.tienda2]);
    const durante = await ctx.pide('GET', '/products?store_id=' + ctx.tienda2 + '&limit=50');
    assert.equal(durante.json.data.products.length, 0, 'una tienda pausada no publica catalogo');

    await ctx.pool.query("UPDATE tiendas SET estado='activa' WHERE id=?", [ctx.tienda2]);
    const despues = await ctx.pide('GET', '/products?store_id=' + ctx.tienda2 + '&limit=50');
    assert.equal(despues.json.data.products.length, 1, 'al reactivarla vuelve a publicar');
  });

  test('el detalle de un producto visible responde 200 y el de uno inexistente 404', async () => {
    banco.exigeBanco();
    const lista = await ctx.pide('GET', '/products?limit=1');
    const id = lista.json.data.products[0].id;
    const ok = await ctx.pide('GET', '/products/' + id);
    assert.equal(ok.status, 200);
    assert.equal(Number(ok.json?.data?.product?.id ?? ok.json?.data?.producto?.id), Number(id));

    const no = await ctx.pide('GET', '/products/99999999');
    assert.equal(no.status, 404);
  });
});

describe('listado del vendedor', () => {
  test('el vendedor ve los productos de su tienda, incluidos los no publicos', async () => {
    banco.exigeBanco();
    const token = await ctx.entra('vendedor@prueba.test');
    const { status, json } = await ctx.pide('GET', '/seller/products', { token });
    assert.equal(status, 200);
    const vistos = (json?.data?.products || []).map((p) => p.nombre);
    assert.ok(vistos.includes('Ocultado 0'),
      'el vendedor si debe ver sus productos ocultos, aunque el catalogo publico no');
    assert.ok(!vistos.includes('DeLaOtraTienda 0'), 'no debe ver los de otra tienda');
  });

  test('el listado del vendedor acota el volumen que devuelve', { todo: '#54 — sellerProducts no pagina: ignora req.query y devuelve la tienda entera' }, async () => {
    banco.exigeBanco();
    const token = await ctx.entra('vendedor@prueba.test');
    const { json } = await ctx.pide('GET', '/seller/products?limit=5&page=1', { token });
    const n = (json?.data?.products || []).length;
    assert.ok(n <= 5, 'se pidieron 5 y llegaron ' + n + '; el endpoint debe acotar el volumen');
  });
});
