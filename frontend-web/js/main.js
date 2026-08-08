import { mountShell, initHomeCarousel, normalizeInterfaceIcons } from './ui.js';
import { loadProducts, loadCategories, loadProductDetail } from './products.js';
import { revealOnScroll, animateMetrics, initProgressBars, lazyLoadImages } from './animations.js';

const page=document.body.dataset.page || 'home';
if(!document.body.dataset.noShell) mountShell(page);
loadProducts(page==='home'?8:16);
loadCategories();
loadProductDetail();
initHomeCarousel();
normalizeInterfaceIcons();

// Animaciones de entrada — se disparan después de que el DOM y los datos carguen
document.addEventListener('DOMContentLoaded', () => {
  revealOnScroll('.cc-product, .cc-card, .cc-kpi, .cc-metric-card-v2, .cc-action-card, .cc-metric-card');
  animateMetrics();
  initProgressBars();
  lazyLoadImages();
});
// También disparar tras carga de productos dinámicos (productos.js / seller.js / admin.js)
let productsSwiper = null;
window.addEventListener('cc:products-rendered', () => {
  revealOnScroll('.cc-product', 50);
  lazyLoadImages();

  const swiperContainer = document.querySelector('.cc-products-swiper');
  if (swiperContainer && typeof Swiper !== 'undefined') {
    if (productsSwiper && typeof productsSwiper.destroy === 'function') {
      productsSwiper.destroy(true, true);
    }
    productsSwiper = new Swiper('.cc-products-swiper', {
      slidesPerView: 1,
      spaceBetween: 16,
      navigation: {
        nextEl: '.swiper-button-next',
        prevEl: '.swiper-button-prev',
      },
      pagination: {
        el: '.swiper-pagination',
        clickable: true,
      },
      breakpoints: {
        576: { slidesPerView: 2 },
        768: { slidesPerView: 3 },
        1024: { slidesPerView: 4 }
      }
    });
  }
});
window.addEventListener('cc:dashboard-rendered', () => {
  animateMetrics();
  initProgressBars();
  revealOnScroll('.cc-metric-card-v2, .cc-kpi, .cc-action-card', 40);
});
