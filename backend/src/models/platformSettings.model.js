async function getCommissionSettings(executor){
  const [[row]] = await executor.query('SELECT id, porcentaje_comision, updated_at FROM configuracion_plataforma WHERE id=1 LIMIT 1');
  if(!row){ const e=new Error('Configuración de comisión no encontrada.'); e.statusCode=500; throw e; }
  return row;
}
async function getCommissionRate(executor){
  const row = await getCommissionSettings(executor);
  const rate = Number(row.porcentaje_comision);
  if(!Number.isFinite(rate)){ const e=new Error('Configuración de comisión inválida.'); e.statusCode=500; throw e; }
  return rate;
}
async function updateCommissionRate(executor, porcentaje){
  await executor.query('UPDATE configuracion_plataforma SET porcentaje_comision=? WHERE id=1', [porcentaje]);
  return getCommissionSettings(executor);
}
module.exports={getCommissionSettings,getCommissionRate,updateCommissionRate};
