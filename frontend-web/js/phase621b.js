function norm(value){
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}

function aliases(value){
  const v=norm(value);
  const map={
    all:['all','todos','todas','mes actual'],
    admin:['admin','administrador','administradores'],
    administrador:['admin','administrador','administradores'],
    activo:['activo','activa','activos','activas'],
    activa:['activo','activa','activos','activas'],
    bloqueado:['bloqueado','bloqueados'],
    pendiente:['pendiente','pendientes'],
    suspendida:['suspendida','suspendidas'],
    pausado:['pausado','pausados','oculto','ocultos'],
    'sin-stock':['sin-stock','sin stock','sin-stock'],
    reportado:['reportado','reportados'],
    pagada:['pagada','pagadas'],
    pendiente_pago:['pendiente','pendientes'],
    revisada:['revisada','revisadas'],
    comprador:['comprador','compradores'],
    vendedor:['vendedor','vendedores']
  };
  return map[v] || [v];
}

function filterTokens(item){
  return [
    item.dataset.orderStatus,
    item.dataset.status,
    item.dataset.role,
    item.dataset.category,
    item.dataset.kind,
    item.dataset.type,
    item.dataset.filterText
  ].map(norm).filter(Boolean).join(' ');
}

function searchTokens(item){
  return [filterTokens(item), item.innerText].map(norm).filter(Boolean).join(' ');
}

function setHidden(item, hidden){
  item.classList.toggle('hidden', hidden);
  item.dataset.filteredHidden = hidden ? 'true' : 'false';
}

function ensureEmpty(scope, items, group){
  let empty=document.querySelector(`[data-visual-empty="${scope}"]`) || document.querySelector(`[data-admin-empty="${scope}"]`) || document.querySelector(`[data-seller-empty="${scope}"]`);
  if(empty) return empty;
  const sample=items[0];
  if(!sample) return null;
  if(sample.tagName === 'TR'){
    const tbody=sample.closest('tbody');
    const cols=sample.children.length || sample.closest('table')?.querySelectorAll('thead th').length || 1;
    empty=document.createElement('tr');
    empty.dataset.visualEmpty=scope;
    empty.className='hidden cc-empty-row';
    empty.innerHTML=`<td colspan="${cols}"><div class="cc-inline-empty"><strong>No se encontraron resultados.</strong><span>Ajusta el filtro o limpia la búsqueda.</span></div></td>`;
    tbody?.appendChild(empty);
    return empty;
  }
  empty=document.createElement('article');
  empty.dataset.visualEmpty=scope;
  empty.className='cc-card cc-empty-state hidden';
  empty.innerHTML='<h2>No se encontraron resultados.</h2><p class="cc-muted">Ajusta el filtro o limpia la búsqueda.</p>';
  const container=sample.parentElement || group.parentElement;
  container?.appendChild(empty);
  return empty;
}

function findItems(scope, prefix){
  if(prefix === 'order') return [...document.querySelectorAll('[data-order-status]')];
  if(prefix === 'notifications') return [...document.querySelectorAll('.cc-notification-card')];
  return [...document.querySelectorAll(`[data-${prefix}-item="${scope}"]`)];
}

function currentFilter(group){
  const active=group.querySelector('[data-filter].active,[data-order-filter].active');
  return active?.dataset.filter || active?.dataset.orderFilter || 'all';
}

function queryFor(scope, prefix){
  return document.querySelector(`[data-${prefix}-search="${scope}"]`) || document.querySelector(`[data-admin-search="${scope}"]`) || document.querySelector(`[data-seller-search="${scope}"]`);
}

function applyFilter(scope, prefix, group){
  const items=findItems(scope,prefix);
  const filter=currentFilter(group);
  const query=norm(queryFor(scope,prefix)?.value || '');
  const empty=ensureEmpty(`${prefix}-${scope}`, items, group);
  const terms=aliases(filter);
  let visible=0;
  items.forEach(item=>{
    const filterData=filterTokens(item);
    const textData=searchTokens(item);
    const byFilter=filter==='all' || terms.some(term=>filterData.includes(term));
    const byQuery=!query || textData.includes(query);
    const show=byFilter && byQuery;
    setHidden(item,!show);
    if(show) visible += 1;
  });
  empty?.classList.toggle('hidden', visible>0);
}

function initFilterGroup(group, scope, prefix){
  applyFilter(scope,prefix,group);
  group.addEventListener('click', event=>{
    const btn=event.target.closest('[data-filter],[data-order-filter]');
    if(!btn) return;
    group.querySelectorAll('[data-filter],[data-order-filter]').forEach(item=>item.classList.remove('active'));
    btn.classList.add('active');
    applyFilter(scope,prefix,group);
  });
  queryFor(scope,prefix)?.addEventListener('input',()=>applyFilter(scope,prefix,group));
}

function initFilters(){
  document.querySelectorAll('[data-admin-filter-group]').forEach(group=>initFilterGroup(group, group.dataset.adminFilterGroup, 'admin'));
  document.querySelectorAll('[data-seller-filter-group]').forEach(group=>initFilterGroup(group, group.dataset.sellerFilterGroup, 'seller'));
  document.querySelectorAll('[data-order-filters]').forEach(group=>initFilterGroup(group, 'orders', 'order'));
  document.querySelectorAll('[data-filter-group="notifications"]').forEach(group=>initFilterGroup(group, 'notifications', 'notifications'));
}

function feedback(message, ok=true){
  let box=document.querySelector('[data-phase621b-feedback]');
  if(!box){
    box=document.createElement('div');
    box.dataset.phase621bFeedback='true';
    box.className='cc-visual-feedback';
    document.querySelector('main')?.prepend(box);
  }
  box.innerHTML=`<div class="cc-alert ${ok?'ok':'bad'}">${message}</div>`;
}

function badgeFor(item){
  return item.querySelector('.cc-chip');
}

function setStatus(item, status, label){
  item.dataset.status=status;
  const badge=badgeFor(item);
  if(badge){
    badge.textContent=label;
    badge.classList.remove('orange','blue','neutral');
    badge.classList.add(status.includes('bloque')||status.includes('suspend')||status.includes('rechaz')?'neutral': status.includes('pend')||status.includes('paus')||status.includes('report')?'orange':'blue');
  }
  const scope=item.dataset.adminItem || item.dataset.sellerItem;
  const group=scope ? document.querySelector(`[data-admin-filter-group="${scope}"],[data-seller-filter-group="${scope}"]`) : null;
  if(group) applyFilter(scope, item.dataset.adminItem?'admin':'seller', group);
}

function initActions(){
  document.addEventListener('click', event=>{
    const btn=event.target.closest('button');
    if(!btn) return;
    if(btn.dataset.userStatus) return;
    const item=btn.closest('[data-admin-item],[data-seller-item]');
    const text=norm(btn.textContent);
    if(!item){
      if(text.includes('marcar') || text.includes('exportar') || text.includes('filtrar') || text.includes('enviar') || text.includes('ver detalle')){
        event.preventDefault();
        feedback(`${btn.textContent.trim()} ejecutado visualmente. Endpoint real pendiente.`);
      }
      return;
    }
    if(text.includes('bloquear')){ setStatus(item,'bloqueado','Bloqueado'); feedback('Usuario bloqueado visualmente.'); return; }
    if(text.includes('activar')){ setStatus(item,'activo','Activo'); feedback('Registro activado visualmente.'); return; }
    if(text.includes('aprobar')){ setStatus(item,'activa','Activa'); feedback('Tienda o reseña aprobada visualmente.'); return; }
    if(text.includes('suspender')){ setStatus(item,'suspendida','Suspendida'); feedback('Tienda suspendida visualmente.'); return; }
    if(text.includes('ocultar')){ setStatus(item,'pausado','Pausado'); feedback('Producto o reseña oculto visualmente.'); return; }
    if(text.includes('marcar revisada') || text.includes('revisada')){ setStatus(item,'revisada','Revisada'); feedback('Elemento marcado como revisado visualmente.'); return; }
    if(text.includes('ver') || text.includes('revisar') || text.includes('cambiar rol') || text.includes('actualizar')){
      feedback(`${btn.textContent.trim()} preparado visualmente. Endpoint real pendiente.`);
    }
  });
}

initFilters();
initActions();
