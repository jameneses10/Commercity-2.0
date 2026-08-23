const MENUS = {
  comprador: {
    title: 'Comprador',
    items: [
      { key: 'panel', label: 'Panel', href: 'comprador.html', icon: 'cc-user-profile.svg', routes: ['comprador.html'] },
      { key: 'pedidos', label: 'Mis pedidos', href: 'mis-pedidos.html', icon: 'cc-order-history.svg', routes: ['mis-pedidos.html', 'pedido-detalle.html'] },
      { key: 'favoritos', label: 'Favoritos', href: 'favoritos.html', icon: 'cc-favorites-wishlist.svg', routes: ['favoritos.html'] },
      { key: 'direcciones', label: 'Direcciones', href: 'direcciones.html', icon: 'cc-address-location.svg', routes: ['direcciones.html'] },
      { key: 'perfil', label: 'Perfil', href: 'perfil.html', icon: 'cc-user-avatar.svg', routes: ['perfil.html'] },
      { key: 'privacidad', label: 'Privacidad', href: 'cuenta-privacidad.html', icon: 'cc-privacy-security.svg', routes: ['cuenta-privacidad.html'] },
      { key: 'notificaciones', label: 'Notificaciones', href: 'notificaciones.html', icon: 'cc-notifications.svg', routes: ['notificaciones.html'] },
      { key: 'resenas', label: 'Reseñas', href: 'resenas.html', icon: 'cc-rating-star-review.svg', routes: ['resenas.html'] },
      { key: 'devoluciones', label: 'Devoluciones', href: 'devoluciones.html', icon: 'cc-return-request.svg', routes: ['devoluciones.html', 'devolucion-detalle.html'] }
    ]
  },
  vendedor: {
    title: 'Vendedor',
    items: [
      { key: 'panel', label: 'Panel', href: 'vendedor.html', icon: 'cc-store-shopping-bag.svg', routes: ['vendedor.html'] },
      { key: 'tienda', label: 'Mi tienda', href: 'vendedor-tienda.html', icon: 'cc-store-shopping-bag.svg', routes: ['vendedor-tienda.html'] },
      { key: 'productos', label: 'Productos', href: 'vendedor-productos.html', icon: 'cc-products-management.svg', routes: ['vendedor-productos.html'] },
      { key: 'nuevo', label: 'Nuevo producto', href: 'vendedor-producto-form.html', icon: 'cc-create-product.svg', routes: ['vendedor-producto-form.html'] },
      { key: 'pedidos', label: 'Pedidos', href: 'vendedor-pedidos.html', icon: 'cc-order-history.svg', routes: ['vendedor-pedidos.html', 'pedido-detalle.html'] },
      { key: 'envios', label: 'Envíos', href: 'vendedor-envios.html', icon: 'cc-shipping-package.svg', routes: ['vendedor-envios.html'] },
      { key: 'resenas', label: 'Reseñas', href: 'vendedor-resenas.html', icon: 'cc-rating-star-review.svg', routes: ['vendedor-resenas.html'] },
      { key: 'reputacion', label: 'Reputación', href: 'vendedor-reputacion.html', icon: 'cc-rating-star-review.svg', routes: ['vendedor-reputacion.html'] },
      { key: 'ganancias', label: 'Ganancias', href: 'vendedor-ganancias.html', icon: 'cc-commission.svg', routes: ['vendedor-ganancias.html'] },
      { key: 'configuracion', label: 'Configuración', href: 'vendedor-configuracion.html', icon: 'cc-settings-general.svg', routes: ['vendedor-configuracion.html'] }
    ]
  },
  administrador: {
    title: 'Administrador',
    items: [
      { key: 'panel', label: 'Panel', href: 'admin.html', icon: 'cc-admin-dashboard.svg', routes: ['admin.html', 'admin-dashboard.html'] },
      { key: 'usuarios', label: 'Usuarios', href: 'admin-usuarios.html', icon: 'cc-user-profile.svg', routes: ['admin-usuarios.html'] },
      { key: 'tiendas', label: 'Tiendas', href: 'admin-tiendas.html', icon: 'cc-store-shopping-bag.svg', routes: ['admin-tiendas.html'] },
      { key: 'productos', label: 'Productos', href: 'admin-productos.html', icon: 'cc-products-management.svg', routes: ['admin-productos.html'] },
      { key: 'categorias', label: 'Categorías', href: 'admin-categorias.html', icon: 'cc-categories.svg', routes: ['admin-categorias.html'] },
      { key: 'pedidos', label: 'Pedidos', href: 'admin-pedidos.html', icon: 'cc-order-history.svg', routes: ['admin-pedidos.html'] },
      { key: 'pagos', label: 'Pagos', href: 'admin-pagos.html', icon: 'cc-credit-card.svg', routes: ['admin-pagos.html'] },
      { key: 'envios', label: 'Envíos', href: 'admin-envios.html', icon: 'cc-shipping-package.svg', routes: ['admin-envios.html'] },
      { key: 'resenas', label: 'Reseñas', href: 'admin-resenas.html', icon: 'cc-rating-star-review.svg', routes: ['admin-resenas.html'] },
      { key: 'comisiones', label: 'Comisiones', href: 'admin-comisiones.html', icon: 'cc-commission.svg', routes: ['admin-comisiones.html'] },
      { key: 'notificaciones', label: 'Notificaciones', href: 'admin-notificaciones.html', icon: 'cc-notifications.svg', routes: ['admin-notificaciones.html'] },
      { key: 'logs', label: 'Logs', href: 'admin-logs.html', icon: 'cc-audit-logs.svg', routes: ['admin-logs.html'] },
      { key: 'reportes', label: 'Reportes', href: 'admin-reportes.html', icon: 'cc-reports-analytics.svg', routes: ['admin-reportes.html'] }
    ]
  }
};

const ROUTE_ROLES = {
  'admin.html': 'administrador',
  'admin-dashboard.html': 'administrador',
  'admin-usuarios.html': 'administrador',
  'admin-tiendas.html': 'administrador',
  'admin-productos.html': 'administrador',
  'admin-categorias.html': 'administrador',
  'admin-pedidos.html': 'administrador',
  'admin-pagos.html': 'administrador',
  'admin-envios.html': 'administrador',
  'admin-resenas.html': 'administrador',
  'admin-comisiones.html': 'administrador',
  'admin-notificaciones.html': 'administrador',
  'admin-logs.html': 'administrador',
  'admin-reportes.html': 'administrador',
  'vendedor.html': 'vendedor',
  'vendedor-tienda.html': 'vendedor',
  'vendedor-productos.html': 'vendedor',
  'vendedor-producto-form.html': 'vendedor',
  'vendedor-pedidos.html': 'vendedor',
  'vendedor-envios.html': 'vendedor',
  'vendedor-resenas.html': 'vendedor',
  'vendedor-reputacion.html': 'vendedor',
  'vendedor-ganancias.html': 'vendedor',
  'vendedor-configuracion.html': 'vendedor',
  'comprador.html': 'comprador',
  'mis-pedidos.html': 'comprador',
  'pedido-detalle.html': 'comprador',
  'favoritos.html': 'comprador',
  'direcciones.html': 'comprador',
  'perfil.html': 'comprador',
  'cuenta-privacidad.html': 'comprador',
  'notificaciones.html': 'comprador',
  'resenas.html': 'comprador',
  'devoluciones.html': 'comprador',
  'devolucion-detalle.html': 'comprador',
  'chat-detalle.html': 'comprador'
};

function fileName() {
  const name = window.location.pathname.split('/').pop();
  return name || 'index.html';
}

function detectRole() {
  const explicit = document.body?.dataset.roleSidebar;
  if (MENUS[explicit]) return explicit;
  const current = fileName();
  if (ROUTE_ROLES[current]) return ROUTE_ROLES[current];
  console.warn(`[role-sidebar] No se pudo determinar rol para ${current}.`);
  return null;
}

function activeKey(role) {
  const current = fileName();
  const params = new URLSearchParams(window.location.search);
  if (role === 'vendedor' && current === 'vendedor-producto-form.html' && (params.has('id') || params.has('producto') || params.has('producto_id') || params.get('mode') === 'edit')) return 'productos';
  if (role === 'comprador' && current === 'chat-detalle.html') return 'pedidos';
  const match = MENUS[role]?.items.find(item => item.routes.includes(current));
  return match?.key || 'panel';
}

function ensureLayout(main, role) {
  main.classList.add('cc-dashboard', 'cc-role-dashboard');
  main.classList.remove('cc-section');
  let aside = main.querySelector(':scope > .cc-sidebar');
  if (!aside) {
    aside = document.createElement('aside');
    aside.className = 'cc-sidebar';
    main.prepend(aside);
  }
  aside.id = aside.id || 'role-sidebar';
  aside.dataset.role = role;
  aside.dataset.renderedRole = role;
  const children = [...main.children].filter(child => child !== aside);
  if (children.length === 1 && children[0].classList.contains('cc-role-main')) return aside;
  const content = document.createElement('section');
  content.className = 'grid gap-5 cc-role-main';
  children.forEach(child => content.appendChild(child));
  main.appendChild(content);
  return aside;
}

function renderSidebar(aside, role) {
  const menu = MENUS[role];
  if (!menu) return;
  const active = activeKey(role);
  if (aside.dataset.renderedRole === role && aside.dataset.sidebarActive === active && aside.querySelector('.cc-role-nav')) return;
  aside.dataset.renderedRole = role;
  aside.dataset.sidebarActive = active;
  aside.innerHTML = `
    <div class="cc-role-sidebar-head">
      <h2 class="text-xl font-bold">${menu.title}</h2>
      <button class="cc-role-menu-toggle" type="button" aria-expanded="false" aria-controls="role-sidebar-nav">Navegación ${menu.title.toLowerCase()}</button>
    </div>
    <nav class="cc-role-nav" id="role-sidebar-nav" aria-label="Navegación ${menu.title}">
      ${menu.items.map(item => {
        const isActive = item.key === active;
        return `<a class="cc-side-link${isActive ? ' active' : ''}" href="${item.href}"${isActive ? ' aria-current="page"' : ''} data-role-nav="${item.key}"><img class="cc-icon" src="assets/icons/${item.icon}" alt="${item.label}"><span>${item.label}</span></a>`;
      }).join('')}
    </nav>`;
  const toggle = aside.querySelector('.cc-role-menu-toggle');
  const nav = aside.querySelector('.cc-role-nav');
  toggle?.addEventListener('click', () => {
    const open = aside.classList.toggle('cc-role-sidebar-open');
    toggle.setAttribute('aria-expanded', String(open));
    nav?.classList.toggle('open', open);
  });
  nav?.addEventListener('click', event => {
    if (event.target.closest('a')) {
      aside.classList.remove('cc-role-sidebar-open');
      nav.classList.remove('open');
      toggle?.setAttribute('aria-expanded', 'false');
    }
  });
}

let rendering = false;

function initRoleSidebar() {
  if (rendering) return;
  const main = document.querySelector('main');
  if (!main) return;
  const role = detectRole();
  if (!MENUS[role]) return;
  rendering = true;
  const aside = ensureLayout(main, role);
  renderSidebar(aside, role);
  rendering = false;
}

function bootRoleSidebar() {
  initRoleSidebar();
  const main = document.querySelector('main');
  if (main) {
    const observer = new MutationObserver(() => {
      if (!rendering) {
        const role = detectRole();
        const active = role ? activeKey(role) : null;
        const aside = main.querySelector(':scope > #role-sidebar');
        if (!aside || aside.dataset.renderedRole !== role || aside.dataset.sidebarActive !== active) initRoleSidebar();
      }
    });
    observer.observe(main, { childList: true });
  }
  [0, 250, 700, 1500].forEach(delay => window.setTimeout(initRoleSidebar, delay));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootRoleSidebar, { once: true });
} else {
  bootRoleSidebar();
}
