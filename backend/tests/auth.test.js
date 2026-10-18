/* RNF-069 — autenticacion.
 *
 * Cubre registro publico, inicio de sesion, identidad autenticada, control de
 * rol e invalidacion de sesion al cambiar la contraseña.
 *
 * ── Presupuesto de intentos fallidos ──────────────────────────────────────
 * `loginLimiter` permite 5 intentos por ventana de 15 minutos, pero lleva
 * `skipSuccessfulRequests: true`: **solo cuentan los fallos**. Cada fichero de
 * prueba corre en su propio proceso, con su propia instancia de la aplicacion
 * y por tanto su propio contador, asi que el presupuesto se agota solo aqui.
 *
 * Consecuencia practica: la prueba del limitador va LA ULTIMA del fichero,
 * porque a partir de ella todo inicio de sesion queda bloqueado. Si añade
 * pruebas que fallen el login, pongalas antes.
 *
 *   cd backend && npm test
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banco = require('./apoyo/banco');

const CORRECTA = banco.CLAVE;
let ctx = null;

before(async () => {
  const b = await banco.preparaTolerante('auth');
  if (!b) return;
  /* dos compradores: uno para la sesion corriente y otro para el cambio de
     contraseña, que invalida sus propias sesiones y su clave antigua. */
  const actores = await banco.siembraActores(b.pool, { compradores: 2 });
  const api = banco.cliente(b.base);
  ctx = { ...b, ...actores, ...api };
});

after(banco.desmonta);

function registro(extra = {}) {
  return {
    nombre: 'Persona de Prueba',
    correo: 'nuevo' + Math.random().toString(36).slice(2, 8) + '@prueba.test',
    password: 'Clave#Segura1',
    confirmPassword: 'Clave#Segura1',
    rol: 'comprador',
    acepta_terminos: true,
    ...extra,
  };
}

describe('registro publico', () => {
  test('un comprador se registra y queda persistido con su rol', async () => {
    banco.exigeBanco();
    const datos = registro();
    const { status, json } = await ctx.pide('POST', '/auth/register', { json: datos });
    assert.equal(status, 201, JSON.stringify(json).slice(0, 200));

    const [filas] = await ctx.pool.query(
      'SELECT u.estado, r.nombre rol FROM usuarios u INNER JOIN roles r ON r.id=u.rol_id WHERE u.correo=?',
      [datos.correo]);
    assert.equal(filas.length, 1, 'el usuario no quedo persistido');
    assert.equal(filas[0].rol, 'comprador');
    assert.equal(filas[0].estado, 'activo');
  });

  test('la respuesta de registro nunca expone el hash de la contraseña', async () => {
    banco.exigeBanco();
    const { json } = await ctx.pide('POST', '/auth/register', { json: registro() });
    const texto = JSON.stringify(json);
    assert.ok(!texto.includes('password_hash'), 'la respuesta incluye password_hash');
    assert.ok(!texto.includes('$2b$') && !texto.includes('$2a$'), 'la respuesta incluye un hash bcrypt');
  });

  test('un vendedor mayor de edad se registra', async () => {
    banco.exigeBanco();
    const { status, json } = await ctx.pide('POST', '/auth/register', {
      json: registro({ rol: 'vendedor', fecha_nacimiento: '1990-05-20' }),
    });
    assert.equal(status, 201, JSON.stringify(json).slice(0, 200));
  });

  test('un vendedor menor de edad es rechazado', async () => {
    banco.exigeBanco();
    const anio = new Date().getFullYear() - 15;
    const { status } = await ctx.pide('POST', '/auth/register', {
      json: registro({ rol: 'vendedor', fecha_nacimiento: anio + '-05-20' }),
    });
    assert.equal(status, 400);
  });

  test('un vendedor sin fecha de nacimiento es rechazado', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('POST', '/auth/register', { json: registro({ rol: 'vendedor' }) });
    assert.equal(status, 400);
  });

  test('no se admite registro publico como administrador', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('POST', '/auth/register', { json: registro({ rol: 'administrador' }) });
    assert.ok(status === 400 || status === 403, 'se esperaba rechazo, llego ' + status);

    const [filas] = await ctx.pool.query(
      "SELECT COUNT(*) n FROM usuarios u INNER JOIN roles r ON r.id=u.rol_id WHERE r.nombre='administrador'");
    assert.equal(Number(filas[0].n), 1, 'solo debe existir el administrador sembrado');
  });

  test('un correo ya registrado se rechaza con 409', async () => {
    banco.exigeBanco();
    const datos = registro();
    await ctx.pide('POST', '/auth/register', { json: datos });
    const { status } = await ctx.pide('POST', '/auth/register', { json: datos });
    assert.equal(status, 409);
  });

  test('sin aceptar los terminos no hay registro', async () => {
    banco.exigeBanco();
    const d = registro(); delete d.acepta_terminos;
    const { status } = await ctx.pide('POST', '/auth/register', { json: d });
    assert.equal(status, 400);
  });

  test('una contraseña corta o una confirmacion distinta se rechazan', async () => {
    banco.exigeBanco();
    const corta = await ctx.pide('POST', '/auth/register', { json: registro({ password: 'abc', confirmPassword: 'abc' }) });
    assert.equal(corta.status, 400, 'menos de 8 caracteres debe rechazarse');

    const dispar = await ctx.pide('POST', '/auth/register', { json: registro({ confirmPassword: 'Otra#Clave1' }) });
    assert.equal(dispar.status, 400, 'la confirmacion distinta debe rechazarse');
  });
});

describe('sesion e identidad', () => {
  test('el inicio de sesion correcto entrega un token utilizable', async () => {
    banco.exigeBanco();
    const { status, json } = await ctx.pide('POST', '/auth/login', {
      json: { correo: 'comprador0@prueba.test', password: CORRECTA },
    });
    assert.equal(status, 200, JSON.stringify(json).slice(0, 200));
    assert.ok(json?.data?.token, 'no llego token');

    const me = await ctx.pide('GET', '/auth/me', { token: json.data.token });
    assert.equal(me.status, 200);
    assert.equal(me.json?.data?.user?.correo, 'comprador0@prueba.test');
  });

  test('/auth/me sin token responde 401', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('GET', '/auth/me');
    assert.equal(status, 401);
  });

  test('/auth/me con un token manipulado responde 401', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('GET', '/auth/me', { token: 'eyJhbGciOiJIUzI1NiJ9.falso.firma' });
    assert.equal(status, 401);
  });

  test('/auth/me no expone el hash de la contraseña', async () => {
    banco.exigeBanco();
    const token = await ctx.entra('comprador0@prueba.test');
    const { json } = await ctx.pide('GET', '/auth/me', { token });
    assert.ok(!JSON.stringify(json).includes('password_hash'), '/auth/me expone password_hash');
  });

  /* FALLO 1 del presupuesto de 5 */
  test('una contraseña incorrecta responde 401 sin revelar si el correo existe', async () => {
    banco.exigeBanco();
    const { status, json } = await ctx.pide('POST', '/auth/login', {
      json: { correo: 'comprador0@prueba.test', password: 'NoEsLaClave1' },
    });
    assert.equal(status, 401);
    assert.match(String(json.message || ''), /Credenciales inv/i,
      'el mensaje no debe distinguir correo inexistente de contraseña erronea');
  });
});

describe('control de rol', () => {
  test('un comprador no alcanza una ruta de administrador', async () => {
    banco.exigeBanco();
    const token = await ctx.entra('comprador0@prueba.test');
    const { status } = await ctx.pide('GET', '/auth/admin-test', { token });
    assert.equal(status, 403);
  });

  test('un administrador si la alcanza', async () => {
    banco.exigeBanco();
    const token = await ctx.entra('admin@prueba.test');
    const { status } = await ctx.pide('GET', '/auth/admin-test', { token });
    assert.equal(status, 200);
  });

  test('sin token, la ruta de administrador responde 401 y no 403', async () => {
    banco.exigeBanco();
    const { status } = await ctx.pide('GET', '/auth/admin-test');
    assert.equal(status, 401, 'la falta de identidad es 401; la falta de permiso es 403');
  });
});

describe('cambio de contraseña', () => {
  /* Consume el FALLO 2 del presupuesto al comprobar la clave antigua. */
  test('cambiar la contraseña invalida las sesiones emitidas antes', async () => {
    banco.exigeBanco();
    const correo = 'comprador1@prueba.test';
    const [r] = await ctx.pool.query('SELECT id FROM usuarios WHERE correo=?', [correo]);
    assert.equal(r.length, 1, 'hace falta un segundo comprador sembrado');

    const tokenViejo = await ctx.entra(correo);
    const nueva = 'Nueva#Clave9';

    const cambio = await ctx.pide('POST', '/auth/change-password', {
      token: tokenViejo,
      json: { passwordActual: CORRECTA, password: nueva, confirmPassword: nueva,
        currentPassword: CORRECTA, newPassword: nueva },
    });
    assert.equal(cambio.status, 200, 'el cambio deberia aceptarse: ' + JSON.stringify(cambio.json).slice(0, 180));

    const [[u]] = await ctx.pool.query('SELECT token_version FROM usuarios WHERE correo=?', [correo]);
    assert.ok(Number(u.token_version) > 0, 'token_version debe incrementarse al cambiar la contraseña');

    const conViejo = await ctx.pide('GET', '/auth/me', { token: tokenViejo });
    assert.equal(conViejo.status, 401, 'el token anterior al cambio debe dejar de servir');

    const vieja = await ctx.pide('POST', '/auth/login', { json: { correo, password: CORRECTA } });
    assert.equal(vieja.status, 401, 'la contraseña antigua ya no debe servir');

    const nuevaSesion = await ctx.pide('POST', '/auth/login', { json: { correo, password: nueva } });
    assert.equal(nuevaSesion.status, 200, 'la contraseña nueva debe servir');
  });
});

/* ─── DEBE IR LA ULTIMA: a partir de aqui el login queda bloqueado ───────── */
describe('limitador de intentos', () => {
  test('tras agotar los intentos fallidos el login responde 429, incluso con la clave correcta', async () => {
    banco.exigeBanco();
    const correo = 'comprador0@prueba.test';

    let bloqueo = null;
    for (let i = 0; i < 10 && bloqueo === null; i++) {
      const r = await ctx.pide('POST', '/auth/login', { json: { correo, password: 'ClaveIncorrecta' + i } });
      if (r.status === 429) bloqueo = { intento: i + 1, json: r.json };
      else assert.equal(r.status, 401, 'antes del bloqueo cada fallo debe ser 401');
    }
    assert.ok(bloqueo, 'el limitador nunca respondio 429 en 10 intentos fallidos');
    assert.match(String(bloqueo.json.message || ''), /Demasiados intentos/i);

    /* El bloqueo es real: ni siquiera la contraseña correcta pasa. */
    const correcta = await ctx.pide('POST', '/auth/login', { json: { correo, password: CORRECTA } });
    assert.equal(correcta.status, 429, 'el bloqueo debe aplicarse tambien a la clave correcta');
  });
});
