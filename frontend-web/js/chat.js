const form=document.querySelector('[data-chat-form]');
const input=document.querySelector('[data-chat-input]');
const messages=document.querySelector('[data-chat-messages]');
const alertBox=document.querySelector('[data-chat-alert]');
const emojiPanel=document.querySelector('[data-emoji-panel]');
const fileInput=document.querySelector('[data-file-input]');
const fileState=document.querySelector('[data-file-state]');
let selectedFile='';
function stamp(){return new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});}
function hideAlert(){alertBox?.classList.add('cc-hidden');}
document.querySelector('[data-emoji-toggle]')?.addEventListener('click',()=>emojiPanel?.classList.toggle('cc-hidden'));
emojiPanel?.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{input.value+=btn.textContent;input.focus();emojiPanel.classList.add('cc-hidden');hideAlert();}));
document.querySelector('[data-file-button]')?.addEventListener('click',()=>fileInput?.click());
fileInput?.addEventListener('change',()=>{selectedFile=fileInput.files?.[0]?.name||'';fileState.textContent=selectedFile?`Archivo listo para enviar: ${selectedFile}`:'';hideAlert();});
document.querySelectorAll('[data-chat-contact]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-chat-contact]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelector('[data-chat-title]').textContent=btn.dataset.chatContact;document.querySelector('[data-chat-state]').textContent=btn.dataset.chatStatus;}));
form?.addEventListener('submit',(event)=>{event.preventDefault();const text=input.value.trim();if(!text&&!selectedFile){alertBox?.classList.remove('cc-hidden');return;}const row=document.createElement('div');row.className='cc-message-row mine';const article=document.createElement('article');article.className='cc-message mine';const messageText=document.createElement('p');messageText.textContent=text||'Archivo adjunto preparado para envío.';article.appendChild(messageText);if(selectedFile){const attachment=document.createElement('p');attachment.className='cc-attachment-note';attachment.textContent=`Adjunto preparado: ${selectedFile}`;article.appendChild(attachment);}const timeElement=document.createElement('time');timeElement.textContent=stamp();article.appendChild(timeElement);row.appendChild(article);messages.appendChild(row);input.value='';selectedFile='';if(fileInput) fileInput.value='';fileState.textContent='';hideAlert();messages.scrollTop=messages.scrollHeight;});
