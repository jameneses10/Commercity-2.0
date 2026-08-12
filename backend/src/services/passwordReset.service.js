const crypto=require('crypto');
const env=require('../config/env');
const resetModel=require('../models/passwordReset.model');
const { findUserByEmail, updatePassword }=require('../models/user.model');
const { hashPassword }=require('../utils/password');
function err(m,s){const e=new Error(m); e.statusCode=s; return e;}
function sha(v){return crypto.createHash('sha256').update(String(v)).digest('hex');}
function code(){return String(crypto.randomInt(100000,999999));}
function maskEmail(email) {
  if (!email) return '';
  const parts = String(email).split('@');
  if (parts.length !== 2) return email;
  const local = parts[0];
  const maskedLocal = local.length > 1 ? local[0] + '*'.repeat(local.length - 1) : local;
  return `${maskedLocal}@${parts[1]}`;
}
async function forgotPassword({correo}){
 const normalized=String(correo||'').toLowerCase().trim();
 const generic={message:'Si el correo existe y está activo, se generó un código temporal para restablecer la contraseña.'};
 const user=await findUserByEmail(normalized);
 if(!user || user.estado!=='activo') return generic;
 const plainToken=crypto.randomBytes(32).toString('hex'); const plainCode=code();
 const expiresAt=new Date(Date.now()+15*60*1000);
 await resetModel.create({usuario_id:user.id,token_hash:sha(plainToken),codigo_hash:sha(plainCode),expires_at:expiresAt});
 if(env.nodeEnv==='development') {
   console.log(`\n[DEV PASSWORD RESET]\ncorreo = ${maskEmail(normalized)}\ncodigo = ${plainCode}\nexpira = 15 minutos\n`);
 }
 return generic;
}
async function resetPassword({correo,codigo,token,password,confirmPassword}){
 if(password!==confirmPassword) throw err('La contraseña y su confirmación no coinciden.',400);
 if(!codigo && !token) throw err('Código o token requerido.',400);
 const user=await findUserByEmail(String(correo||'').toLowerCase().trim());
 if(!user || user.estado!=='activo') throw err('Código o token inválido.',400);
 const candidates=await resetModel.findValidForUser(user.id); const incoming=sha(codigo||token);
 const found=candidates.find(r => r.codigo_hash===incoming || r.token_hash===incoming);
 if(!found) throw err('Código o token inválido o expirado.',400);
 const hash=await hashPassword(password);
 await updatePassword(user.id,hash); await resetModel.markUsed(found.id);
 return {changed:true};
}
module.exports={forgotPassword,resetPassword};
