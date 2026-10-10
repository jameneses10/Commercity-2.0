import { api, token, currentUser } from './api.js';
const form=document.querySelector('[data-chat-form]');
const input=document.querySelector('[data-chat-input]');
const messages=document.querySelector('[data-chat-messages]');
const alertBox=document.querySelector('[data-chat-alert]');
const emojiPanel=document.querySelector('[data-emoji-panel]');
const fileInput=document.querySelector('[data-file-input]');
const fileState=document.querySelector('[data-file-state]');
/* ── RF-291: adjuntar imagenes o documentos ──
   El backend ya acepta hasta 5 archivos de 10 MB en el mismo POST que el texto
   (chatUpload.array('files',5)). Antes solo se guardaba el NOMBRE del archivo y
   el formulario no llamaba a la API. Ahora se conservan los File reales. */
const CHAT_MAX_FILES=5;
const CHAT_MAX_BYTES=10*1024*1024;
const CHAT_ACCEPT='image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,application/pdf,.pdf,.doc,.docx';
let selectedFiles=[];
function stamp(){return new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});}
function hideAlert(){alertBox?.classList.add('cc-hidden');}
document.querySelector('[data-emoji-toggle]')?.addEventListener('click',()=>emojiPanel?.classList.toggle('cc-hidden'));
emojiPanel?.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{input.value+=btn.textContent;input.focus();emojiPanel.classList.add('cc-hidden');hideAlert();}));
document.querySelector('[data-file-button]')?.addEventListener('click',()=>fileInput?.click());
// Se alinea el selector con los limites REALES del servidor sin tocar el HTML.
if(fileInput){ fileInput.multiple=true; fileInput.accept=CHAT_ACCEPT; }
function describeFiles(){
 if(!fileState) return;
 if(!selectedFiles.length){ fileState.textContent=''; return; }
 const names=selectedFiles.map(file=>file.name).join(', ');
 fileState.textContent=`${selectedFiles.length} archivo${selectedFiles.length===1?'':'s'} listo${selectedFiles.length===1?'':'s'} para enviar: ${names}`;
}
function clearFiles(){ selectedFiles=[]; if(fileInput) fileInput.value=''; describeFiles(); }
fileInput?.addEventListener('change',()=>{
 const picked=[...(fileInput.files||[])];
 const tooBig=picked.find(file=>file.size>CHAT_MAX_BYTES);
 if(tooBig){ selectedFiles=[]; fileInput.value=''; if(fileState) fileState.textContent=`${tooBig.name} supera el maximo de 10 MB.`; return; }
 if(picked.length>CHAT_MAX_FILES){ selectedFiles=[]; fileInput.value=''; if(fileState) fileState.textContent=`Puedes adjuntar como maximo ${CHAT_MAX_FILES} archivos.`; return; }
 selectedFiles=picked; describeFiles(); hideAlert();
});
document.querySelectorAll('[data-chat-contact]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-chat-contact]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelector('[data-chat-title]').textContent=btn.dataset.chatContact;document.querySelector('[data-chat-state]').textContent=btn.dataset.chatStatus;}));
/* RF-291: envio real. El handler anterior solo fabricaba una fila local con el
   un aviso local de adjunto y no llamaba a la API. Ahora se envia el mismo
   multipart que espera el endpoint publicado: campo 'files' para los adjuntos y
   'contenido' para el texto. api.form ya pasa el FormData sin Content-Type. */
async function sendChatMessage(){
 if(activeConversationId===null){ setChatState('Abre una conversacion antes de enviar.'); return false; }
 if(!token()){ location.href='login.html'; return false; }
 const text=(input?.value||'').trim();
 if(!text && !selectedFiles.length){ alertBox?.classList.remove('cc-hidden'); return false; }
 if(text.length>1000){ setChatState('El mensaje no puede superar 1000 caracteres.'); return false; }
 const payload=new FormData();
 if(text) payload.append('contenido',text);
 selectedFiles.forEach(file=>payload.append('files',file,file.name));
 const submitBtn=form?.querySelector('[type="submit"]');
 if(submitBtn) submitBtn.disabled=true;
 setChatState(selectedFiles.length?'Enviando mensaje y adjuntos...':'Enviando mensaje...');
 try{
  const response=await api.form(`/chat/conversations/${encodeURIComponent(activeConversationId)}/messages`,payload);
  const created=response?.data?.message;
  if(!created || created.id===undefined || created.id===null) throw new Error('El servidor no devolvio el mensaje.');
  // El id proviene SOLO de la respuesta real del endpoint (regla de RF-278).
  realMessageIds.add(String(created.id));
  if(messages){
   const placeholder=messages.querySelector('.cc-muted');
   if(placeholder && !messages.querySelector('[data-chat-message]')) messages.innerHTML='';
   messages.insertAdjacentHTML('beforeend',messageRowHtml(created));
   hydrateAttachments(messages);  // RNF-006
   messages.scrollTop=messages.scrollHeight;
  }
  if(input) input.value='';
  clearFiles();
  hideAlert();
  renderHeaderPresence(activeConversationId);
  return true;
 }catch(error){
  const code=Number(error?.status ?? error?.statusCode ?? 0);
  if(code===401){ location.href='login.html'; return false; }
  if(code===404) setChatState('Conversacion no encontrada o no participas en ella.');
  else setChatState(`No fue posible enviar el mensaje. ${error?.message || ''}`.trim());
  return false;
 }finally{
  if(submitBtn) submitBtn.disabled=false;
 }
}
form?.addEventListener('submit',event=>{ event.preventDefault(); sendChatMessage(); });

/* ── RF-278: integracion minima de lectura y reporte de mensajes ──
   Solo consume GET /chat/conversations, GET /chat/conversations/:id/messages
   y PATCH /chat/messages/:id/report. El composer visual anterior se conserva. */
const conversationList=document.querySelector('.cc-chat-list');
const chatTitle=document.querySelector('[data-chat-title]');
const chatState=document.querySelector('[data-chat-state]');
// Solo se puede reportar un id devuelto por el endpoint real de mensajes.
const realMessageIds=new Set();
let activeConversationId=null;
/* RNF-006: los adjuntos ya no viven en /uploads, que era publico. El backend
   entrega download_url hacia un endpoint que autoriza por participante, y el
   navegador NO adjunta la cabecera Authorization a un <img src>, asi que hay
   que descargarlos con api.blob() y usar un object URL.

   Esta funcion sustituye a chatFileUrl(), que ademas arrastraba un error de
   sintaxis desde 991103e: en `if(/^https?:///i.test(raw))` la regex literal
   cerraba en la segunda barra y `//i.test(raw))` quedaba como comentario, de
   modo que el `if(` nunca se cerraba y el modulo entero no cargaba.

   Solo se acepta la forma exacta del endpoint protegido: nunca se construye un
   destino a partir de un valor arbitrario, para no convertir un javascript: o
   un data: en algo navegable. */
function chatDownloadPath(file){
 const raw=String(file?.download_url ?? '').trim();
 return /^\/api\/v1\/chat\/attachments\/[0-9]+$/.test(raw) ? raw.replace('/api/v1','') : null;
}
/* Cada adjunto abierto retiene su Blob en memoria hasta que se revoca; se
   liberan todos al cambiar de conversacion. */
const chatObjectUrls=new Set();
function revokeChatObjectUrls(){
 chatObjectUrls.forEach(u=>{ try{ URL.revokeObjectURL(u); }catch(e){ /* ya revocado */ } });
 chatObjectUrls.clear();
}
async function chatAttachmentUrl(path){
 const blob=await api.blob(path);
 const url=URL.createObjectURL(blob);
 chatObjectUrls.add(url);
 return url;
}
function chatFileSize(bytes){
 const n=Number(bytes);
 if(!Number.isFinite(n)||n<=0) return '';
 if(n<1024) return `${n} B`;
 if(n<1024*1024) return `${(n/1024).toFixed(0)} KB`;
 return `${(n/(1024*1024)).toFixed(1)} MB`;
}
/* RNF-006: el marcado ya no lleva la URL del fichero. Se emite un marcador con
   el path protegido en data-*, y el contenido se pide con api.blob() despues:
   las imagenes cuando entran en pantalla y los documentos solo al pulsarlos.

   Precargar todo seria caro: hasta 5 adjuntos por mensaje y 10 MB cada uno, por
   50 mensajes de historial.

   Aqui tambien se corrige el segundo error de sintaxis de 991103e:
   `/^image//.test(...)` cerraba la regex en la segunda barra y dejaba una
   division por `.test(...)`. El primero lo enmascaraba. */
function esImagen(mime){ return /^image\//.test(String(mime || '')); }
function attachmentsHtml(archivos){
 if(!Array.isArray(archivos)||!archivos.length) return '';
 const items=archivos.map(file=>{
  const path=chatDownloadPath(file);
  const name=chatEsc(file?.nombre_original || 'Archivo adjunto');
  const size=chatFileSize(file?.size_bytes);
  const meta=size?` <span class="text-slate-400">(${chatEsc(size)})</span>`:'';
  if(!path) return `<li class="text-xs text-slate-400">${name}${meta}</li>`;
  const p=chatEsc(path);
  if(esImagen(file?.mime_type)){
   return `<li class="text-xs mt-1">${name}${meta}<span class="cc-chat-attachment-img max-h-40 rounded-lg mt-1 block text-slate-400" data-chat-image="${p}" data-chat-name="${name}">Cargando imagen...</span></li>`;
  }
  return `<li class="text-xs mt-1"><button type="button" class="underline text-[#2276ff]" data-chat-file="${p}" data-chat-name="${name}">${name}</button>${meta}</li>`;
 }).join('');
 return `<ul class="cc-chat-attachments mt-1">${items}</ul>`;
}
/* Las imagenes se traen cuando entran en viewport; si no hay IntersectionObserver
   se cargan directamente. Cada marcador se procesa una sola vez. */
function hydrateAttachments(root){
 if(!root) return;
 const pendientes=root.querySelectorAll('[data-chat-image]:not([data-chat-done])');
 const cargar=async (el)=>{
  el.setAttribute('data-chat-done','1');
  try{
   const url=await chatAttachmentUrl(el.getAttribute('data-chat-image'));
   const img=document.createElement('img');
   img.className='cc-chat-attachment-img max-h-40 rounded-lg mt-1';
   img.alt=el.getAttribute('data-chat-name')||'';
   img.src=url;
   el.replaceWith(img);
  }catch(error){ el.textContent='No fue posible cargar la imagen.'; }
 };
 if(typeof IntersectionObserver!=='function'){ pendientes.forEach(cargar); return; }
 const obs=new IntersectionObserver(entries=>{
  entries.forEach(e=>{ if(e.isIntersecting){ obs.unobserve(e.target); cargar(e.target); } });
 });
 pendientes.forEach(el=>obs.observe(el));
}
/* Los documentos solo se descargan al pulsarlos, conservando nombre_original. */
document.addEventListener('click', async (e)=>{
 const btn=e.target.closest?.('[data-chat-file]');
 if(!btn) return;
 const etiqueta=btn.textContent;
 btn.textContent='Descargando...';
 try{
  const url=await chatAttachmentUrl(btn.getAttribute('data-chat-file'));
  const a=document.createElement('a');
  a.href=url; a.download=btn.getAttribute('data-chat-name')||'adjunto';
  document.body.appendChild(a); a.click(); a.remove();
 }catch(error){ setChatState('No fue posible descargar el archivo.'); }
 btn.textContent=etiqueta;
});
function chatEsc(value){ return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function setChatState(text){ if(chatState) chatState.textContent=text; }
/* ── RF-288: estado de conexion en linea / fuera de linea ──
   El booleano lo calcula el servidor con su propio reloj; aqui solo se pinta.
   Se refresca con la lista de conversaciones, sin transporte en tiempo real. */
const presenceByConversation=new Map();
function presenceLabel(online){ return online?'En linea':'Fuera de linea'; }
function presenceBadgeHtml(online){
 const on=online===true;
 return `<span class="inline-flex items-center gap-1 text-xs font-semibold ${on?'text-emerald-600':'text-slate-400'}" data-chat-presence="${on?'1':'0'}"><span class="w-2 h-2 rounded-full ${on?'bg-emerald-500':'bg-slate-400'}"></span>${presenceLabel(on)}</span>`;
}
function renderHeaderPresence(conversationId){
 if(!chatState) return;
 const online=presenceByConversation.get(String(conversationId));
 if(online===undefined) return;
 chatState.innerHTML=presenceBadgeHtml(online);
}
function setChatTitle(text){ if(chatTitle) chatTitle.textContent=text; }
function conversationLabel(conversation){
  return conversation?.producto_nombre || conversation?.tienda_nombre || conversation?.vendedor_nombre || conversation?.comprador_nombre || `Conversacion ${conversation?.id ?? ''}`.trim();
}
function conversationButtonHtml(conversation){
  const label=chatEsc(conversationLabel(conversation));
  const last=chatEsc(conversation?.ultimo_mensaje || 'Sin mensajes');
  return `<button class="cc-conversation w-full p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left flex items-center gap-3 transition-all" type="button" data-chat-contact="${label}" data-chat-conversation="${chatEsc(conversation?.id)}"><img class="cc-avatar w-10 h-10 rounded-full bg-orange-100 p-2" src="assets/icons/cc-chat-messages.svg" alt=""><div class="flex-1 overflow-hidden"><b class="text-sm font-bold text-slate-900 dark:text-white block truncate Poppins">${label}</b><small class="text-xs text-slate-400 block truncate">${last}</small>${presenceBadgeHtml(conversation?.contraparte_en_linea===true)}</div></button>`;
}
function isOwnMessage(message){
 const me=currentUser();
 return Boolean(me && message && String(me.id)===String(message.emisor_id));
}
function messageRowHtml(message){
  const id=message?.id;
  const body=message?.eliminado?'<i>Mensaje eliminado</i>':chatEsc(message?.mensaje ?? message?.contenido ?? '[archivo]');
  const author=chatEsc(message?.emisor_nombre || 'Usuario');
  const reported=message?.reportado===true||message?.reportado===1;
  const action=message?.eliminado?'':(reported
    ? `<span class="cc-chip orange" data-chat-reported="${chatEsc(id)}">Reportado</span>`
    : `<button class="cc-btn outline text-xs" type="button" data-chat-report="${chatEsc(id)}">Reportar mensaje</button>`);
  /* RF-293: eliminar solo se ofrece sobre los mensajes propios, porque el
     servidor responde 403 a quien no es el emisor. Ocultarlo es cortesia, no
     seguridad: la autorizacion sigue siendo del servidor. */
  const mine=isOwnMessage(message);
  const deleteAction=(!message?.eliminado && mine)
    ? `<button class="cc-btn secondary text-xs" type="button" data-chat-delete="${chatEsc(id)}">Eliminar mensaje</button>`
    : '';
  return `<div class="cc-message-row" data-chat-message="${chatEsc(id)}"><article class="cc-message"><b class="text-xs text-slate-500 dark:text-slate-400 block">${author}</b><p>${body}</p>${message?.eliminado?'':attachmentsHtml(message?.archivos)}<time class="text-xs text-slate-400">${chatEsc(message?.created_at ?? message?.creado_en ?? '')}</time><div class="cc-card-actions-row mt-2">${action}${deleteAction}</div></article></div>`;
}
async function loadChatMessages(conversationId){
  if(!messages) return;
  revokeChatObjectUrls();  // RNF-006: libera los blobs de la conversacion anterior
  activeConversationId=conversationId;
  messages.innerHTML='<p class="cc-muted">Cargando mensajes...</p>';
  try{
    const response=await api.get(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`);
    const payload=response.data||{};
    const list=Array.isArray(payload.messages)?payload.messages:[];
    realMessageIds.clear();
    list.forEach(item=>{ if(item?.id!==undefined&&item?.id!==null) realMessageIds.add(String(item.id)); });
    messages.innerHTML=list.length?list.map(messageRowHtml).join(''):'<p class="cc-muted">Esta conversacion no tiene mensajes.</p>';
    hydrateAttachments(messages);  // RNF-006
    if(payload.conversation) setChatTitle(conversationLabel(payload.conversation));
    // RF-288: el encabezado pasa a mostrar el estado de conexion de la contraparte.
    if(payload.conversation && payload.conversation.contraparte_en_linea!==undefined){
      presenceByConversation.set(String(conversationId), payload.conversation.contraparte_en_linea===true);
      renderHeaderPresence(conversationId);
    } else {
      setChatState(`${list.length} mensaje${list.length===1?'':'s'}`);
    }
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
/* RF-293: eliminar un mensaje inapropiado. DELETE /chat/messages/:id ya estaba
   publicado pero no existia ningun control en la interfaz. El borrado es suave
   en el servidor (eliminado=TRUE, contenido=NULL): la fila del historial se
   conserva, por eso la fila se actualiza en el sitio en lugar de quitarla. */
/* RNF-020: confirmacion personalizada para borrar un mensaje.

   Era la unica llamada a un dialogo nativo que quedaba en todo el frontend
   (window.alert y window.prompt ya estaban a cero). El modal sigue el patron
   ya probado en carrito y privacidad: contenedor singleton con role=dialog,
   aria-modal, overlay propio y cierre por Cancelar, Escape o backdrop.

   Solo devuelve la decision del usuario: no conoce el id del mensaje ni llama
   a la API, de modo que la mutacion sigue viviendo entera en
   deleteChatMessage() y el borrado suave del servidor no cambia. */
let deleteConfirmModal=null;
let pendingDeleteConfirmation=null;
let deleteConfirmTrigger=null;

function cerrarConfirmacionBorrado(decision){
 if(!deleteConfirmModal) return;
 deleteConfirmModal.classList.add('hidden');
 const resolver=pendingDeleteConfirmation;
 const disparador=deleteConfirmTrigger;
 pendingDeleteConfirmation=null;
 deleteConfirmTrigger=null;
 // El foco vuelve a donde estaba el usuario, no al principio del documento.
 if(disparador && typeof disparador.focus==='function' && disparador.isConnected) disparador.focus();
 if(resolver) resolver(Boolean(decision));
}

function crearConfirmacionBorrado(){
 if(deleteConfirmModal) return deleteConfirmModal;
 const caja=document.createElement('div');
 caja.className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 hidden';
 caja.setAttribute('role','dialog');
 caja.setAttribute('aria-modal','true');
 caja.setAttribute('aria-labelledby','chatDeleteTitle');
 caja.setAttribute('aria-describedby','chatDeleteText');
 caja.innerHTML='<div class="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-xl border border-slate-200 dark:border-slate-800">'
  +'<h2 id="chatDeleteTitle" class="text-xl font-bold mb-4 text-slate-900 dark:text-white Poppins">Eliminar mensaje?</h2>'
  +'<p id="chatDeleteText" class="text-sm text-slate-700 dark:text-slate-300 mb-6">Se eliminara el contenido de este mensaje y no se puede deshacer.</p>'
  +'<div class="flex items-center gap-3 justify-end">'
  +'<button type="button" class="cc-btn outline" data-chat-delete-cancel>Cancelar</button>'
  +'<button type="button" class="cc-btn danger" data-chat-delete-confirm>Eliminar mensaje</button>'
  +'</div></div>';
 document.body.appendChild(caja);
 caja.querySelector('[data-chat-delete-cancel]').addEventListener('click',()=>cerrarConfirmacionBorrado(false));
 caja.querySelector('[data-chat-delete-confirm]').addEventListener('click',()=>cerrarConfirmacionBorrado(true));
 caja.addEventListener('click',event=>{ if(event.target===caja) cerrarConfirmacionBorrado(false); });
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape') return;
  if(deleteConfirmModal && !deleteConfirmModal.classList.contains('hidden')) cerrarConfirmacionBorrado(false);
 });
 deleteConfirmModal=caja;
 return caja;
}

function confirmDeleteChatMessage(button){
 const caja=crearConfirmacionBorrado();
 // Una confirmacion a la vez: si quedaba otra abierta, se resuelve como cancelada.
 if(pendingDeleteConfirmation) cerrarConfirmacionBorrado(false);
 deleteConfirmTrigger=button||null;
 caja.classList.remove('hidden');
 // Foco inicial en la accion segura.
 caja.querySelector('[data-chat-delete-cancel]').focus();
 return new Promise(resolve=>{ pendingDeleteConfirmation=resolve; });
}

async function deleteChatMessage(button){
 const id=button?.dataset?.chatDelete;
 // Mismo criterio que el reporte: solo un id devuelto por el endpoint real.
 if(!id || !realMessageIds.has(String(id))){ setChatState('Solo puedes eliminar mensajes cargados desde el servidor.'); return false; }
 if(!await confirmDeleteChatMessage(button)) return false;
 button.disabled=true;
 setChatState('Eliminando el mensaje...');
 try{
  await api.delete(`/chat/messages/${encodeURIComponent(id)}`);
  const row=messages?.querySelector(`[data-chat-message="${CSS.escape(String(id))}"]`);
  if(row){
   // No se repinta desde la respuesta: deleteMessage devuelve la fila cruda, sin
   // emisor_nombre ni archivos, y repintarla perderia el autor.
   const body=row.querySelector('p');
   if(body) body.innerHTML='<i>Mensaje eliminado</i>';
   row.querySelector('.cc-chat-attachments')?.remove();
   row.querySelector('.cc-card-actions-row')?.remove();
  }
  setChatState('Mensaje eliminado.');
  return true;
 }catch(error){
  button.disabled=false;
  const code=Number(error?.status ?? error?.statusCode ?? 0);
  if(code===403) setChatState('Solo el emisor puede eliminar este mensaje.');
  else if(code===404) setChatState('Mensaje no encontrado o no participas en esta conversacion.');
  else if(code===401) location.href='login.html';
  else setChatState(`No fue posible eliminar el mensaje. ${error?.message || ''}`.trim());
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
    presenceByConversation.clear();
    list.forEach(item=>{ if(item?.id!==undefined&&item?.id!==null) presenceByConversation.set(String(item.id), item.contraparte_en_linea===true); });
    conversationList.innerHTML=list.map(conversationButtonHtml).join('');
    // RF-287: si se llega desde producto, pedido o perfil de tienda, abrir esa
    // conversacion; si no viene o no pertenece al usuario, abrir la primera.
    const requested=new URLSearchParams(location.search).get('conversacion');
    const target=(requested && conversationList.querySelector(`[data-chat-conversation="${CSS.escape(String(requested))}"]`))
      || conversationList.querySelector('[data-chat-conversation]');
    if(target){ target.classList.add('active'); setChatTitle(target.dataset.chatContact); await loadChatMessages(target.dataset.chatConversation); }
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
  const reportBtn=event.target.closest('[data-chat-report]');
  if(reportBtn){ reportChatMessage(reportBtn); return; }
  const deleteBtn=event.target.closest('[data-chat-delete]'); // RF-293
  if(deleteBtn) deleteChatMessage(deleteBtn);
});
/* RF-288: refresco periodico del estado de conexion. No hay transporte en
   tiempo real en el proyecto, asi que se reconsulta la lista y se actualizan
   solo las insignias, sin volver a pintar la lista ni perder la conversacion
   abierta ni el scroll de los mensajes. */
const PRESENCE_REFRESH_MS=60000;
async function refreshPresence(){
 if(!conversationList || !token()) return;
 try{
  const response=await api.get('/chat/conversations');
  const list=Array.isArray(response.data?.conversations)?response.data.conversations:[];
  list.forEach(item=>{
   if(item?.id===undefined||item?.id===null) return;
   const online=item.contraparte_en_linea===true;
   presenceByConversation.set(String(item.id),online);
   const row=conversationList.querySelector(`[data-chat-conversation="${CSS.escape(String(item.id))}"]`);
   const badge=row?.querySelector('[data-chat-presence]');
   if(badge) badge.outerHTML=presenceBadgeHtml(online);
  });
  if(activeConversationId!==null) renderHeaderPresence(activeConversationId);
 }catch(error){
  // Un fallo de refresco no debe alterar la conversacion abierta.
 }
}
window.setInterval(refreshPresence,PRESENCE_REFRESH_MS);
loadChatConversations();
