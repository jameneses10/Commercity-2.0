import { API_BASE_URL, API_ORIGIN } from './config.js';

export function token(){
  return localStorage.getItem('cc_token') || '';
}

export function currentUser(){
  try { return JSON.parse(localStorage.getItem('cc_user') || 'null'); } catch { return null; }
}

function unwrapSession(data){
  const payload=data?.data || data || {};
  return {
    token: payload.token || data?.token || '',
    user: payload.user || data?.user || null
  };
}

export function saveSession(data){
  const session=unwrapSession(data);
  if(session.token) localStorage.setItem('cc_token', session.token);
  if(session.user) localStorage.setItem('cc_user', JSON.stringify(session.user));
  return session;
}

export function updateStoredUser(user){
  if(user) localStorage.setItem('cc_user', JSON.stringify(user));
  return user;
}

export function clearSession(){
  localStorage.removeItem('cc_token');
  localStorage.removeItem('cc_user');
}

export function authHeaders(){
  const jwt=token();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

/* RNF-024: los 19 controladores responden a un fallo de validación con un
   `message` genérico ("Datos de entrada inválidos.") y el detalle útil en
   `errors[]`. Dar prioridad a `message` escondía los 121 mensajes específicos
   del backend, así que aquí se invierte el orden.
   El detalle, en cambio, no siempre está listo para mostrarse: las reglas sin
   `withMessage` dejan el "Invalid value" por defecto de express-validator, y
   algunos mensajes empiezan por el nombre interno del campo (categoria_id,
   page, items). Los mapas de abajo traducen SOLO esos casos; un mensaje ya
   correcto como "El precio debe ser mayor que cero." pasa intacto. */
const CAMPO_NEUTRO='Revisa el valor ingresado en este campo.';
const CAMPOS={
  correo:'El correo electrónico ingresado no es válido.',
  telefono:'El teléfono ingresado no es válido.',
  direccion:'La dirección ingresada no es válida.',
  departamento:'El departamento ingresado no es válido.',
  ciudad:'La ciudad ingresada no es válida.',
  nombre:'El nombre ingresado no es válido.',
  descripcion:'La descripción ingresada no es válida.',
  precio:'El precio ingresado no es válido.',
  stock:'El stock ingresado no es válido.',
  password:'La contraseña ingresada no es válida.',
  confirmPassword:'La confirmación de contraseña no es válida.',
  fecha_nacimiento:'La fecha de nacimiento no es válida.',
  producto_id:'El producto seleccionado no es válido.',
  product_id:'El producto seleccionado no es válido.',
  pedido_id:'El pedido seleccionado no es válido.',
  direccion_id:'La dirección seleccionada no es válida.',
  categoria_id:'La categoría seleccionada no es válida.',
  tienda_id:'La tienda seleccionada no es válida.',
  comprador_id:'El comprador seleccionado no es válido.',
  vendedor_id:'El vendedor seleccionado no es válido.',
  estrellas:'La calificación ingresada no es válida.',
  page:'La página solicitada no es válida.',
  limit:'La cantidad de resultados por página no es válida.',
  items:'Debes incluir al menos un producto.',
};
/* Mensajes técnicos que llegan como `message` de nivel superior, sin
   `errors[]`, porque los lanza un servicio en vez de un validador. Mapa
   cerrado a propósito: no es un traductor general de errores de negocio. */
const TECNICOS={
  'product_id inválido.':'El producto seleccionado no es válido.',
  'producto_id inválido.':'El producto seleccionado no es válido.',
  'id inválido.':'El identificador solicitado no es válido.',
};
/* Solo se reescribe un mensaje cuando empieza por un nombre interno
   reconocible: con guión bajo, o uno de los tres parámetros de listado. */
function campoTecnico(token){
  const interno=/_/.test(token)||token==='page'||token==='limit'||token==='items';
  return interno ? CAMPOS[token] : null;
}
function friendlyValidationMessage(error){
  const texto=String(error?.message ?? '').trim();
  if(!texto) return '';
  // "Invalid value" es el texto por defecto y no le dice nada al usuario.
  if(/^invalid value$/i.test(texto)) return CAMPOS[error?.field] || CAMPO_NEUTRO;
  // "categoria_id es obligatorio...", "page inválido.", "items debe tener
  // productos.": se sustituye la frase COMPLETA, nunca la palabra sola,
  // porque el artículo no concordaría ("La categoría es obligatorio").
  return campoTecnico(texto.split(/[\s:]+/)[0]) || texto;
}
function normalizeError(data, status){
  const detalle=Array.isArray(data?.errors) ? data.errors.find((e)=>e?.message) : null;
  if(detalle){
    const amable=friendlyValidationMessage(detalle);
    if(amable) return amable;
  }
  if(data?.message){
    const texto=String(data.message).trim();
    return TECNICOS[texto] || texto;
  }
  if(status) return `Solicitud no completada (${status}).`;
  return 'No fue posible completar la solicitud.';
}

async function request(path, options={}){
  const urlObj = path.startsWith('http') ? new URL(path) : new URL(`${API_BASE_URL}${path}`, window.location.origin);
  const destinationOrigin = urlObj.origin;
  const expectedOrigin = new URL(API_ORIGIN).origin;

  if (destinationOrigin !== expectedOrigin) {
    throw new Error('Destino de API no autorizado.');
  }

  const url = urlObj.toString();
  const body=options.body;
  const headers = {
    Accept: 'application/json',
    ...authHeaders(),
    ...(options.headers || {})
  };
  if(body && !(body instanceof FormData)) headers['Content-Type']='application/json';
  let res;
  try{
    res=await fetch(url, {
      ...options,
      headers,
      body: body && !(body instanceof FormData) ? JSON.stringify(body) : body
    });
  }catch(error){
    const e=new Error('No hay conexión con la API de CommerCity.');
    e.cause=error;
    e.isNetworkError=true;
    throw e;
  }
  let data=null;
  const text=await res.text();
  if(text){
    try{ data=JSON.parse(text); }
    catch(error){
      const e=new Error('La API respondió con un formato no válido.');
      e.cause=error;
      e.status=res.status;
      throw e;
    }
  }
  if(!res.ok || data?.ok === false){
    const e=new Error(normalizeError(data,res.status));
    e.status=res.status;
    e.data=data;
    throw e;
  }
  return data || { ok:true, data:null };
}

/* RNF-006: descarga binaria autenticada. Los adjuntos de chat y las evidencias
   de devolucion ya no se sirven por /uploads, asi que un <img src> o un <a href>
   directo no sirve: el navegador no adjunta la cabecera Authorization. Esta
   operacion la adjunta explicitamente y devuelve un Blob.
   Conserva las mismas garantias que request(): valida el origen de destino
   contra la allowlist y NO pone el token en la URL. Un error se sigue leyendo
   como JSON para conservar el mensaje del backend. */
async function blob(path, options={}){
  const urlObj = path.startsWith('http') ? new URL(path) : new URL(`${API_BASE_URL}${path}`, window.location.origin);
  if (urlObj.origin !== new URL(API_ORIGIN).origin) throw new Error('Destino de API no autorizado.');
  let res;
  try{
    res=await fetch(urlObj.toString(), { ...options, method:'GET', headers:{ ...authHeaders(), ...(options.headers||{}) } });
  }catch(error){
    const e=new Error('No hay conexión con la API de CommerCity.');
    e.cause=error; e.isNetworkError=true; throw e;
  }
  if(!res.ok){
    let data=null;
    try{ data=JSON.parse(await res.text()); }catch(error){ /* el error no siempre es JSON */ }
    const e=new Error(normalizeError(data,res.status));
    e.status=res.status; e.data=data; throw e;
  }
  return res.blob();
}

export const api={
  request,
  blob,
  get:(p, options={})=>request(p,{...options,method:'GET'}),
  post:(p,b, options={})=>request(p,{...options,method:'POST',body:b}),
  put:(p,b, options={})=>request(p,{...options,method:'PUT',body:b}),
  patch:(p,b, options={})=>request(p,{...options,method:'PATCH',body:b}),
  delete:(p, options={})=>request(p,{...options,method:'DELETE'}),
  form:(p,b,method='POST', options={})=>request(p,{...options,method,body:b})
};

export function dataOf(response, key){
  const payload=response?.data || response || {};
  if(key && Array.isArray(payload[key])) return payload[key];
  return payload;
}
