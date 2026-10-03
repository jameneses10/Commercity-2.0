/* RF-297: configuracion global del Play CDN de Tailwind v3.

   El proyecto tiene dos mecanismos de tema que hasta ahora vivian separados:
   styles.css cambia variables CSS bajo body.cc-night, y las utilities dark:* de
   Tailwind dependian de prefers-color-scheme porque no existia configuracion
   alguna. Con darkMode en modo clase, dark:* pasa a responder a la clase .dark
   del elemento raiz, que applyTheme() sincroniza con cc-night.

   Debe cargarse como script clasico INMEDIATAMENTE despues del CDN: los scripts
   clasicos se ejecutan en orden de documento, asi que esta asignacion ocurre
   despues de que el CDN define window.tailwind y antes de que el parser siga.
   No sirve hacerlo desde main.js, que es un modulo diferido y se ejecuta cuando
   el CDN ya genero su hoja de estilos.

   No se migra a Tailwind 4, no se anaden dependencias y no se reescribe ninguna
   utility dark:* existente. */
window.tailwind = window.tailwind || {};
window.tailwind.config = { darkMode: 'class' };
/* RF-302: bootstrap del tema antes del primer paint.

   Este fichero ya se ejecuta como script clasico en el <head> de las 55 vistas,
   antes de css/styles.css y antes de que exista <body> (verificado 55/55). Es,
   por tanto, el unico punto compartido donde se puede fijar el tema sin tocar
   cada HTML.

   Antes de esto la pagina pintaba en claro durante ~122 ms y html.dark no
   aparecia hasta ~396 ms, porque el tema solo se aplicaba desde main.js, que es
   un modulo diferido. Eso es un parpadeo en cada carga con el tema oscuro.

   Aqui solo se refleja el ultimo tema local conocido: no se duplica logica de
   persistencia, no se llama al backend y no se hace PATCH. La verdad persistente
   del usuario autenticado sigue siendo usuarios.modo_oscuro (RF-298), que
   syncThemeFromUser aplica despues del login. */
(function () {
  var mode = 'day';
  try {
    // localStorage puede lanzar en modo privado o con cookies bloqueadas.
    mode = window.localStorage.getItem('cc_theme') === 'night' ? 'night' : 'day';
  } catch (e) { mode = 'day'; }
  var esNoche = mode === 'night';
  var root = document.documentElement;
  // .dark se puede fijar ya: <html> existe mientras el parser esta en el <head>.
  root.classList.toggle('dark', esNoche);
  if (document.body) {
    document.body.classList.toggle('cc-night', esNoche);
    return;
  }
  // <body> aun no existe: se espera a que el parser lo cree y se marca en cuanto
  // aparece, antes de que llegue a pintarse. El observer se desconecta solo.
  if (typeof MutationObserver !== 'function') return;
  var obs = new MutationObserver(function () {
    if (!document.body) return;
    document.body.classList.toggle('cc-night', esNoche);
    obs.disconnect();
  });
  obs.observe(root, { childList: true, subtree: true });
})();
