const commissionModel=require('../models/commission.model');
const platformSettingsModel=require('../models/platformSettings.model');
async function createCommissions(conn,pedidoId,details){
 const rate=await platformSettingsModel.getCommissionRate(conn);
 const grouped={};
 for(const d of details){grouped[d.tienda_id]=(grouped[d.tienda_id]||0)+Number(d.subtotal)}
 for(const [tienda_id,subtotal] of Object.entries(grouped)){
  const valor_comision=Number((subtotal*(rate/100)).toFixed(2));
  const valor_vendedor=Number((subtotal-valor_comision).toFixed(2));
  await commissionModel.create(conn,{pedido_id:pedidoId,tienda_id:Number(tienda_id),subtotal_tienda:subtotal,porcentaje_comision:rate,valor_comision,valor_vendedor});
 }
}
module.exports={createCommissions};
