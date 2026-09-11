const { pool } = require('../config/database');
const reviewModel=require('../models/review.model');
function level(avg,total){ if(!total) return 'regular'; if(avg>=4.5) return 'platino'; if(avg>=4.0) return 'oro'; return 'regular'; }
async function recalcProduct(productId, conn = pool){ const s=await reviewModel.productStats(productId, conn); await conn.query('UPDATE productos SET calificacion_promedio=?, total_resenas=? WHERE id=?',[s.promedio.toFixed(2),s.total,productId]); return s; }
async function recalcStore(storeId, conn = pool){ const s=await reviewModel.storeStats(storeId, conn); await conn.query('UPDATE tiendas SET reputacion_promedio=?, nivel_reputacion=? WHERE id=?',[s.promedio.toFixed(2),level(s.promedio,s.total),storeId]); return {...s,nivel_reputacion:level(s.promedio,s.total)}; }
async function getStoreReputation(storeId){ const s=await reviewModel.storeStats(storeId); const [[t]]=await pool.query('SELECT reputacion_promedio,nivel_reputacion FROM tiendas WHERE id=?',[storeId]); return {reputacion_promedio:t?Number(t.reputacion_promedio):0,nivel_reputacion:t?t.nivel_reputacion:'regular',total_resenas:s.total,total_productos_calificados:s.productos}; }
module.exports={recalcProduct,recalcStore,getStoreReputation};
