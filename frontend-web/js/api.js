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

function normalizeError(data, status){
  if(data?.message) return data.message;
  if(Array.isArray(data?.errors) && data.errors[0]?.message) return data.errors[0].message;
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

export const api={
  request,
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
