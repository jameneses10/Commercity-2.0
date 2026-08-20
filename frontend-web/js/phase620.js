import { showMessage } from './ui.js';

function initSupportForm(){
  const form=document.querySelector('#supportForm');
  if(!form) return;
  form.addEventListener('submit', event=>{
    event.preventDefault();
    const data=new FormData(form);
    const required=['tipo','asunto','descripcion'];
    const missing=required.some(key=>!String(data.get(key)||'').trim());
    if(missing){ showMessage('#supportMessage','Completa tipo de solicitud, asunto y descripción para enviar el caso.'); return; }
    showMessage('#supportMessage','Solicitud visual registrada. Cuando el backend de soporte esté conectado se creará el ticket real.',true);
    form.reset();
  });
}

function initChatDetail(){
  const form=document.querySelector('#chatDetailForm');
  if(!form) return;
  const input=document.querySelector('#chatDetailInput');
  const file=document.querySelector('#chatAttachment');
  const list=document.querySelector('#detailMessages');
  const emojiPanel=document.querySelector('#emojiPanel');
  document.querySelector('[data-emoji-toggle]')?.addEventListener('click',()=>emojiPanel?.classList.toggle('hidden'));
  emojiPanel?.addEventListener('click', event=>{
    const btn=event.target.closest('button');
    if(!btn || !input) return;
    input.value=`${input.value}${btn.textContent}`;
    input.focus();
  });
  form.addEventListener('submit', event=>{
    event.preventDefault();
    const text=String(input?.value||'').trim();
    const hasFile=!!file?.files?.length;
    if(!text && !hasFile){ showMessage('#chatDetailMessage','Escribe un mensaje o adjunta un archivo antes de enviar.'); return; }
    const bubble=document.createElement('div');
    bubble.className='cc-detail-message own';
    const sender=document.createElement('b');
    sender.textContent='Tú';
    bubble.appendChild(sender);
    const message=document.createElement('p');
    message.textContent=text || 'Adjunto enviado visualmente.';
    bubble.appendChild(message);
    if(hasFile){
      const attachment=document.createElement('span');
      attachment.className='cc-attachment';
      const attachmentIcon=document.createElement('img');
      attachmentIcon.className='cc-icon';
      attachmentIcon.src='assets/icons/cc-product-image-upload.svg';
      attachmentIcon.alt='';
      attachment.appendChild(attachmentIcon);
      attachment.appendChild(document.createTextNode(` ${file.files[0].name}`));
      bubble.appendChild(attachment);
    }
    const timestamp=document.createElement('small');
    timestamp.textContent='Ahora';
    bubble.appendChild(timestamp);
    list?.appendChild(bubble);
    showMessage('#chatDetailMessage','Mensaje agregado visualmente. Integración real de chat pendiente.',true);
    form.reset();
  });
  document.querySelectorAll('[data-visual-status]').forEach(btn=>btn.addEventListener('click',()=>showMessage('#conversationActionMessage',btn.dataset.visualStatus,true)));
}

function initReturnActions(){
  document.querySelectorAll('[data-return-action]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const state=btn.dataset.returnAction;
      const chip=document.querySelector('#returnStateChip');
      if(chip) chip.textContent=state;
      showMessage('#returnActionMessage',`${state}. Acción preparada para endpoint real de devoluciones.`,true);
    });
  });
}

initSupportForm();
initChatDetail();
initReturnActions();
