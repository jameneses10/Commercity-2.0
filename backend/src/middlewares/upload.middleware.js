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
module.exports = { storeUpload, productUpload, profileUpload, chatUpload, returnUpload, multerErrorHandler, mapFile };
