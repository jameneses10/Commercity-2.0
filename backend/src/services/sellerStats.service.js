const storeModel=require('../models/store.model'); const model=require('../models/sellerStats.model');
function err(m,s){const e=new Error(m); e.statusCode=s; return e;}
const EARNINGS_REPORT_PERIODS=new Set(['daily','weekly','monthly']);
function normalizeEarningsReportPeriod(q){
 const periodKeys=Object.keys(q).filter(key=>/^period(?:\[.*\])?$/.test(key));
 if(!periodKeys.length) return null;
 if(periodKeys.length!==1||periodKeys[0]!=='period'||typeof q.period!=='string'||!EARNINGS_REPORT_PERIODS.has(q.period)) throw err('period inválido.',400);
 return q.period;
}
async function sellerStore(userId){const store=await storeModel.findStoreBySellerId(userId); if(!store) throw err('El vendedor no tiene tienda registrada.',404); return store;}
async function stats(userId){const store=await sellerStore(userId); return {store, stats: await model.stats(store.id)};}
async function earnings(userId,q={}){const period=normalizeEarningsReportPeriod(q); const store=await sellerStore(userId); const page=Math.max(parseInt(q.page||'1',10),1), limit=Math.min(Math.max(parseInt(q.limit||'20',10),1),50); if(period===null) return {store, earnings: await model.earnings(store.id,{limit,offset:(page-1)*limit}), pagination:{page,limit}}; return {store, period, report_rows:await model.earningsReport(store.id,{period,limit,offset:(page-1)*limit}), pagination:{page,limit}};}
async function outOfStock(userId){const store=await sellerStore(userId); return {store, products: await model.outOfStock(store.id)};}
async function soldProducts(userId){const store=await sellerStore(userId); return {store, products: await model.soldProducts(store.id)};}
module.exports={stats,earnings,outOfStock,soldProducts,sellerStore};
