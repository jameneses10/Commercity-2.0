import { showMessage } from './ui.js';

function initSellerFilters(){
  document.querySelectorAll('[data-seller-filter-group]').forEach(group=>{
    const scope=group.dataset.sellerFilterGroup;
    const items=[...document.querySelectorAll(`[data-seller-item="${scope}"]`)];
    const empty=document.querySelector(`[data-seller-empty="${scope}"]`);
    const apply=(filter, query='')=>{
      let visible=0;
      items.forEach(item=>{
        const byStatus=filter==='all' || item.dataset.status===filter;
        const bySearch=!query || item.innerText.toLowerCase().includes(query);
        const show=byStatus && bySearch;
        item.classList.toggle('hidden', !show);
        if(show) visible+=1;
      });
      if(empty) empty.classList.toggle('hidden', visible>0);
    };
    group.addEventListener('click', event=>{
      const btn=event.target.closest('[data-filter]');
      if(!btn) return;
      group.querySelectorAll('[data-filter]').forEach(item=>item.classList.remove('active'));
      btn.classList.add('active');
      const input=document.querySelector(`[data-seller-search="${scope}"]`);
      apply(btn.dataset.filter, input?.value.trim().toLowerCase() || '');
    });
    const input=document.querySelector(`[data-seller-search="${scope}"]`);
    input?.addEventListener('input',()=>{
      const active=group.querySelector('[data-filter].active')?.dataset.filter || 'all';
      apply(active, input.value.trim().toLowerCase());
    });
  });
}

/* RNF-025 (#58): aqui vivia initSellerProductForm(), un segundo listener de
   submit sobre #sellerProductForm que pintaba un exito verde antes de que
   seller.js supiera el resultado del POST. Medido: verde a los 6 ms, error
   real a los 41 ms. Se retira para que seller.js sea el unico propietario
   del envio; su validacion local vive ahora en el backend. */

function initVisualForms(){
  document.querySelectorAll('[data-visual-form]').forEach(form=>{
    form.addEventListener('submit', event=>{
      event.preventDefault();
      const target=form.dataset.visualForm;
      const invalid=[...form.querySelectorAll('[required]')].some(input=>!String(input.value||'').trim());
      if(invalid){ showMessage(`#${target}`,'Completa los campos obligatorios para continuar.'); return; }
      showMessage(`#${target}`,'Funcionalidad en preparación. Validación visual correcta.',true);
    });
  });
}

initSellerFilters();
initVisualForms();
