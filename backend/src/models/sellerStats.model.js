const { pool } = require('../config/database');
const PERIOD_SQL=Object.freeze({
 daily:'DATE(c.created_at)',
 weekly:'DATE_SUB(DATE(c.created_at), INTERVAL WEEKDAY(c.created_at) DAY)',
 monthly:'DATE_SUB(DATE(c.created_at), INTERVAL (DAYOFMONTH(c.created_at) - 1) DAY)'
});
async function stats(tiendaId){
 const [[products]]=await pool.query(`SELECT COUNT(*) total_productos, SUM(estado='activo') productos_activos, SUM(estado='agotado' OR stock=0) productos_agotados FROM productos WHERE tienda_id=? AND estado <> 'eliminado'`,[tiendaId]);
 const [[sales]]=await pool.query(`SELECT COUNT(DISTINCT p.id) total_pedidos, COALESCE(SUM(d.subtotal),0) ventas_brutas, COALESCE(SUM(d.cantidad),0) total_productos_vendidos FROM pedido_detalles d INNER JOIN pedidos p ON p.id=d.pedido_id WHERE d.tienda_id=? AND p.estado_pago='pagado'`,[tiendaId]);
 const [[comm]]=await pool.query(`SELECT COALESCE(SUM(valor_comision),0) comision_plataforma_10, COALESCE(SUM(valor_vendedor),0) ganancia_vendedor_90 FROM comisiones WHERE tienda_id=?`,[tiendaId]);
 return {...products,...sales,...comm};
}
async function earnings(tiendaId,{limit=20,offset=0}){ const [rows]=await pool.query(`SELECT c.pedido_id,c.subtotal_tienda,c.porcentaje_comision,c.valor_comision,c.valor_vendedor,c.created_at fecha FROM comisiones c INNER JOIN pedidos p ON p.id=c.pedido_id WHERE c.tienda_id=? AND p.estado_pago='pagado' ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,[tiendaId,limit,offset]); return rows; }
async function earningsReport(tiendaId,{period,limit=20,offset=0}){
 const bucketSql=PERIOD_SQL[period];
 if(!bucketSql){ const e=new Error('period inválido.'); e.statusCode=400; throw e; }
 const periodStartSql=`DATE_FORMAT(${bucketSql}, '%Y-%m-%d')`;
 const [rows]=await pool.query(`SELECT ${periodStartSql} period_start, COUNT(*) sales_count, COALESCE(SUM(c.subtotal_tienda),0) gross_total, COALESCE(SUM(c.valor_comision),0) commission_total, COALESCE(SUM(c.valor_vendedor),0) seller_net_total FROM comisiones c INNER JOIN pedidos p ON p.id=c.pedido_id WHERE c.tienda_id=? AND p.estado_pago='pagado' GROUP BY period_start ORDER BY period_start DESC LIMIT ? OFFSET ?`,[tiendaId,limit,offset]);
 return rows;
}
async function outOfStock(tiendaId){ const [rows]=await pool.query(`SELECT id,nombre,stock,estado,precio,descuento_porcentaje FROM productos WHERE tienda_id=? AND (stock=0 OR estado='agotado') AND estado <> 'eliminado' ORDER BY updated_at DESC`,[tiendaId]); return rows; }
async function soldProducts(tiendaId){ const [rows]=await pool.query(`SELECT pr.id,pr.nombre,pr.stock,COALESCE(SUM(CASE WHEN p.estado_pago='pagado' THEN d.cantidad ELSE 0 END),0) cantidad_vendida,COALESCE(SUM(CASE WHEN p.estado_pago='pagado' THEN d.subtotal ELSE 0 END),0) total_vendido FROM productos pr LEFT JOIN pedido_detalles d ON d.producto_id=pr.id LEFT JOIN pedidos p ON p.id=d.pedido_id WHERE pr.tienda_id=? GROUP BY pr.id ORDER BY cantidad_vendida DESC, pr.nombre ASC`,[tiendaId]); return rows; }
module.exports={stats,earnings,earningsReport,outOfStock,soldProducts};
