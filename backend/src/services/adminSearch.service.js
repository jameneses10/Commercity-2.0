const model=require('../models/adminSearch.model');
function err(m,s){const e=new Error(m);e.statusCode=s;return e;}
function normalizeGlobalSearchQuery(value){
  if(value===undefined || typeof value!=='string') throw err('q inválido.',400);
  const trimmed=value.trim();
  if(trimmed.length<2 || trimmed.length>120) throw err('q inválido.',400);
  return trimmed;
}
async function search(q){ return model.search(normalizeGlobalSearchQuery(q)); }
module.exports={search};
