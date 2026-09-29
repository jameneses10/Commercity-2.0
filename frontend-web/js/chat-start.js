import { api, token, currentUser } from './api.js';

/* ── RF-287: inicio del chat interno comprador-vendedor ──
   Control unico y compartido por las tres superficies canonicas: detalle del
   producto, detalle del pedido y perfil de la tienda. Solo compone el contexto
   ya publicado por POST /chat/conversations (producto_id | tienda_id); el
   servidor deriva tienda y vendedor y fuerza comprador_id = usuario en sesion.
   No existe pedido_id en el contrato publicado: el pedido se resuelve a la
   tienda del detalle, sin endpoint nuevo ni columna nueva. */

function chatStartEsc(value){ return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }

function positiveId(value){
  const parsed=Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// El servidor rechaza con 400 una conversacion con uno mismo, asi que no se
// ofrece la accion. Mismo criterio que user-report.js isSelf().
function isOwnSeller(vendedorId){
  const me=currentUser();
  return Boolean(me && vendedorId !== null && vendedorId !== undefined && String(me.id) === String(vendedorId));
}

// Un vendedor debe indicar comprador_id y un administrador ambos extremos, por
// lo que esta superficie publica solo aplica al comprador y al invitado.
function chatStartApplies(vendedorId){
  if(isOwnSeller(vendedorId)) return false;
  const me=currentUser();
  if(me && me.rol !== 'comprador') return false;
  return true;
}

/* Devuelve '' cuando no hay contexto util o cuando el servidor rechazaria la
   accion, para no mostrar un boton muerto. */
export function chatStartButton({ producto_id=null, tienda_id=null, vendedor_id=null, label='Contactar vendedor', variant='secondary' }={}){
  const producto=positiveId(producto_id);
  const tienda=positiveId(tienda_id);
  if(producto===null && tienda===null) return '';
  if(!chatStartApplies(vendedor_id)) return '';
  const context=producto!==null ? `data-chat-start-producto="${producto}"` : `data-chat-start-tienda="${tienda}"`;
  return `<button class="cc-btn ${chatStartEsc(variant)}" type="button" data-chat-start ${context}>${chatStartEsc(label)}</button>`;
}

async function openConversation(button){
  const producto=positiveId(button.dataset.chatStartProducto);
  const tienda=positiveId(button.dataset.chatStartTienda);
  if(producto===null && tienda===null) return false;
  if(!token()){ location.href='login.html'; return false; }
  if(button.dataset.chatStartBusy==='true') return false;
  button.dataset.chatStartBusy='true';
  button.disabled=true;
  button.setAttribute('aria-busy','true');
  const original=button.textContent;
  button.textContent='Abriendo chat...';
  try{
    const payload=producto!==null ? { producto_id:producto } : { tienda_id:tienda };
    const response=await api.post('/chat/conversations',payload);
    const conversation=response?.data?.conversation || response?.data?.conversacion || response?.data || {};
    const id=positiveId(conversation.id);
    if(id===null) throw new Error('El servidor no devolvio la conversacion.');
    location.href=`chat.html?conversacion=${encodeURIComponent(id)}`;
    return true;
  }catch(error){
    const code=Number(error?.status ?? error?.statusCode ?? 0);
    if(code===401) location.href='login.html';
    else {
      button.dataset.chatStartBusy='false';
      button.disabled=false;
      button.removeAttribute('aria-busy');
      button.textContent=original;
      console.warn('No fue posible abrir el chat interno.', error?.message || error);
    }
    return false;
  }
}

let delegated=false;

/* Delegacion unica en document: sirve a cualquier control insertado despues. */
export function bindChatStart(){
  if(delegated) return;
  delegated=true;
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-chat-start]');
    if(button) openConversation(button);
  });
}
