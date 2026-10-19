/* Reporter minimo cuyo unico cometido es declarar que ficheros se ejecutaron.
 *
 * Por que existe: el verificador de CI necesita demostrar que `node --test`
 * descubrio todos los *.test.js del directorio, porque un exit code 0 no lo
 * prueba —en este proyecto `node --test tests/` llego a informar «pass 0»—.
 *
 * El primer intento leyo el atributo `file=` del reporter junit. Funcionaba en
 * la maquina de desarrollo y **no en el runner**: ese atributo no aparece en
 * todas las plataformas ni versiones de Node, y la comprobacion informaba
 * «ficheros ejecutados: 0» con 108 pruebas verdes. Los eventos del corredor,
 * en cambio, llevan `file` de forma estable, asi que se leen directamente.
 *
 * Emite una linea por fichero distinto:
 *
 *   FICHERO<TAB>/ruta/absoluta/al/fichero.test.js
 */
'use strict';

module.exports = async function* reporteroFicheros(origen) {
  const vistos = new Set();
  for await (const evento of origen) {
    const f = evento?.data?.file;
    if (f && !vistos.has(f)) {
      vistos.add(f);
      yield 'FICHERO\t' + f + '\n';
    }
  }
};
