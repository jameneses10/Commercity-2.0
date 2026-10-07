const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CHAT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx']);
const CHAT_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const BLOCKED_EXTENSIONS = new Set(['.exe', '.sh', '.bat', '.php', '.js', '.html']);

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function safeFilename(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  return `${Date.now()}_${crypto.randomBytes(12).toString('hex')}${ext}`;
}
function makeStorage(folder) {
  const dir = path.join(UPLOAD_ROOT, folder);
  ensureDir(dir);
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => cb(null, safeFilename(file)),
  });
}
function fileFilter({ allowedExt, allowedMime }) {
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) return cb(new Error('Tipo de archivo no permitido por seguridad.'));
    if (!allowedExt.has(ext) || !allowedMime.has(file.mimetype)) return cb(new Error('Formato de archivo no permitido.'));
    return cb(null, true);
  };
}
function mapFile(file, folder) {
  if (!file) return null;
  return {
    url: `/uploads/${folder}/${file.filename}`,
    nombre_original: file.originalname,
    mime_type: file.mimetype,
    size_bytes: file.size,
    path: file.path,
  };
}
// RF-291: limpieza best-effort de los archivos que Multer YA escribio cuando la
// peticion falla despues del almacenamiento (conversacion inexistente, usuario no
// participante, validacion posterior o transaccion fallida). Se usan unicamente
// las rutas generadas por Multer, nunca un nombre suministrado por el cliente, y
// un fallo al borrar se ignora para no ocultar el error original.
function cleanupFiles(files) {
  const list = Array.isArray(files) ? files : (files ? [files] : []);
  let removed = 0;
  for (const file of list) {
    const target = file && typeof file.path === 'string' ? file.path : null;
    if (!target) continue;
    if (path.relative(UPLOAD_ROOT, target).startsWith('..')) continue;
    try { fs.unlinkSync(target); removed += 1; }
    catch (unlinkError) {
      if (unlinkError.code !== 'ENOENT') console.warn('No fue posible eliminar un archivo huerfano.', unlinkError.message);
    }
  }
  return removed;
}

function multerErrorHandler(err, _req, res, next) {
  if (!err) return next();
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el tamaño máximo permitido.' : err.message;
  return res.status(400).json({ ok: false, message, errors: [{ message }] });
}
const storeUpload = multer({ storage: makeStorage('stores'), fileFilter: fileFilter({ allowedExt: IMAGE_EXTENSIONS, allowedMime: IMAGE_MIMES }), limits: { fileSize: 5 * 1024 * 1024 } });
const productUpload = multer({ storage: makeStorage('products'), fileFilter: fileFilter({ allowedExt: IMAGE_EXTENSIONS, allowedMime: IMAGE_MIMES }), limits: { fileSize: 5 * 1024 * 1024, files: 6 } });
const profileUpload = multer({ storage: makeStorage('profiles'), fileFilter: fileFilter({ allowedExt: IMAGE_EXTENSIONS, allowedMime: IMAGE_MIMES }), limits: { fileSize: 3 * 1024 * 1024 } });
const chatUpload = multer({ storage: makeStorage('chat'), fileFilter: fileFilter({ allowedExt: CHAT_EXTENSIONS, allowedMime: CHAT_MIMES }), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
const returnUpload = multer({ storage: makeStorage('returns'), fileFilter: fileFilter({ allowedExt: IMAGE_EXTENSIONS, allowedMime: IMAGE_MIMES }), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
/* RNF-006: traduce el url_archivo ALMACENADO EN BD a una ruta fisica, para los
   adjuntos privados que ya no se sirven por express.static. El valor de entrada
   procede siempre de una fila de BD previamente autorizada, nunca del cliente,
   y aun asi se valida de forma defensiva: carpeta exacta esperada, basename sin
   componentes de ruta, y la ruta final confinada dentro de UPLOAD_ROOT/<folder>.
   Devuelve null si algo no cuadra o el fichero no existe: quien llama responde
   404 y no revela la diferencia entre "no autorizado" y "no esta en disco". */
const PRIVATE_FOLDERS = new Set(['chat', 'returns']);
function resolveStoredFile(folder, storedUrl) {
  if (!PRIVATE_FOLDERS.has(folder)) return null;
  if (typeof storedUrl !== 'string' || !storedUrl) return null;
  const esperado = `/uploads/${folder}/`;
  if (!storedUrl.startsWith(esperado)) return null;
  const nombre = storedUrl.slice(esperado.length);
  // Un basename limpio: sin separadores, sin "..", sin rutas absolutas.
  if (!nombre || nombre !== path.basename(nombre) || nombre === '.' || nombre === '..') return null;
  const dir = path.join(UPLOAD_ROOT, folder);
  const destino = path.resolve(dir, nombre);
  const rel = path.relative(dir, destino);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(destino) || !fs.statSync(destino).isFile()) return null;
  return destino;
}

/* RNF-009: cuarentena transaccional de la foto de perfil al anonimizar.
   Poner foto_url a NULL no anonimiza nada si el fichero sigue en
   /uploads/profiles, que es publico: medido, la URL anterior seguia devolviendo
   200 sin autenticacion.
   Tampoco vale un unlink() antes del commit: si la transaccion revierte, la
   cuenta sigue activa pero su foto desaparecio. Por eso se mueve con rename --
   atomico dentro del mismo sistema de ficheros, sin ventana en la que siga
   publicada -- a una carpeta NO publica, y solo se borra tras el commit.
   La ruta de origen procede de la BD, nunca del cliente, y se valida igual que
   en resolveStoredFile: carpeta profiles exacta, basename limpio y
   confinamiento dentro de UPLOAD_ROOT. */
const QUARANTINE_DIR = path.join(UPLOAD_ROOT, '.quarantine');
function quarantineProfilePhoto(storedUrl) {
  const prefijo = '/uploads/profiles/';
  if (typeof storedUrl !== 'string' || !storedUrl.startsWith(prefijo)) return null;
  const nombre = storedUrl.slice(prefijo.length);
  if (!nombre || nombre !== path.basename(nombre) || nombre === '.' || nombre === '..') return null;
  const dir = path.join(UPLOAD_ROOT, 'profiles');
  const origen = path.resolve(dir, nombre);
  const rel = path.relative(dir, origen);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  /* Una foto ya inexistente no debe impedir anonimizar la cuenta. Se exige
     ademas que sea un fichero, igual que resolveStoredFile: un directorio en
     esa ruta se renombraria sin error y luego no se podria borrar, dejando
     residuo en la cuarentena. */
  let st = null;
  try { st = fs.statSync(origen); } catch (e) { return null; }
  if (!st.isFile()) return null;
  ensureDir(QUARANTINE_DIR);
  const destino = path.join(QUARANTINE_DIR, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}_${nombre}`);
  /* Fail-closed. Devolver null cuando el rename falla confundia dos casos muy
     distintos: "la foto ya no existe", donde se puede continuar, y "la foto
     existe pero no se pudo retirar", donde NO se puede. En el segundo caso la
     transaccion seguia, confirmaba, y quedaba la cuenta anonimizada con su foto
     todavia publica en /uploads/profiles. Ahora se propaga el fallo para que
     resolveDeleteRequest revierta y la cuenta NO se anonimice. */
  try { fs.renameSync(origen, destino); }
  catch (e) {
    const error = new Error('No fue posible retirar la foto de perfil antes de anonimizar.');
    error.statusCode = 500;
    error.cause = e;
    throw error;
  }
  return { origen, destino };
}
function discardQuarantined(ticket) {
  if (!ticket) return false;
  try { fs.unlinkSync(ticket.destino); return true; }
  catch (e) { if (e.code !== 'ENOENT') console.warn('No fue posible borrar la foto en cuarentena.', e.message); return false; }
}
function restoreQuarantined(ticket) {
  if (!ticket) return false;
  try { fs.renameSync(ticket.destino, ticket.origen); return true; }
  catch (e) { console.warn('No fue posible restaurar la foto en cuarentena.', e.message); return false; }
}

module.exports = { storeUpload, productUpload, profileUpload, chatUpload, returnUpload, multerErrorHandler, mapFile , cleanupFiles, resolveStoredFile, quarantineProfilePhoto, discardQuarantined, restoreQuarantined };
