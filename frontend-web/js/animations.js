/**
 * animations.js — CommerCity
 * Módulo de animaciones de entrada para scroll (IntersectionObserver).
 * No modifica lógica de negocio ni llamadas a API.
 */

/**
 * revealOnScroll — aplica animación cc-reveal-up a elementos cuando entran al viewport.
 * @param {string} selector — selector CSS de los elementos a animar
 * @param {number} delayStep — delay incremental por elemento (ms), 0 = sin delay escalonado
 */
export function revealOnScroll(selector = '.cc-product, .cc-card, .cc-kpi, .cc-metric-card-v2', delayStep = 60) {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;

  // Respeta preferencia del usuario
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const els = document.querySelectorAll(selector);
  if (!els.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const delay = prefersReduced ? 0 : (parseInt(el.dataset.revealDelay) || 0);

      if (prefersReduced) {
        el.style.opacity = '1';
        el.style.transform = 'none';
      } else {
        setTimeout(() => {
          el.style.animation = `cc-reveal-up 420ms cubic-bezier(.4,0,.2,1) ${delay}ms both`;
        }, 0);
      }
      io.unobserve(el);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });

  els.forEach((el, i) => {
    if (!el.style.opacity && !prefersReduced) {
      el.style.opacity = '0';
    }
    // Asigna delay escalonado por posición en grid
    if (delayStep > 0 && !el.dataset.revealDelay) {
      el.dataset.revealDelay = Math.min(i * delayStep, 360); // máximo 360ms
    }
    io.observe(el);
  });
}

/**
 * animateNumber — anima un número desde 0 hasta el valor objetivo.
 * Útil para métricas de dashboard.
 * @param {HTMLElement} el — elemento cuyo textContent se animará
 * @param {number} target — valor final
 * @param {number} duration — duración en ms
 * @param {Function} formatter — función de formato (default: número entero con separadores)
 */
export function animateNumber(el, target, duration = 800, formatter = null) {
  if (!el) return;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = formatter || ((n) => new Intl.NumberFormat('es-CO').format(Math.round(n)));

  if (prefersReduced) { el.textContent = fmt(target); return; }

  const start = performance.now();
  const initial = 0;

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Easing out-quart
    const eased = 1 - Math.pow(1 - progress, 4);
    el.textContent = fmt(initial + (target - initial) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

/**
 * animateMetrics — busca elementos [data-metric-value] y anima sus números.
 * Compatible con el dashboard de vendedor y admin.
 */
export function animateMetrics() {
  document.querySelectorAll('[data-metric-value]').forEach(el => {
    const raw = el.getAttribute('data-metric-value');
    // Soporte para valores con símbolo de moneda: "3600000" o "$3.6M"
    const numeric = parseFloat(raw.replace(/[^0-9.]/g, ''));
    if (isNaN(numeric)) return;

    const isMoney = raw.includes('$') || el.closest('[data-metric-money]');
    const formatter = isMoney
      ? (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
      : (n) => new Intl.NumberFormat('es-CO').format(Math.round(n));

    animateNumber(el, numeric, 900, formatter);
  });
}

/**
 * initProgressBars — anima barras de progreso (.cc-metric-bar, .cc-stock-bar)
 * desde 0 hasta su width objetivo definido en style o data-width.
 */
export function initProgressBars() {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.cc-metric-bar, .cc-stock-bar').forEach(bar => {
    const targetWidth = bar.dataset.width || bar.style.width || '0%';
    if (prefersReduced) { bar.style.width = targetWidth; return; }
    bar.style.width = '0%';
    // Trigger en próximo frame para que la transición CSS se aplique
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.style.width = targetWidth;
      });
    });
  });
}



/**
 * lazyLoadImages — observa imágenes con [data-src] y las carga cuando entran al viewport.
 */
export function lazyLoadImages(selector = 'img[data-src]') {
  if (!('IntersectionObserver' in window)) {
    // Fallback: carga inmediata
    document.querySelectorAll(selector).forEach(img => {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    });
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
      img.classList.add('loaded');
      io.unobserve(img);
    });
  }, { rootMargin: '200px' });

  document.querySelectorAll(selector).forEach(img => io.observe(img));
}
