import { showMessage } from './ui.js';

function initFilterPills(){
  const group=document.querySelector('[data-filter-group="notifications"]');
  if(!group) return;
  const empty=document.querySelector('[data-empty-state]');
  const cards=[...document.querySelectorAll('.cc-notification-card')];
  group.addEventListener('click', event=>{
    const btn=event.target.closest('[data-filter]');
    if(!btn) return;
    group.querySelectorAll('[data-filter]').forEach(item=>item.classList.remove('active'));
    btn.classList.add('active');
    const filter=btn.dataset.filter;
    let visible=0;
    cards.forEach(card=>{
      const show=filter==='all' || (filter==='unread' && card.classList.contains('unread')) || card.dataset.kind===filter;
      card.classList.toggle('hidden', !show);
      if(show) visible+=1;
    });
    if(empty) empty.classList.toggle('hidden', visible>0);
  });
}

function initCategorySearch(){
  const input=document.querySelector('[data-category-search]');
  if(!input) return;
  const empty=document.querySelector('[data-empty-state]');
  const apply=()=>{
    const q=input.value.trim().toLowerCase();
    const cards=[...document.querySelectorAll('[data-categories] .cc-category-card')];
    let visible=0;
    cards.forEach(card=>{
      const show=card.innerText.toLowerCase().includes(q);
      card.classList.toggle('hidden', !show);
      if(show) visible+=1;
    });
    if(empty) empty.classList.toggle('hidden', visible>0 || cards.length===0);
  };
  input.addEventListener('input', apply);
  setTimeout(apply, 700);
}

function initHelpSearch(){
  const input=document.querySelector('[data-help-search]');
  if(!input) return;
  input.addEventListener('input',()=>{
    const q=input.value.trim().toLowerCase();
    document.querySelectorAll('.cc-help-topic, .cc-faq-list details').forEach(card=>{
      card.classList.toggle('hidden', q && !card.innerText.toLowerCase().includes(q));
    });
  });
}

initFilterPills();
initCategorySearch();
initHelpSearch();
