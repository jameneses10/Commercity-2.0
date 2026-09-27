const { pool } = require('../config/database');
async function search(q){
  const like=`%${q}%`;
  const [usuarios]=await pool.query(
    `SELECT u.id,u.nombre,u.correo,u.estado,r.nombre AS rol
       FROM usuarios u
       INNER JOIN roles r ON r.id=u.rol_id
      WHERE u.deleted_at IS NULL
        AND (u.nombre LIKE ? OR u.correo LIKE ?)
      ORDER BY u.created_at DESC
      LIMIT 10`,
    [like,like]
  );
  const [productos]=await pool.query(
    `SELECT p.id,p.nombre,p.estado,p.precio,p.stock,p.tienda_id,t.nombre AS tienda_nombre
       FROM productos p
       INNER JOIN tiendas t ON t.id=p.tienda_id
      WHERE p.nombre LIKE ?
      ORDER BY p.created_at DESC
      LIMIT 10`,
    [like]
  );
  const [tiendas]=await pool.query(
    `SELECT t.id,t.nombre,t.estado,u.id AS vendedor_id,u.nombre AS vendedor_nombre,u.correo AS vendedor_correo
       FROM tiendas t
       INNER JOIN usuarios u ON u.id=t.usuario_id
      WHERE (t.nombre LIKE ? OR u.nombre LIKE ? OR u.correo LIKE ?)
      ORDER BY t.created_at DESC
      LIMIT 10`,
    [like,like,like]
  );
  return {usuarios,productos,tiendas};
}
module.exports={search};
