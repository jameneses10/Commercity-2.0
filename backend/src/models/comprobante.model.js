async function create(conn,{pedido_id,pago_id,numero}){ const [r]=await conn.query('INSERT INTO comprobantes (pedido_id,pago_id,numero) VALUES (?,?,?)',[pedido_id,pago_id,numero]); return r.insertId; }
module.exports={create};
