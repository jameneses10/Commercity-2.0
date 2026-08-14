function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function browserApiOrigin() {
  const { protocol, hostname, port, origin } = window.location;
  const localHosts = new Set(['localhost', '127.0.0.1']);

  let devFallback = origin;
  if (localHosts.has(hostname)) {
    devFallback = port === '8080' ? 'http://localhost:3000' : origin;
  } else if (port === '8080') {
    devFallback = `${protocol}//${hostname}`;
  }

  const explicit = normalizeOrigin(window.COMMERCITY_API_ORIGIN);
  if (explicit) {
    if (explicit === origin) {
      return explicit;
    }
    if (localHosts.has(hostname) && (explicit === 'http://localhost:3000' || explicit === 'http://127.0.0.1:3000')) {
      return explicit;
    }
  }

  return devFallback;
}

export const API_ORIGIN = browserApiOrigin();
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;
export const UPLOADS_BASE_URL = `${API_ORIGIN}/uploads`;
export const APP_NAME = 'CommerCity';
