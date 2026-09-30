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
