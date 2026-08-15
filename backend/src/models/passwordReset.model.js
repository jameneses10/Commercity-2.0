const { pool } = require('../config/database');
async function create({usuario_id,token_hash,codigo_hash,expires_at}){ const [r]=await pool.query('INSERT INTO password_reset_tokens (usuario_id,token_hash,codigo_hash,expires_at) VALUES (?,?,?,?)',[usuario_id,token_hash,codigo_hash,expires_at]); return r.insertId; }
async function findValidForUser(usuario_id){ const [rows]=await pool.query(`SELECT id,usuario_id,token_hash,codigo_hash,expires_at,usado,created_at,used_at FROM password_reset_tokens WHERE usuario_id=? AND usado=FALSE AND expires_at > NOW() ORDER BY id DESC LIMIT 5`,[usuario_id]); return rows; }
async function markUsed(id, conn = pool){ const [result] = await conn.query('UPDATE password_reset_tokens SET usado=TRUE, used_at=NOW() WHERE id=? AND usado=FALSE AND expires_at > NOW()',[id]); return result.affectedRows; }
module.exports={create,findValidForUser,markUsed};
