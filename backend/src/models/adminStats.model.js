const { pool } = require('../config/database');
async function dashboardStats(){ const [[roles]]=await pool.query(`SELECT SUM(r.nombre='comprador') total_compradores, SUM(r.nombre='vendedor') total_vendedores, SUM(r.nombre='administrador') total_administradores, SUM(u.estado='activo') total_usuarios_activos, SUM(u.estado IN ('inactivo','baneado','bloqueado')) total_usuarios_inactivos FROM usuarios u INNER JOIN roles r ON r.id=u.rol_id WHERE u.deleted_at IS NULL`); const [[commerce]]=await pool.query(`SELECT (SELECT COUNT(*) FROM tiendas) total_tiendas, (SELECT COUNT(*) FROM tiendas WHERE estado='pausada') tiendas_pausadas, (SELECT COUNT(*) FROM productos) total_productos, (SELECT COUNT(*) FROM productos WHERE estado='activo') total_productos_activos, (SELECT COUNT(*) FROM productos WHERE stock=0 OR estado='agotado') total_productos_agotados, (SELECT COUNT(*) FROM pedidos) total_pedidos, (SELECT COUNT(*) FROM pedidos WHERE estado_pago='pagado') total_pedidos_pagados, (SELECT COALESCE(SUM(total),0) FROM pedidos WHERE estado_pago='pagado') ventas_totales, (SELECT COALESCE(SUM(valor_comision),0) FROM comisiones) comisiones_totales, (SELECT COUNT(*) FROM reportes_productos WHERE estado='pendiente') reportes_productos_pendientes, (SELECT COUNT(*) FROM reportes_usuarios WHERE estado='pendiente') reportes_usuarios_pendientes`); const collected=await collectedCommissions(); const top_productos_vendidos=await topSoldProducts(10); const usuarios_mas_activos=await mostActiveUsers(10); return {...roles,...commerce,...collected,top_productos_vendidos,usuarios_mas_activos}; }
async function collectedCommissions(){ const [[row]]=await pool.query(`SELECT COUNT(*) comisiones_count, COALESCE(SUM(c.valor_comision),0) comisiones_recaudadas, COALESCE(SUM(c.subtotal_tienda),0) base_liquidable, COALESCE(SUM(c.valor_vendedor),0) neto_vendedores, COALESCE(SUM(CASE WHEN c.estado='pendiente' THEN c.valor_comision ELSE 0 END),0) comisiones_liq_pendiente, COALESCE(SUM(CASE WHEN c.estado='pagada' THEN c.valor_comision ELSE 0 END),0) comisiones_liq_pagada, COALESCE(SUM(CASE WHEN c.estado='revisada' THEN c.valor_comision ELSE 0 END),0) comisiones_liq_revisada, COALESCE(SUM(CASE WHEN c.estado='rechazada' THEN c.valor_comision ELSE 0 END),0) comisiones_liq_rechazada FROM comisiones c INNER JOIN pedidos p ON p.id=c.pedido_id WHERE p.estado_pago='pagado'`); return row; }
async function topSoldProducts(limit=10){ const safeLimit=Math.min(Math.max(parseInt(limit,10)||10,1),50); const [rows]=await pool.query(`SELECT pr.id, pr.nombre, pr.precio, t.id tienda_id, t.nombre tienda_nombre, COALESCE(SUM(d.cantidad),0) unidades_vendidas, COALESCE(SUM(d.subtotal),0) total_vendido, COUNT(DISTINCT p.id) pedidos FROM pedido_detalles d INNER JOIN pedidos p ON p.id=d.pedido_id INNER JOIN productos pr ON pr.id=d.producto_id INNER JOIN tiendas t ON t.id=pr.tienda_id WHERE p.estado_pago='pagado' GROUP BY pr.id, pr.nombre, pr.precio, t.id, t.nombre ORDER BY unidades_vendidas DESC, pr.nombre ASC LIMIT ?`,[safeLimit]); return rows; }
async function mostActiveUsers(limit=10){ const safeLimit=Math.min(Math.max(parseInt(limit,10)||10,1),50); const [rows]=await pool.query(`SELECT u.id, u.nombre, u.correo, u.estado, u.ultimo_login_at, r.nombre rol, COUNT(*) acciones, COUNT(DISTINCT l.accion) acciones_distintas, MAX(l.created_at) ultima_accion FROM logs_acciones l INNER JOIN usuarios u ON u.id=l.usuario_id INNER JOIN roles r ON r.id=u.rol_id WHERE u.deleted_at IS NULL GROUP BY u.id, u.nombre, u.correo, u.estado, u.ultimo_login_at, r.nombre ORDER BY acciones DESC, u.nombre ASC LIMIT ?`,[safeLimit]); return rows; }
function reportDay(fecha){ const [y,mo,d]=String(fecha).split('-').map(Number); const next=new Date(Date.UTC(y,mo-1,d+1)).toISOString().slice(0,10); return [`${fecha} 00:00:00`, `${next} 00:00:00`]; }
async function filteredSalesTotals(f={}){
 const where=["p.estado_pago='pagado'"]; const params=[];
 if(f.fecha!==undefined){ const [from,to]=reportDay(f.fecha); where.push('p.created_at >= ? AND p.created_at < ?'); params.push(from,to); }
 if(f.tienda_id!==undefined){ where.push('d.tienda_id = ?'); params.push(f.tienda_id); }
 if(f.vendedor_id!==undefined){ where.push('t.usuario_id = ?'); params.push(f.vendedor_id); }
 if(f.producto_id!==undefined){ where.push('d.producto_id = ?'); params.push(f.producto_id); }
 if(f.categoria_id!==undefined){ where.push('pr.categoria_id = ?'); params.push(f.categoria_id); }
 if(f.estado_general!==undefined){ where.push('p.estado_general = ?'); params.push(f.estado_general); }
 const [[row]]=await pool.query(`SELECT COUNT(DISTINCT p.id) pedidos_pagados, COALESCE(SUM(d.subtotal),0) ventas_totales, COALESCE(SUM(d.cantidad),0) unidades_vendidas FROM pedido_detalles d INNER JOIN pedidos p ON p.id=d.pedido_id INNER JOIN productos pr ON pr.id=d.producto_id INNER JOIN tiendas t ON t.id=pr.tienda_id WHERE ${where.join(' AND ')}`,params);
 return row;
}
async function filteredCollectedCommissions(f={}){
 const where=["p.estado_pago='pagado'"]; const params=[];
 if(f.fecha!==undefined){ const [from,to]=reportDay(f.fecha); where.push('c.created_at >= ? AND c.created_at < ?'); params.push(from,to); }
 if(f.tienda_id!==undefined){ where.push('c.tienda_id = ?'); params.push(f.tienda_id); }
 if(f.vendedor_id!==undefined){ where.push('t.usuario_id = ?'); params.push(f.vendedor_id); }
 if(f.comision_estado!==undefined){ where.push('c.estado = ?'); params.push(f.comision_estado); }
 const [[row]]=await pool.query(`SELECT COUNT(*) comisiones_count, COALESCE(SUM(c.valor_comision),0) comisiones_recaudadas, COALESCE(SUM(c.subtotal_tienda),0) base_liquidable, COALESCE(SUM(c.valor_vendedor),0) neto_vendedores FROM comisiones c INNER JOIN pedidos p ON p.id=c.pedido_id INNER JOIN tiendas t ON t.id=c.tienda_id WHERE ${where.join(' AND ')}`,params);
 return row;
}
async function filteredTopSoldProducts(f={},limit=10){
 const safeLimit=Math.min(Math.max(parseInt(limit,10)||10,1),50);
 const where=["p.estado_pago='pagado'"]; const params=[];
 if(f.fecha!==undefined){ const [from,to]=reportDay(f.fecha); where.push('p.created_at >= ? AND p.created_at < ?'); params.push(from,to); }
 if(f.tienda_id!==undefined){ where.push('pr.tienda_id = ?'); params.push(f.tienda_id); }
 if(f.vendedor_id!==undefined){ where.push('t.usuario_id = ?'); params.push(f.vendedor_id); }
 if(f.producto_id!==undefined){ where.push('pr.id = ?'); params.push(f.producto_id); }
 if(f.categoria_id!==undefined){ where.push('pr.categoria_id = ?'); params.push(f.categoria_id); }
 if(f.producto_estado!==undefined){ where.push('pr.estado = ?'); params.push(f.producto_estado); }
 params.push(safeLimit);
 const [rows]=await pool.query(`SELECT pr.id, pr.nombre, pr.precio, t.id tienda_id, t.nombre tienda_nombre, COALESCE(SUM(d.cantidad),0) unidades_vendidas, COALESCE(SUM(d.subtotal),0) total_vendido, COUNT(DISTINCT p.id) pedidos FROM pedido_detalles d INNER JOIN pedidos p ON p.id=d.pedido_id INNER JOIN productos pr ON pr.id=d.producto_id INNER JOIN tiendas t ON t.id=pr.tienda_id WHERE ${where.join(' AND ')} GROUP BY pr.id, pr.nombre, pr.precio, t.id, t.nombre ORDER BY unidades_vendidas DESC, pr.nombre ASC LIMIT ?`,params);
 return rows;
}
async function filteredMostActiveUsers(f={},limit=10){
 const safeLimit=Math.min(Math.max(parseInt(limit,10)||10,1),50);
 const where=['u.deleted_at IS NULL']; const params=[];
 if(f.fecha!==undefined){ const [from,to]=reportDay(f.fecha); where.push('l.created_at >= ? AND l.created_at < ?'); params.push(from,to); }
 if(f.usuario_estado!==undefined){ where.push('u.estado = ?'); params.push(f.usuario_estado); }
 params.push(safeLimit);
 const [rows]=await pool.query(`SELECT u.id, u.nombre, u.correo, u.estado, u.ultimo_login_at, r.nombre rol, COUNT(*) acciones, COUNT(DISTINCT l.accion) acciones_distintas, MAX(l.created_at) ultima_accion FROM logs_acciones l INNER JOIN usuarios u ON u.id=l.usuario_id INNER JOIN roles r ON r.id=u.rol_id WHERE ${where.join(' AND ')} GROUP BY u.id, u.nombre, u.correo, u.estado, u.ultimo_login_at, r.nombre ORDER BY acciones DESC, u.nombre ASC LIMIT ?`,params);
 return rows;
}
async function filteredReports(f={}){
 const [ventas,comisiones,top_productos_vendidos,usuarios_mas_activos]=await Promise.all([filteredSalesTotals(f),filteredCollectedCommissions(f),filteredTopSoldProducts(f,f.limit),filteredMostActiveUsers(f,f.limit)]);
 return {ventas,comisiones,top_productos_vendidos,usuarios_mas_activos};
}
async function findUser(id,conn=pool){ const [[u]]=await conn.query('SELECT u.id,u.nombre,u.correo,u.estado,r.nombre rol FROM usuarios u INNER JOIN roles r ON r.id=u.rol_id WHERE u.id=?',[id]); return u||null; }
async function listUsers({limit=50,offset=0,q,rol,estado,sort}){ const where=['u.deleted_at IS NULL']; const params=[]; if(q){ where.push('(u.nombre LIKE ? OR u.correo LIKE ?)'); params.push(`%${q}%`,`%${q}%`); } if(rol){ where.push('r.nombre = ?'); params.push(rol); } if(estado){ where.push('u.estado = ?'); params.push(estado); } const orderBy=sort==='oldest'?'u.created_at ASC':'u.created_at DESC'; params.push(limit,offset); const [rows]=await pool.query(`SELECT u.id,u.nombre,u.correo,u.telefono,u.estado,u.created_at,r.nombre rol FROM usuarios u INNER JOIN roles r ON r.id=u.rol_id WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,params); return rows; }
module.exports={dashboardStats,collectedCommissions,topSoldProducts,mostActiveUsers,filteredReports,filteredSalesTotals,filteredCollectedCommissions,filteredTopSoldProducts,filteredMostActiveUsers,findUser,listUsers};
