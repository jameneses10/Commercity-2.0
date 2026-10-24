const { pool } = require('../config/database');
/* #107: `JSON.stringify(d).slice(0,2000)` recortaba el texto YA SERIALIZADO,
   de modo que el corte podia caer dentro de una cadena y dejar el documento
   sin su comilla de cierre. `logs_acciones.detalle` es de tipo JSON, asi que
   MySQL lo rechazaba con ER_INVALID_JSON_TEXT y, por estar la escritura
   dentro de la transaccion de quien audita, tumbaba la operacion entera.
   Medido: un vendedor que respondia una devolucion con 1925 caracteres
   -el validador admite 2000- recibia un 500 y la devolucion no se guardaba.

   Ahora se recorta ANTES de serializar, y por puntos de codigo, para no
   partir un par suplente por la mitad. El tamano se busca por biseccion
   sobre el texto ya serializado, porque el escapado lo altera: una cadena de
   comillas ocupa el doble. Si ni el esqueleto cabe, se guarda un documento
   de reemplazo; y si el valor no es serializable -un ciclo, un BigInt- se
   guarda la causa en vez de dejar que la excepcion suba.
   La funcion no lanza y, cuando devuelve texto, ese texto es JSON valido.

   El limite se mide en BYTES UTF-8, no en unidades UTF-16. `'漢'.length` es
   1 y ocupa 3 bytes; un emoji mide 2 y ocupa 4. Contar caracteres dejaria
   que un detalle en CJK triplicase el tamano real del documento guardado,
   asi que la cota seria una cota solo para texto ASCII. */
const LIMITE_DETALLE = 2000;
const CLAVE_RECORTE = '_recortado';
const bytes = (texto) => Buffer.byteLength(texto, 'utf8');

/* Devuelve el motivo, nunca el mensaje de la excepcion: el de una referencia
   circular enumera el camino de propiedades del objeto auditado. */
function serializa(valor){
  try {
    const t = JSON.stringify(valor);
    /* `undefined` para un simbolo, una funcion o `undefined` mismo: no es un
       fallo, sencillamente no hay documento que guardar. */
    return { t: t === undefined ? null : t };
  } catch (e) { return { t: null, error: e?.name || 'Error' }; }
}

/* Un suplente sin pareja es JSON valido para `JSON.parse` -se escapa como
   \udXXX- pero MySQL lo rechaza igualmente al guardarlo en una columna JSON.
   Medido: sin esta limpieza, un detalle que ya traia uno de entrada seguia
   dando ER_INVALID_JSON_TEXT aunque el documento estuviera bien formado.
   De ahi que el oraculo de las pruebas no pueda ser solo `JSON.parse`. */
const SUPLENTE_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function limpia(texto){ return texto.replace(SUPLENTE_SUELTO, '\uFFFD'); }

/* Sobre el texto YA SERIALIZADO hay que buscar otra cosa. `JSON.stringify`
   convierte el suplente suelto en la secuencia ASCII \udXXX, de seis
   caracteres, donde el patron de arriba no encuentra nada: buscandolo alli,
   un detalle corto con un suplente entraba por el camino rapido sin pasar
   nunca por `limpia`. Medido contra 1e348de: {t:'\\uD83D'} devolvia un
   documento que `JSON.parse` aceptaba y MySQL rechazaba.
   Un par valido no se escapa, asi que no aparece aqui. Un `\\` literal
   seguido del texto "ud8.." si da un falso positivo; es inofensivo, porque
   solo encamina el detalle por la normalizacion, que no cambia nada mas. */
const SUPLENTE_ESCAPADO = /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/;

/* Los objetos reconstruidos se crean SIN PROTOTIPO. Sobre un `{}` corriente,
   `salida['__proto__'] = v` dispara el `setter` heredado de
   `Object.prototype` y no crea ninguna propiedad: la clave desaparecia del
   registro sin avisar. Medido contra 4db075a en los dos caminos, el de
   normalizacion y el de recorte. `JSON.parse` si la crea como propiedad
   propia, de modo que un detalle puede traerla legitimamente, y
   `JSON.stringify` serializa igual un objeto sin prototipo. */
function objetoLlano(){ return Object.create(null); }

/* Dos claves distintas pueden volverse la misma al sustituir el suplente
   suelto por U+FFFD. Se conserva la primera y se declara la colision, en
   lugar de dejar que la segunda pise a la primera en silencio. */
function pon(salida, clave, valor, avisos){
  if (Object.prototype.hasOwnProperty.call(salida, clave)) {
    avisos.add('claves_colisionadas');
    return;
  }
  salida[clave] = valor;
}

/* Limpia sin recortar. El camino rapido la necesita aparte de `acota`:
   aquel aplica ademas las cotas de anchura y profundidad, que no vienen al
   caso cuando el documento ya cabe.
   Se le pasa SIEMPRE el valor plano, nunca el detalle original: ver la nota
   de `safeDetail`. */
function normaliza(valor, avisos){
  if (typeof valor === 'string') return limpia(valor);
  if (valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map((v) => normaliza(v, avisos));
  const salida = objetoLlano();
  for (const k of Object.keys(valor)) pon(salida, limpia(k), normaliza(valor[k], avisos), avisos);
  return salida;
}

/* Corta por puntos de codigo: `slice` sobre la cadena partiria un emoji o
   cualquier caracter fuera del plano basico en dos mitades invalidas. */
function recorta(texto, maximo){
  const puntos = Array.from(limpia(texto));
  return puntos.length <= maximo ? puntos.join('') : puntos.slice(0, maximo).join('') + '…';
}

/* Copia acotando cada cadena. No sigue mas de `PROFUNDIDAD` niveles ni mas
   de `ANCHURA` elementos: un detalle patologico no debe costar mas que la
   operacion que audita.
   Igual que `normaliza`, recibe el valor plano y no el detalle original. */
const PROFUNDIDAD = 6;
const ANCHURA = 50;
function acota(valor, maximo, nivel, recortadas){
  if (typeof valor === 'string') {
    if (Array.from(valor).length > maximo) recortadas.add('cadena');
    return recorta(valor, maximo);
  }
  if (valor === null || typeof valor !== 'object') return valor;
  if (nivel >= PROFUNDIDAD) { recortadas.add('profundidad'); return '[…]'; }
  if (Array.isArray(valor)) {
    const corto = valor.slice(0, ANCHURA).map((v) => acota(v, maximo, nivel + 1, recortadas));
    if (valor.length > ANCHURA) { recortadas.add('elementos'); corto.push('…'); }
    return corto;
  }
  const salida = objetoLlano();
  const claves = Object.keys(valor).slice(0, ANCHURA);
  if (Object.keys(valor).length > claves.length) recortadas.add('claves');
  for (const k of claves) pon(salida, limpia(k), acota(valor[k], maximo, nivel + 1, recortadas), recortadas);
  return salida;
}

/* Documento de reemplazo. Dice que falta informacion y por que, sin
   esconderlo y sin incluir ningun valor del detalle original. */
function reemplazo(motivo, extra){
  return JSON.stringify({ [CLAVE_RECORTE]: true, _motivo: motivo, ...extra });
}

function safeDetail(d){
  if (!d) return null;
  const entero = serializa(d);
  if (entero.error !== undefined) {
    return reemplazo('detalle no serializable', { _causa: entero.error });
  }
  if (entero.t === null) return null;          /* p.ej. una funcion suelta */

  /* Camino rapido solo si ademas no hay nada que limpiar. Se mira la forma
     escapada porque es la que queda tras serializar. */
  const sucio = SUPLENTE_ESCAPADO.test(entero.t);
  const cabe = bytes(entero.t) <= LIMITE_DETALLE;
  if (cabe && !sucio) return entero.t;

  /* A partir de aqui se trabaja sobre el valor RECONSTRUIDO de la cadena ya
     serializada, nunca sobre el detalle original. Es JSON puro -sin `Date`,
     sin `toJSON`, sin ciclos- y es exactamente lo que se iba a guardar.
     Recorrer el original hacia dos daños, los dos medidos contra 5d72e24:
       · una fecha desaparecia. `Object.keys(new Date())` esta vacio, asi que
         la copia quedaba en {} en vez de su cadena ISO. Pasaba tanto al
         normalizar como al recortar.
       · un objeto con ciclo y `toJSON` lo resolvia `JSON.stringify`, pero el
         recorrido volvia a entrar en el ciclo: RangeError, justo la clase de
         excepcion que este serializador existe para no provocar.
     `JSON.parse` aqui no puede fallar: el texto lo produjo `JSON.stringify`.
     Aun asi se protege, porque la funcion promete no lanzar. */
  let plano;
  try { plano = JSON.parse(entero.t); }
  catch (e) { return reemplazo('detalle no releible', { _causa: e?.name || 'Error' }); }

  /* Anade al documento la lista de lo que se perdio por el camino. Se usa
     tanto tras normalizar como tras recortar. El esparcido conserva
     `__proto__` como propiedad propia; la asignacion, no. */
  const conMarca = (texto, avisos) => {
    const obj = JSON.parse(texto);
    const marcado = (obj !== null && typeof obj === 'object' && !Array.isArray(obj))
      ? { ...obj, [CLAVE_RECORTE]: [...avisos] }
      : { [CLAVE_RECORTE]: [...avisos], _valor: obj };
    return JSON.stringify(marcado);
  };

  if (cabe) {
    const avisos = new Set();
    const limpio = serializa(normaliza(plano, avisos));
    if (limpio.t) {
      const texto = avisos.size ? conMarca(limpio.t, avisos) : limpio.t;
      if (bytes(texto) <= LIMITE_DETALLE) return texto;
    }
    /* Si con la marca ya no cabe, sigue por la biseccion: alli se recorta y
       se vuelve a marcar. Callar el aviso para que quepa no es opcion. */
  }

  /* Biseccion sobre la longitud permitida a cada cadena -en puntos de
     codigo- buscando la mayor que deje el documento entero dentro del
     limite de bytes. El escapado y el multibyte rompen cualquier relacion
     directa entre ambas magnitudes, de ahi que se busque en vez de calcular. */
  let bajo = 0;
  let alto = LIMITE_DETALLE;
  let mejor = null;
  while (bajo <= alto) {
    const medio = Math.floor((bajo + alto) / 2);
    const recortadas = new Set();
    const salida = serializa(acota(plano, medio, 0, recortadas));
    if (salida.t && bytes(salida.t) <= LIMITE_DETALLE) { mejor = { texto: salida.t, recortadas }; bajo = medio + 1; }
    else alto = medio - 1;
  }
  if (!mejor) return reemplazo('detalle demasiado grande', { _bytes_originales: bytes(entero.t) });

  /* La marca va fuera de la biseccion, asi que hay que reservarle sitio: si
     al anadirla el documento se pasa, se vuelve a acotar con menos margen. */
  let salida = conMarca(mejor.texto, mejor.recortadas);
  let margen = 0;
  while (bytes(salida) > LIMITE_DETALLE && margen < LIMITE_DETALLE) {
    margen += Math.max(1, Math.ceil((bytes(salida) - LIMITE_DETALLE) / 2));
    const recortadas = new Set();
    const acotado = serializa(acota(plano, Math.max(0, LIMITE_DETALLE - margen), 0, recortadas));
    if (!acotado.t) break;
    salida = conMarca(acotado.t, recortadas);
  }
  return bytes(salida) <= LIMITE_DETALLE ? salida
    : reemplazo('detalle demasiado grande', { _bytes_originales: bytes(entero.t) });
}
async function create(conn,{usuario_id=null,accion,entidad,entidad_id=null,detalle=null,ip=null}){ const db=conn||pool; await db.query('INSERT INTO logs_acciones (usuario_id,accion,entidad,entidad_id,detalle,ip) VALUES (?,?,?,?,?,?)',[usuario_id,accion,entidad,entidad_id,safeDetail(detalle),ip]); }
function logDay(fecha){ const [y,mo,d]=String(fecha).split('-').map(Number); const next=new Date(Date.UTC(y,mo-1,d+1)).toISOString().slice(0,10); return [`${fecha} 00:00:00`, `${next} 00:00:00`]; }
// RF-284: consulta por fecha, usuario, accion y entidad afectada. Todos los valores
// van como parametros ligados; solo se concatenan fragmentos de predicado fijos.
async function list({limit,offset,fecha,usuario_id,accion,entidad,entidad_id}={}){
 const where=[]; const params=[];
 if(fecha!==undefined){ const [from,to]=logDay(fecha); where.push('l.created_at >= ? AND l.created_at < ?'); params.push(from,to); }
 if(usuario_id!==undefined){ where.push('l.usuario_id = ?'); params.push(usuario_id); }
 if(accion!==undefined){ where.push('l.accion = ?'); params.push(accion); }
 if(entidad!==undefined){ where.push('l.entidad = ?'); params.push(entidad); }
 if(entidad_id!==undefined){ where.push('l.entidad_id = ?'); params.push(entidad_id); }
 params.push(limit,offset);
 const [r]=await pool.query(`SELECT l.*, u.nombre AS usuario_nombre, u.correo AS usuario_correo FROM logs_acciones l LEFT JOIN usuarios u ON u.id = l.usuario_id ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,params);
 return r;
}
module.exports={safeDetail,create,list};
