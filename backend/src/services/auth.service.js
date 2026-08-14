const { pool } = require('../config/database');
const { findRoleByName } = require('../models/role.model');
const { createUser, findUserByEmail, findUserById, sanitizeUser, updateLastLogin } = require('../models/user.model');
const profileModel = require('../models/profile.model');
const termsService = require('./terms.service');
const passwordResetService = require('./passwordReset.service');
const accountService = require('./account.service');
const { hashPassword, comparePassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');
const { isAdult } = require('../utils/age');

const PUBLIC_REGISTER_ROLES = ['comprador', 'vendedor'];
function err(message,statusCode){ const e=new Error(message); e.statusCode=statusCode; return e; }

async function registerUser({ nombre, correo, password, confirmPassword, rol, telefono = null, fecha_nacimiento = null, acepta_terminos, terms_accepted, terminos_version }, meta={}) {
  const normalizedEmail = correo.toLowerCase().trim();
  const normalizedRole = rol.toLowerCase().trim();
  const accepted = acepta_terminos === true || acepta_terminos === 'true' || terms_accepted === true || terms_accepted === 'true';
  const termsVersion = termsService.normalizeVersion(terminos_version);
  if (!accepted) throw err('Debe aceptar los términos y condiciones para registrarse.',400);
  if (!PUBLIC_REGISTER_ROLES.includes(normalizedRole)) throw err('El rol solicitado no está permitido para registro público.',403);
  if (normalizedRole === 'vendedor') {
    if (!fecha_nacimiento) throw err('La fecha de nacimiento es obligatoria para registrarse como vendedor.',400);
    if (!isAdult(fecha_nacimiento)) throw err('Para registrarse como vendedor debe ser mayor de 18 años.',400);
  }
  if (password !== confirmPassword) throw err('La contraseña y su confirmación no coinciden.',400);
  const existingUser = await findUserByEmail(normalizedEmail);
  if (existingUser) throw err('El correo electrónico ya está registrado.',409);
  const role = await findRoleByName(normalizedRole);
  if (!role) throw err('Rol no configurado en base de datos.',500);
  const passwordHash = await hashPassword(password);
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [result]=await conn.query(`INSERT INTO usuarios (rol_id,nombre,correo,password_hash,telefono,fecha_nacimiento,estado,acepta_terminos,terminos_version,terminos_aceptados_at) VALUES (?,?,?,?,?,?,'activo',TRUE,?,NOW())`,[role.id,nombre.trim(),normalizedEmail,passwordHash,telefono,fecha_nacimiento||null,termsVersion]);
    await profileModel.ensureProfile(result.insertId, conn);
    await termsService.record(conn,{usuario_id:result.insertId,version:termsVersion,ip:meta.ip,user_agent:meta.userAgent});
    await conn.commit();
    const user=await findUserById(result.insertId);
    return sanitizeUser(user);
  }catch(e){ await conn.rollback(); throw e; } finally { conn.release(); }
}

async function reactivateUser({ correo, password }, meta = {}) {
  const normalizedEmail = correo.toLowerCase().trim();
  const user = await findUserByEmail(normalizedEmail);
  const invalidCredentialsError = err('Credenciales inválidas.', 401);
  if (!user) throw invalidCredentialsError;
  const passwordIsValid = await comparePassword(password, user.password_hash);
  if (!passwordIsValid) throw invalidCredentialsError;

  return accountService.reactivate(user.id, meta);
}

async function loginUser({ correo, password }) {
  const normalizedEmail = correo.toLowerCase().trim();
  const user = await findUserByEmail(normalizedEmail);
  const invalidCredentialsError = err('Credenciales inválidas.',401);
  if (!user) throw invalidCredentialsError;
  if (user.estado !== 'activo' || user.deleted_at) throw err('Usuario no activo.',403);
  const passwordIsValid = await comparePassword(password, user.password_hash);
  if (!passwordIsValid) throw invalidCredentialsError;
  await updateLastLogin(user.id);
  const fresh = await findUserById(user.id);
  const safeUser = sanitizeUser(fresh || user);
  const token = signToken(fresh || user);
  return { token, user: safeUser };
}

async function getAuthenticatedUser(userId) {
  const user = await findUserById(userId);
  if (!user) throw err('Usuario autenticado no encontrado.',401);
  return sanitizeUser(user);
}

module.exports = {
  registerUser,
  loginUser,
  getAuthenticatedUser,
  forgotPassword: passwordResetService.forgotPassword,
  resetPassword: passwordResetService.resetPassword,
  changePassword: accountService.changePassword,
  reactivateUser,
};
