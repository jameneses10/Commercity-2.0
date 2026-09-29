import { api, token } from './api.js';
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

/* ── RF-278: integracion minima de lectura y reporte de mensajes ──
   Solo consume GET /chat/conversations, GET /chat/conversations/:id/messages
   y PATCH /chat/messages/:id/report. El composer visual anterior se conserva. */
const conversationList=document.querySelector('.cc-chat-list');
const chatTitle=document.querySelector('[data-chat-title]');
const chatState=document.querySelector('[data-chat-state]');
// Solo se puede reportar un id devuelto por el endpoint real de mensajes.
const realMessageIds=new Set();
let activeConversationId=null;
function chatEsc(value){ return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function setChatState(text){ if(chatState) chatState.textContent=text; }
function setChatTitle(text){ if(chatTitle) chatTitle.textContent=text; }
function conversationLabel(conversation){
  return conversation?.producto_nombre || conversation?.tienda_nombre || conversation?.vendedor_nombre || conversation?.comprador_nombre || `Conversacion ${conversation?.id ?? ''}`.trim();
}
function conversationButtonHtml(conversation){
  const label=chatEsc(conversationLabel(conversation));
  const last=chatEsc(conversation?.ultimo_mensaje || 'Sin mensajes');
  return `<button class="cc-conversation w-full p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left flex items-center gap-3 transition-all" type="button" data-chat-contact="${label}" data-chat-conversation="${chatEsc(conversation?.id)}"><img class="cc-avatar w-10 h-10 rounded-full bg-orange-100 p-2" src="assets/icons/cc-chat-messages.svg" alt=""><div class="flex-1 overflow-hidden"><b class="text-sm font-bold text-slate-900 dark:text-white block truncate Poppins">${label}</b><small class="text-xs text-slate-400 block truncate">${last}</small></div></button>`;
}
function messageRowHtml(message){
  const id=message?.id;
  const body=message?.eliminado?'<i>Mensaje eliminado</i>':chatEsc(message?.mensaje ?? message?.contenido ?? '[archivo]');
  const author=chatEsc(message?.emisor_nombre || 'Usuario');
  const reported=message?.reportado===true||message?.reportado===1;
  const action=message?.eliminado?'':(reported
    ? `<span class="cc-chip orange" data-chat-reported="${chatEsc(id)}">Reportado</span>`
    : `<button class="cc-btn outline text-xs" type="button" data-chat-report="${chatEsc(id)}">Reportar mensaje</button>`);
  return `<div class="cc-message-row" data-chat-message="${chatEsc(id)}"><article class="cc-message"><b class="text-xs text-slate-500 block">${author}</b><p>${body}</p><time class="text-xs text-slate-400">${chatEsc(message?.created_at ?? message?.creado_en ?? '')}</time><div class="cc-card-actions-row mt-2">${action}</div></article></div>`;
}
async function loadChatMessages(conversationId){
  if(!messages) return;
  activeConversationId=conversationId;
  messages.innerHTML='<p class="cc-muted">Cargando mensajes...</p>';
  try{
    const response=await api.get(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`);
    const payload=response.data||{};
    const list=Array.isArray(payload.messages)?payload.messages:[];
    realMessageIds.clear();
    list.forEach(item=>{ if(item?.id!==undefined&&item?.id!==null) realMessageIds.add(String(item.id)); });
    messages.innerHTML=list.length?list.map(messageRowHtml).join(''):'<p class="cc-muted">Esta conversacion no tiene mensajes.</p>';
    if(payload.conversation) setChatTitle(conversationLabel(payload.conversation));
    setChatState(`${list.length} mensaje${list.length===1?'':'s'}`);
    messages.scrollTop=messages.scrollHeight;
  }catch(error){
    realMessageIds.clear();
    messages.innerHTML=`<p class="cc-muted">No fue posible cargar los mensajes. ${chatEsc(error?.message||'')}</p>`;
    setChatState('Error al cargar la conversacion');
  }
}
async function reportChatMessage(button){
  const id=button?.dataset?.chatReport;
  // Rechaza cualquier id que no provenga de la respuesta real del endpoint.
  if(!id || !realMessageIds.has(String(id))){ setChatState('Solo puedes reportar mensajes cargados desde el servidor.'); return false; }
  button.disabled=true;
  setChatState('Enviando reporte del mensaje...');
  try{
    const response=await api.patch(`/chat/messages/${encodeURIComponent(id)}/report`);
    const updated=response.data?.message;
    const reported=updated?.reportado===true||updated?.reportado===1;
    if(reported){ button.outerHTML=`<span class="cc-chip orange" data-chat-reported="${chatEsc(id)}">Reportado</span>`; }
    setChatState('Mensaje reportado. El equipo administrativo lo revisara.');
    return true;
  }catch(error){
    button.disabled=false;
    const code=Number(error?.status ?? error?.statusCode ?? 0);
    if(code===404) setChatState('Mensaje no encontrado o no participas en esta conversacion.');
    else if(code===401||code===403) setChatState('Inicia sesion como participante para reportar este mensaje.');
    else setChatState(`No fue posible reportar el mensaje. ${error?.message || ''}`.trim());
    return false;
  }
}
async function loadChatConversations(){
  if(!conversationList) return;
  if(!token()){ setChatState('Inicia sesion para ver tus conversaciones.'); return; }
  try{
    const response=await api.get('/chat/conversations');
    const list=Array.isArray(response.data?.conversations)?response.data.conversations:[];
    if(!list.length){ conversationList.innerHTML='<p class="cc-muted p-3">No tienes conversaciones todavia.</p>'; setChatState('Sin conversaciones'); return; }
    conversationList.innerHTML=list.map(conversationButtonHtml).join('');
    const first=conversationList.querySelector('[data-chat-conversation]');
    if(first){ first.classList.add('active'); setChatTitle(first.dataset.chatContact); await loadChatMessages(first.dataset.chatConversation); }
  }catch(error){
    setChatState(`No fue posible cargar las conversaciones. ${chatEsc(error?.message||'')}`);
  }
}
conversationList?.addEventListener('click',event=>{
  const button=event.target.closest('[data-chat-conversation]');
  if(!button) return;
  conversationList.querySelectorAll('[data-chat-conversation]').forEach(b=>b.classList.remove('active'));
  button.classList.add('active');
  setChatTitle(button.dataset.chatContact);
  loadChatMessages(button.dataset.chatConversation);
});
messages?.addEventListener('click',event=>{
  const button=event.target.closest('[data-chat-report]');
  if(button) reportChatMessage(button);
});
loadChatConversations();
