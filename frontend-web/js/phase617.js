import { showMessage } from './ui.js';

function initOrderFilters(){
  const group=document.querySelector('[data-order-filters]');
  if(!group) return;
  const cards=[...document.querySelectorAll('[data-order-status]')];
  group.addEventListener('click', event=>{
    const btn=event.target.closest('[data-order-filter]');
    if(!btn) return;
    group.querySelectorAll('[data-order-filter]').forEach(item=>item.classList.remove('active'));
    btn.classList.add('active');
    const filter=btn.dataset.orderFilter;
    cards.forEach(card=>card.classList.toggle('hidden', filter!=='all' && card.dataset.orderStatus!==filter));
  });
}

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

function initScrollTargets(){
  document.querySelectorAll('[data-scroll-target]').forEach(btn=>{
    btn.addEventListener('click',()=>document.getElementById(btn.dataset.scrollTarget)?.scrollIntoView({block:'start'}));
  });
}

initOrderFilters();
initVisualForms();
initScrollTargets();
