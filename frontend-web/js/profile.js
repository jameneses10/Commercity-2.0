import { api, currentUser, token, updateStoredUser } from './api.js';
import { showMessage } from './ui.js';
import { processImageFileToWebP } from './image-converter.js';
import { UPLOADS_BASE_URL } from './config.js';

let pendingAvatarWebP = null;

function imgUrl(value, fallback = 'assets/icons/cc-user-avatar.svg') {
  if (!value) return fallback;
  const s = String(value).trim();
  if (s.startsWith('//')) return fallback;
  if (s.startsWith('/uploads')) return `${UPLOADS_BASE_URL}${s.replace('/uploads', '')}`;
  if (s.startsWith('/')) return `${UPLOADS_BASE_URL}/${s.replace(/^\/+/, '')}`;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('blob:')) return s;
  if (s.match(/^data:image\/(jpeg|png|webp);base64,/i)) return s;
  return fallback;
}

function renderProfile(user){
  if(!user) return;
  document.querySelectorAll('[data-profile-name]').forEach(el=>{ el.textContent=user.nombre || 'Usuario CommerCity'; });
  document.querySelectorAll('[data-profile-email]').forEach(el=>{ el.textContent=user.correo || 'correo no disponible'; });
  document.querySelectorAll('[data-profile-role]').forEach(el=>{ el.textContent=user.rol || 'comprador'; });
  document.querySelectorAll('[data-profile-status]').forEach(el=>{ el.textContent=user.estado || 'activo'; });

  const avatarUrl = imgUrl(user.foto_perfil_url);
  document.querySelectorAll('[data-profile-avatar], #profileAvatarImg').forEach(img => {
    img.src = avatarUrl;
    if(user.foto_perfil_url) {
      img.classList.remove('object-contain', 'p-1', 'p-2');
      img.classList.add('object-cover', 'w-full', 'h-full');
    }
  });

  const form=document.querySelector('[data-profile-form]');
  if(form){
    form.querySelector('[name="nombre"]')?.setAttribute('value', user.nombre || '');
    form.querySelector('[name="correo"]')?.setAttribute('value', user.correo || '');
    form.querySelector('[name="telefono"]')?.setAttribute('value', user.telefono || '');
  }
}

/* Ã¢â€â‚¬Ã¢â€â‚¬ DelegaciÃƒÂ³n Global de Eventos para Foto de Perfil (Infallable) Ã¢â€â‚¬Ã¢â€â‚¬ */
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('#btnChangeAvatar, #profileAvatarWrap');
  if (trigger) {
    const input = document.getElementById('profileAvatarInput');
    if (input) input.click();
  }
});

document.addEventListener('change', async (e) => {
  if (e.target && e.target.id === 'profileAvatarInput') {
    pendingAvatarWebP = null;
    const file = e.target.files?.[0];
    if (!file) return;

    // 1. Validar lÃƒÂ­mite estricto de 3MB
    if (file.size > 3 * 1024 * 1024) {
      const currentMB = (file.size / (1024 * 1024)).toFixed(2);
      showMessage('#profileMsg', `La imagen excede el lÃƒÂ­mite mÃƒÂ¡ximo permitido de 3MB (TamaÃƒÂ±o actual: ${currentMB}MB). Elige una imagen mÃƒÂ¡s liviana.`);
      e.target.value = '';
      return;
    }

    const avatarImgs = document.querySelectorAll('[data-profile-avatar], #profileAvatarImg');

    // 2. Despliegue InstantÃƒÂ¡neo en DOM (0ms) mediante Object URL
    const tempObjectUrl = URL.createObjectURL(file);
    avatarImgs.forEach(img => {
      img.src = tempObjectUrl;
      img.classList.remove('object-contain', 'p-1', 'p-2');
      img.classList.add('object-cover', 'w-full', 'h-full');
    });

    // 3. ConversiÃƒÂ³n de alta fidelidad a formato WebP
    try {
      const result = await processImageFileToWebP(file, 3);
      pendingAvatarWebP = result.file;
      avatarImgs.forEach(img => { img.src = result.dataUrl; });
      showMessage('#profileMsg', `Foto de perfil preparada en formato WebP (${result.webpName}, Peso: ${result.webpSizeMB}MB). Guarda los cambios para aplicarla.`, true);
    } catch (err) {
      pendingAvatarWebP = null;
      showMessage('#profileMsg', err.message || 'Error procesando la imagen de perfil.');
    } finally {
      URL.revokeObjectURL(tempObjectUrl);
      e.target.value = '';
    }
  }
});

export async function initProfile(){
  const box=document.querySelector('[data-profile-root]');
  if(!box) return;

  const form = document.querySelector('[data-profile-form]');
  if(form){
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if(btn) btn.disabled = true;
      try {
        if (pendingAvatarWebP === null) {
          showMessage('#profileMsg', 'No hay cambios para guardar.', true);
          return;
        }

        const fd = new FormData();
        fd.append('foto', pendingAvatarWebP, pendingAvatarWebP.name);

        const res = await api.patch('/profiles/me', fd);
        const profileResponse = res?.data?.profile || res?.profile;
        if(profileResponse) {
           const u = currentUser() || {};
           const updatedUser = {
             ...u,
             foto_perfil_url: profileResponse.foto_perfil_url || profileResponse.foto_url || u.foto_perfil_url,
             descripcion_personal: profileResponse.descripcion_personal || u.descripcion_personal
           };
           updateStoredUser(updatedUser);
           renderProfile(updatedUser);
        }
        pendingAvatarWebP = null;
        showMessage('#profileMsg', 'Perfil actualizado correctamente.', true);
      } catch (err) {
        showMessage('#profileMsg', err.message || 'No se pudo actualizar el perfil.');
      } finally {
        if(btn) btn.disabled = false;
      }
    });
  }

  if(!token()){
    showMessage('#profileMsg','Inicia sesiÃƒÂ³n para ver tu perfil real.');
    renderProfile(currentUser());
    return;
  }
  try{
    const data=await api.get('/auth/me');
    const user=data?.data?.user || data?.user;
    updateStoredUser(user);
    renderProfile(user);
    showMessage('#profileMsg','Perfil real cargado desde la API.',true);
  }catch(error){
    renderProfile(currentUser());
    showMessage('#profileMsg',error.message || 'No pudimos cargar el perfil real.');
  }
}

initProfile();
