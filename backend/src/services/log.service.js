const model=require('../models/log.model');
async function log(conn,payload){ return model.create(conn,payload); }
function err(m,s){const e=new Error(m); e.statusCode=s; return e;}
function normalizeLogDate(value){
 if(value===undefined) return undefined;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw err('fecha debe tener formato YYYY-MM-DD.',400);
 const [y,m,d]=value.split('-').map(Number);
 const dt=new Date(Date.UTC(y,m-1,d));
 if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d) throw err('fecha inválida.',400);
 return value;
}
function normalizeLogId(value,name){
 if(value===undefined) return undefined;
 const parsed=Number(value);
 if(!Number.isInteger(parsed)||parsed<1) throw err(`${name} inválido.`,400);
 return parsed;
}
function normalizeLogText(value,name,max){
 if(value===undefined) return undefined;
 if(typeof value!=='string') throw err(`${name} inválido.`,400);
 const trimmed=value.trim();
 if(trimmed==='') return undefined;
 if(trimmed.length>max) throw err(`${name} inválido.`,400);
 return trimmed;
}
function normalizeLogFilters(query={}){
 return {
  fecha:normalizeLogDate(query.fecha),
  usuario_id:normalizeLogId(query.usuario_id,'usuario_id'),
  accion:normalizeLogText(query.accion,'accion',120),
  entidad:normalizeLogText(query.entidad,'entidad',80),
  entidad_id:normalizeLogId(query.entidad_id,'entidad_id')
 };
}
async function list(query){
 const page=Math.max(parseInt(query.page||'1',10),1);
 const limit=Math.min(Math.max(parseInt(query.limit||'20',10),1),100);
 const offset=(page-1)*limit;
 const filters=normalizeLogFilters(query);
 Object.keys(filters).forEach(k=>{ if(filters[k]===undefined) delete filters[k]; });
 return {logs:await model.list({limit,offset,...filters}),pagination:{page,limit},filtros_aplicados:filters};
}
module.exports={log,list,normalizeLogFilters};
