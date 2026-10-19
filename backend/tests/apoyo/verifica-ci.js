/* Comprueba que la suite se ejecuto entera, no solo que termino bien.
 *
 * `node --test` puede devolver codigo 0 sin haber descubierto un solo fichero:
 * en este proyecto `node --test tests/` llegaba a informar "pass 0". Un exit
 * code verde no demuestra, por tanto, que la red de regresion se haya tendido.
 *
 * Este verificador compara los ficheros *.test.js que hay en disco con los que
 * se ejecutaron de verdad, y exige que no haya fallos reales.
 *
 * La lista de ficheros ejecutados la produce un reporter propio,
 * tests/apoyo/reportero-ficheros.js, que lee el campo `file` de los eventos del
 * corredor. Para eso NO sirve el atributo file= del informe junit: existe en
 * unas plataformas y versiones de Node y en otras no, y en el runner informaba
 * «0 ficheros ejecutados» con 108 pruebas verdes —justo el falso negativo
 * que esta comprobacion debe impedir—. Del informe junit solo se leen los
 * fallos y los `todo`.
 *
 * Ojo con los `todo`: el reporter junit los escribe como <failure>, porque la
 * asercion efectivamente no se cumple, pero los acompaña de
 * <skipped type="todo" message="#NN — ...">. Son hallazgos abiertos declarados
 * a proposito y NO deben tumbar la integracion; contarlos como fallos
 * rechazaria una suite correcta.
 *
 * Deliberadamente no se fija el numero de pruebas ni el de `todo`: ambos
 * cambian de forma legitima al añadir cobertura o al cerrar un hallazgo. Lo
 * innegociable es que no falte ningun fichero y que no falle nada.
 *
 *   node tests/apoyo/verifica-ci.js informe-pruebas.xml ficheros.txt
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const informe = process.argv[2] || 'informe-pruebas.xml';
const listaFicheros = process.argv[3] || 'ficheros.txt';
const dirPruebas = path.join(__dirname, '..');

if (!fs.existsSync(informe)) {
  console.error('No se encontro el informe ' + informe + '. La suite no llego a escribirlo.');
  process.exit(1);
}
const xml = fs.readFileSync(informe, 'utf8');

/* Cada <testcase>, ya venga cerrado en si mismo o con hijos. */
function casos(texto) {
  const fuera = [];
  const re = /<testcase\b[^>]*?(\/>|>)/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    if (m[1] === '/>') { fuera.push(m[0]); continue; }
    const fin = texto.indexOf('</testcase>', m.index);
    fuera.push(texto.slice(m.index, fin === -1 ? m.index + m[0].length : fin + 11));
  }
  return fuera;
}

const todos = casos(xml);
const esTodo = (c) => /<skipped\b[^>]*type="todo"/.test(c);
const tieneFallo = (c) => /<failure\b/.test(c) || /<error\b/.test(c);

const marcados = todos.filter(esTodo);
const fallidos = todos.filter((c) => tieneFallo(c) && !esTodo(c));

const nombre = (c) => (c.match(/<testcase\b[^>]*\bname="([^"]*)"/) || [, '(sin nombre)'])[1];
const motivoTodo = (c) => (c.match(/<skipped\b[^>]*type="todo"[^>]*\bmessage="([^"]*)"/) || [, ''])[1];

const enDisco = fs.readdirSync(dirPruebas).filter((f) => f.endsWith('.test.js')).sort();

/* Los ficheros ejecutados los declara nuestro propio reporter. El atributo
   file= del informe junit NO sirve: existe en unas plataformas y versiones de
   Node y en otras no. En la maquina de desarrollo funcionaba y en el runner
   daba «0 ficheros» con 108 pruebas verdes, que es justo el falso negativo
   que esta comprobacion debe impedir. */
if (!fs.existsSync(listaFicheros)) {
  console.error('No se encontro ' + listaFicheros + ', que declara los ficheros ejecutados.');
  process.exit(1);
}
const ejecutados = [...new Set(
  fs.readFileSync(listaFicheros, 'utf8').split('\n')
    .filter((l) => l.startsWith('FICHERO\t'))
    .map((l) => l.slice(8).trim().replace(/\\/g, '/').split('/').pop())
    .filter(Boolean)
)].sort();

const faltan = enDisco.filter((f) => !ejecutados.includes(f));
const sobran = ejecutados.filter((f) => !enDisco.includes(f));

console.log('Ficheros en disco  : ' + enDisco.length + '  [' + enDisco.join(', ') + ']');
console.log('Ficheros ejecutados: ' + ejecutados.length + '  [' + ejecutados.join(', ') + ']');
console.log('Pruebas ejecutadas : ' + todos.length);
console.log('Fallos reales      : ' + fallidos.length);
console.log('Hallazgos abiertos declarados como todo: ' + marcados.length);
for (const c of marcados) {
  console.log('  · ' + motivoTodo(c));
}

const problemas = [];
if (enDisco.length === 0) problemas.push('no hay ningun fichero *.test.js en ' + dirPruebas);
if (faltan.length) problemas.push('no se ejecutaron: ' + faltan.join(', '));
if (sobran.length) problemas.push('se ejecutaron ficheros que no estan en disco: ' + sobran.join(', '));
if (todos.length === 0) problemas.push('el informe no registra ninguna prueba');
for (const c of fallidos) problemas.push('fallo: ' + nombre(c));

if (problemas.length) {
  console.error('\nLA VERIFICACION NO PASA:');
  for (const p of problemas) console.error('  - ' + p);
  process.exit(1);
}

console.log('\nVerificacion correcta: se descubrieron y ejecutaron los ' + enDisco.length +
  ' ficheros, con ' + (todos.length - marcados.length) + ' pruebas en verde y ningun fallo real.');
