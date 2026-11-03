/**
 * AURAMALL - Ứng dụng một trang (SPA), giao diện theo phong cách Lexus.
 * Đề tài 07: Hệ thống TMĐT 3 tầng (Nginx -> Node.js -> PostgreSQL)
 *
 * - Định tuyến bằng hash (#/product/1) nên nút Back/F5 hoạt động, Nginx không cần cấu hình thêm.
 * - Chức năng giữ nguyên bản AuraMall của nhóm: đăng ký/đăng nhập, lọc/tìm kiếm/sắp xếp/phân trang,
 *   chi tiết sản phẩm, giỏ hàng, thanh toán, hồ sơ, sổ địa chỉ, đơn mua; bổ sung kênh người bán.
 * - Mọi dữ liệu từ API đều được escape trước khi chèn vào HTML (người dùng có thể tự đăng sản phẩm).
 */

'use strict';

// ==========================================
// 1. CẤU HÌNH & TRẠNG THÁI
// ==========================================
const STORAGE = {
  token: 'auramall_token', // giữ tên khóa cũ để không mất phiên đăng nhập/giỏ hàng của bản trước
  cart: 'auramall_cart',
  selected: 'auramall_cart_selected',
};
const PAGE_SIZE = 20; // 20 sản phẩm/trang theo bản đặc tả
const MAX_ORDER_QTY = 100; // backend giới hạn 1 - 100 mỗi sản phẩm
const FREE_SHIP_FROM = 500000;
const SHIPPING_FEE = 30000;
const HERO_IDS = [21, 3, 14, 8]; // sản phẩm trình diễn trên banner trang chủ
const HERO_DURATION = 6500;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SORTS = [
  ['popular', 'Phổ biến'],
  ['newest', 'Mới nhất'],
  ['best_seller', 'Bán chạy'],
  ['price_asc', 'Giá tăng dần'],
  ['price_desc', 'Giá giảm dần'],
];
const ORDER_STATUS = {
  CREATED: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  DELIVERING: 'Đang giao',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};
const PAYMENT_LABEL = { COD: 'Thanh toán khi nhận hàng', BANK_TRANSFER: 'Chuyển khoản ngân hàng' };

const state = {
  token: storageGet(localStorage, STORAGE.token),
  user: null,
  cart: loadCart(),
  selected: new Set(loadSelected()),
  categories: [],
  products: null, // tối đa 100 sản phẩm phổ biến, dùng cho trang chủ & mega menu
  index: new Map(), // productId -> product: tra cứu nhanh cho nút "Thêm vào giỏ"
  addresses: [],
  route: { path: '/', query: new URLSearchParams(), full: '/' },
  routeToken: 0,
  prevGroup: null,
  cleanups: [],
  pendingScroll: null,
  hero: null, // điều khiển banner trang chủ
  pd: null, // trang chi tiết đang xem
  co: null, // trang thanh toán
  lightbox: null,
  megaCat: null,
  searchTicket: 0,
  pendingAvatar: null,
  modalOnClose: null,
};

// ==========================================
// 2. TIỆN ÍCH
// ==========================================
function storageGet(area, key) {
  try {
    return area.getItem(key);
  } catch {
    return null; // trình duyệt chặn lưu trữ (chế độ riêng tư)
  }
}

function storageSet(area, key, value) {
  try {
    area.setItem(key, value);
  } catch {
    /* bỏ qua: chỉ mất tính năng ghi nhớ */
  }
}

function storageRemove(area, key) {
  try {
    area.removeItem(key);
  } catch {
    /* bỏ qua */
  }
}

function readJson(area, key, fallback) {
  try {
    const raw = storageGet(area, key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadCart() {
  const raw = readJson(localStorage, STORAGE.cart, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it) => it && Number.isInteger(it.productId) && it.product && Number(it.quantity) > 0)
    .map((it) => ({
      productId: it.productId,
      quantity: Math.min(Math.floor(it.quantity), MAX_ORDER_QTY),
      product: {
        id: it.productId,
        name: String(it.product.name ?? ''),
        price: Number(it.product.price) || 0,
        stock: Number(it.product.stock) || 0,
        image_url: it.product.image_url ?? null,
      },
    }));
}

function loadSelected() {
  const raw = readJson(sessionStorage, STORAGE.selected, []);
  return Array.isArray(raw) ? raw.filter(Number.isInteger) : [];
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pad2 = (n) => String(n).padStart(2, '0');
const stale = (token) => token !== state.routeToken;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function money(value) {
  return `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value) || 0))} ₫`;
}

function compact(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',')}k`;
}

function excerpt(text, max) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function formatDate(value, withTime = false) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return withTime ? d.toLocaleString('vi-VN') : d.toLocaleDateString('vi-VN');
}

// Ngày theo giờ địa phương cho ô <input type="date">
function toDateInput(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function svgData(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Ảnh thay thế khi sản phẩm chưa có ảnh hoặc ảnh lỗi
const PLACEHOLDER = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">' +
    '<rect width="600" height="600" fill="#f5f5f5"/><path d="M0 600L600 0" stroke="#ebebeb" stroke-width="2"/>' +
    '<text x="300" y="300" font-family="Montserrat, Arial" font-size="30" letter-spacing="12" text-anchor="middle" fill="#292929">' +
    '<tspan font-weight="600">AURA</tspan><tspan font-weight="300">MALL</tspan></text>' +
    '<text x="300" y="342" font-family="Arial" font-size="14" letter-spacing="4" text-anchor="middle" fill="#898989">CHƯA CÓ ẢNH</text></svg>'
);

function imgSrc(url) {
  const value = typeof url === 'string' ? url.trim() : '';
  return /^(https?:\/\/|\/images\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(value) ? value : PLACEHOLDER;
}

function avatarSrc(user) {
  const url = user?.avatar_url || user?.avatarUrl;
  if (url && imgSrc(url) !== PLACEHOLDER) return url;
  const letter = esc((user?.username || 'A').charAt(0).toUpperCase());
  return svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
      `<rect width="120" height="120" fill="#292929"/><text x="60" y="76" font-family="Montserrat, Arial" font-size="46" ` +
      `font-weight="300" text-anchor="middle" fill="#d9a95a">${letter}</text></svg>`
  );
}

function remember(products) {
  for (const p of products) state.index.set(p.id, p);
}

function isValidImageUrl(url) {
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) || /^\/images\/[\w./-]+$/.test(url);
}

function setBusy(button, busy, text) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.textContent = text;
    button.disabled = true;
  } else {
    if (button.dataset.label) button.innerHTML = button.dataset.label;
    button.disabled = false;
  }
}

// ==========================================
// 3. GỌI API
// ==========================================
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.', 0);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && state.token && !path.startsWith('/api/auth/login')) {
      sessionExpired();
    }
    throw new ApiError(data?.message || `Máy chủ trả lỗi ${res.status}.`, res.status);
  }
  return data;
}

async function ensureCategories() {
  if (!state.categories.length) {
    const res = await api('/api/categories');
    state.categories = res.data;
    renderCategoryLinks();
  }
  return state.categories;
}

async function ensureProducts() {
  if (!state.products) {
    const res = await api('/api/products?limit=100&sort=popular');
    state.products = res.data;
    remember(res.data);
  }
  return state.products;
}

// Gọi sau khi đặt hàng/đăng bán: tồn kho và số lượng theo danh mục đã đổi
function invalidateCatalog() {
  state.products = null;
  state.categories = [];
}

// ==========================================
// 4. PHIÊN ĐĂNG NHẬP
// ==========================================
function setSession(token, user = null) {
  state.token = token;
  state.user = user;
  if (token) storageSet(localStorage, STORAGE.token, token);
  else storageRemove(localStorage, STORAGE.token);
  renderAccountMenu();
}

async function loadMe() {
  if (!state.token) {
    renderAccountMenu();
    return;
  }
  try {
    const res = await api('/api/auth/me');
    state.user = res.data;
  } catch (err) {
    if (err.status === 401 || err.status === 404) setSession(null);
  }
  renderAccountMenu();
}

function sessionExpired() {
  setSession(null);
  toast('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.', 'error');
  if (currentRouteNeedsAuth()) redirect(`/login?redirect=${encodeURIComponent(state.route.full)}`);
}

function logout() {
  setSession(null);
  toast('Đã đăng xuất tài khoản.');
  if (currentRouteNeedsAuth()) redirect('/');
}

function renderAccountMenu() {
  const menu = $('#accountMenu');
  const trigger = $('#accountTrigger');
  const logged = Boolean(state.token && state.user);
  menu.classList.toggle('is-logged', logged);
  if (logged) {
    trigger.href = '#/account/profile';
    trigger.innerHTML = `<img class="avatar-mini" src="${esc(avatarSrc(state.user))}" alt=""><span class="account-name">${esc(state.user.username)}</span>`;
    $('#accountDropdownHead').innerHTML = `<strong>${esc(state.user.username)}</strong><span>${esc(state.user.email || '')}</span>`;
  } else {
    trigger.href = '#/login';
    trigger.innerHTML = `${icon('user')}<span class="account-name">Đăng nhập</span>`;
  }
}

// ==========================================
// 5. THÔNG BÁO, HỘP THOẠI, XEM ẢNH
// ==========================================
function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(type === 'error' ? 'close' : 'check')}<span>${esc(message)}</span>`;
  $('#toastRoot').append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 350);
  }, 3600);
}

function lockScroll() {
  const open = $('#modalRoot .modal:not(.is-leaving)') || $('#lightbox') || !$('#drawer').hidden || $('#filters.is-open');
  document.body.classList.toggle('is-locked', Boolean(open));
}

function openModal(html, { wide = false, onClose = null } = {}) {
  closeModal({ silent: true, instant: true });
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `
    <div class="modal-backdrop" data-action="modal-close"></div>
    <div class="modal-card ${wide ? 'modal-card--wide' : ''}" role="dialog" aria-modal="true">
      <button class="icon-btn modal-close" data-action="modal-close" aria-label="Đóng">${icon('close')}</button>
      ${html}
    </div>`;
  $('#modalRoot').append(wrap);
  state.modalOnClose = onClose;
  lockScroll();
  setTimeout(() => wrap.querySelector('input:not([type=hidden]), select, textarea')?.focus(), 60);
  return wrap;
}

// silent: đóng do chuyển trang, không gọi onClose
function closeModal({ silent = false, instant = false } = {}) {
  const wrap = $('#modalRoot .modal:not(.is-leaving)');
  if (!wrap) return;
  const callback = state.modalOnClose;
  state.modalOnClose = null;
  if (instant || REDUCED_MOTION) {
    wrap.remove();
  } else {
    wrap.classList.add('is-leaving');
    setTimeout(() => wrap.remove(), 240);
  }
  lockScroll();
  if (!silent && callback) callback();
}

function confirmDialog(title, message, { okText = 'Đồng ý', cancelText = 'Hủy' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const wrap = openModal(
      `<h3 class="modal-title">${esc(title)}</h3>
       <p class="modal-text">${esc(message)}</p>
       <div class="modal-actions">
         ${cancelText ? `<button class="btn" data-answer="0">${esc(cancelText)}</button>` : ''}
         <button class="btn btn--solid" data-answer="1">${esc(okText)}</button>
       </div>`,
      { onClose: () => !answered && resolve(false) }
    );
    wrap.addEventListener('click', (e) => {
      const button = e.target.closest('[data-answer]');
      if (!button) return;
      answered = true;
      resolve(button.dataset.answer === '1');
      closeModal();
    });
  });
}

function openLightbox(images, index) {
  closeLightbox();
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.id = 'lightbox';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <img id="lightboxImg" alt="">
    <button class="icon-btn lightbox-close" data-action="lightbox-close" aria-label="Đóng">${icon('close')}</button>
    ${
      images.length > 1
        ? `<button class="round-btn lightbox-prev" data-action="lightbox-step" data-step="-1" aria-label="Ảnh trước">${icon('left')}</button>
           <button class="round-btn lightbox-next" data-action="lightbox-step" data-step="1" aria-label="Ảnh sau">${icon('right')}</button>`
        : ''
    }
    <span class="lightbox-count" id="lightboxCount"></span>`;
  el.addEventListener('click', (e) => {
    if (e.target === el) closeLightbox();
  });
  document.body.append(el);
  state.lightbox = { images, index };
  showLightbox(index);
  lockScroll();
}

function showLightbox(index) {
  const box = state.lightbox;
  if (!box) return;
  box.index = (index + box.images.length) % box.images.length;
  const img = $('#lightboxImg');
  img.src = imgSrc(box.images[box.index]);
  img.style.animation = 'none';
  void img.offsetWidth; // chạy lại hiệu ứng phóng to
  img.style.animation = '';
  $('#lightboxCount').textContent = `${pad2(box.index + 1)} / ${pad2(box.images.length)}`;
}

function closeLightbox() {
  $('#lightbox')?.remove();
  state.lightbox = null;
  lockScroll();
}

// ==========================================
// 6. HIỆU ỨNG CHUYỂN TRANG & XUẤT HIỆN KHI CUỘN
// ==========================================
const curtain = {
  get el() {
    return $('#curtain');
  },
  // Màn chắn nghiêng quét từ trái sang che trang cũ
  async cover() {
    const el = this.el;
    if (REDUCED_MOTION || el.classList.contains('is-covering')) return;
    el.classList.remove('is-leaving');
    void el.offsetWidth; // đặt lại vị trí xuất phát bên trái
    el.classList.add('is-covering');
    await wait(430);
  },
  // Kéo tiếp sang phải để lộ trang mới
  reveal() {
    const el = this.el;
    if (!el.classList.contains('is-covering')) return;
    if (REDUCED_MOTION) {
      el.classList.remove('is-covering');
      return;
    }
    el.classList.add('is-leaving');
    el.classList.remove('is-covering');
    setTimeout(() => el.classList.remove('is-leaving'), 700);
  },
};

let revealObserver = null;

function observeReveals() {
  const items = $$('.reveal:not(.is-visible)');
  if (REDUCED_MOTION || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  revealObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );
  items.forEach((el) => revealObserver.observe(el));
}

function onCleanup(fn) {
  state.cleanups.push(fn);
}

function runCleanups() {
  state.cleanups.splice(0).forEach((fn) => fn());
}

function scrollToEl(el, offset = 24) {
  if (!el) return;
  const header = $('#siteHeader').offsetHeight;
  const subnav = $('#subnav.is-visible')?.offsetHeight || 0;
  const top = el.getBoundingClientRect().top + window.scrollY - header - subnav - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
}

// ==========================================
// 7. ĐỊNH TUYẾN (HASH ROUTER)
// ==========================================
const ROUTES = [
  { re: /^\/$/, view: 'home' },
  { re: /^\/products$/, view: 'catalog' },
  { re: /^\/product\/(\d+)$/, view: 'product' },
  { re: /^\/cart$/, view: 'cart' },
  { re: /^\/checkout$/, view: 'checkout', auth: true },
  { re: /^\/login$/, view: 'login', group: 'auth' },
  { re: /^\/register$/, view: 'register', group: 'auth' },
  { re: /^\/account(?:\/(profile|addresses|orders|products))?$/, view: 'account', auth: true },
  { re: /^\/sell(?:\/(\d+))?$/, view: 'sell', auth: true },
];

function parseHash() {
  const full = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = full.split('?');
  return { path: path || '/', query: new URLSearchParams(qs), full };
}

function matchRoute(path) {
  for (const route of ROUTES) {
    const m = path.match(route.re);
    if (m) return { ...route, params: m.slice(1) };
  }
  return { view: 'notFound', params: [] };
}

function currentRouteNeedsAuth() {
  return Boolean(matchRoute(state.route.path).auth);
}

function go(path) {
  if (location.hash === `#${path}`) router();
  else location.hash = path;
}

// Chuyển trang từ bên trong một view: bỏ lượt render hiện tại
function redirect(path) {
  state.routeToken++;
  go(path);
}

async function router() {
  const { path, query, full } = parseHash();
  const route = matchRoute(path);

  if (route.auth && !state.token) {
    toast('Vui lòng đăng nhập để tiếp tục.', 'error');
    redirect(`/login?redirect=${encodeURIComponent(full)}`);
    return;
  }

  const token = ++state.routeToken;
  const group = route.group || route.view;
  // Đổi bộ lọc, đổi tab tài khoản: chỉ vẽ lại nội dung, không chạy màn chắn
  const soft = group === state.prevGroup && group !== 'product';
  state.route = { path, query, full };
  closeOverlays();
  runCleanups();

  if (!soft) await curtain.cover();
  if (stale(token)) return;

  try {
    await VIEWS[route.view]({ params: route.params, query, token });
  } catch (err) {
    if (stale(token)) return;
    console.error(err);
    renderError(err);
  }
  if (stale(token)) return;

  state.prevGroup = group;
  updateNavActive();
  observeReveals();
  // Màn chắn có thể vẫn đang che do lượt trước chuyển hướng (redirect) giữa chừng
  if (!soft || curtain.el.classList.contains('is-covering')) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('#view').focus({ preventScroll: true });
    curtain.reveal();
  } else if (state.pendingScroll) {
    const target = $(state.pendingScroll);
    if (target && target.getBoundingClientRect().top < 0) scrollToEl(target);
  }
  state.pendingScroll = null;
}

function closeOverlays() {
  closeMega();
  closeSearch();
  closeDrawer();
  closeLightbox();
  closeModal({ silent: true, instant: true });
  $('#filters')?.classList.remove('is-open');
}

function updateNavActive() {
  const { path, query } = state.route;
  const onCatalog = path === '/products';
  const active = {
    flash: onCatalog && query.get('flashSale') === '1',
    newest: onCatalog && query.get('sort') === 'newest',
    sell: path.startsWith('/sell'),
  };
  $$('.nav-link[data-nav]').forEach((link) => link.classList.toggle('is-active', Boolean(active[link.dataset.nav])));
}

// ==========================================
// 8. HEADER: MEGA MENU, TÌM KIẾM, MENU DI ĐỘNG
// ==========================================
let megaTimer = null;

function openMega() {
  clearTimeout(megaTimer);
  const mega = $('#megaMenu');
  if (!mega.hidden) return;
  closeSearch();
  mega.hidden = false;
  $('[data-action="mega-toggle"]').setAttribute('aria-expanded', 'true');
  renderMega(state.megaCat);
}

function closeMega() {
  clearTimeout(megaTimer);
  $('#megaMenu').hidden = true;
  $('[data-action="mega-toggle"]').setAttribute('aria-expanded', 'false');
}

// Menu "Sản phẩm": mỗi danh mục là một tab, giống menu "Mẫu xe" (Sedan / SUV...) của Lexus
async function renderMega(catId) {
  const tabs = $('#megaTabs');
  const body = $('#megaBody');
  let cats;
  let products;
  try {
    [cats, products] = await Promise.all([ensureCategories(), ensureProducts()]);
  } catch {
    body.innerHTML = '<p class="muted">Không tải được danh mục sản phẩm.</p>';
    return;
  }
  const list = cats.filter((c) => c.product_count > 0);
  const active = list.find((c) => c.id === catId) || list[0];
  if (!active) {
    body.innerHTML = '<p class="muted">Chưa có sản phẩm nào.</p>';
    return;
  }
  state.megaCat = active.id;
  tabs.innerHTML = list
    .map(
      (c) =>
        `<button class="tab ${c.id === active.id ? 'is-active' : ''}" data-action="mega-tab" data-cat="${c.id}" role="tab" aria-selected="${c.id === active.id}">${esc(c.name)}</button>`
    )
    .join('');
  const items = products.filter((p) => p.category_id === active.id);
  const cover = items.find((p) => p.image_url) || items[0];
  body.innerHTML =
    items
      .slice(0, 4)
      .map(
        (p) => `
        <a class="mega-item" href="#/product/${p.id}">
          <div class="media"><img src="${esc(imgSrc(p.image_url))}" alt="" loading="lazy"></div>
          <h4>${esc(p.name)}</h4>
          <p class="from">Giá từ <strong>${money(p.price)}</strong></p>
        </a>`
      )
      .join('') +
    `<a class="mega-feature" href="#/products?category=${encodeURIComponent(active.slug)}">
       <img src="${esc(imgSrc(cover?.image_url))}" alt="" loading="lazy">
       <span class="eyebrow">Dòng sản phẩm</span>
       <h4>${esc(active.name)}</h4>
       <span class="link-arrow">Xem tất cả ${active.product_count} sản phẩm ${icon('arrow')}</span>
     </a>`;
}

function openSearch() {
  closeMega();
  const panel = $('#searchPanel');
  panel.hidden = false;
  const input = $('#searchInput');
  input.value = state.route.query.get('q') || '';
  renderSearchResults(input.value);
  setTimeout(() => input.focus(), 60);
}

function closeSearch() {
  $('#searchPanel').hidden = true;
}

async function renderSearchResults(raw) {
  const box = $('#searchResults');
  const q = raw.trim();
  const ticket = ++state.searchTicket;
  if (!q) {
    box.innerHTML = '';
    return;
  }
  try {
    const res = await api(`/api/products?limit=6&sort=popular&q=${encodeURIComponent(q)}`);
    if (ticket !== state.searchTicket) return; // đã có từ khóa mới hơn
    remember(res.data);
    box.innerHTML = res.data.length
      ? res.data
          .map(
            (p, i) => `
            <a class="search-hit" style="animation-delay:${i * 40}ms" href="#/product/${p.id}">
              <img src="${esc(imgSrc(p.image_url))}" alt="">
              <div><strong>${esc(p.name)}</strong><span>${money(p.price)}</span></div>
            </a>`
          )
          .join('') +
        `<a class="link-arrow search-all" href="#/products?q=${encodeURIComponent(q)}">Xem tất cả ${res.pagination.totalItems} kết quả ${icon('arrow')}</a>`
      : `<p class="muted">Không tìm thấy sản phẩm phù hợp với “${esc(q)}”.</p>`;
  } catch {
    if (ticket === state.searchTicket) box.innerHTML = '<p class="muted">Không thể tìm kiếm lúc này.</p>';
  }
}

const liveSearch = debounce(renderSearchResults, 250);

function openDrawer() {
  $('#drawer').hidden = false;
  lockScroll();
}

function closeDrawer() {
  $('#drawer').hidden = true;
  lockScroll();
}

function renderCategoryLinks() {
  const links = (cls) =>
    state.categories
      .map((c) => `<a href="#/products?category=${encodeURIComponent(c.slug)}" class="${cls}">${esc(c.name)}</a>`)
      .join('');
  $('#drawerCats').innerHTML = links('');
  $('#footerCats').innerHTML = links('link-lux');
}

// ==========================================
// 9. THÀNH PHẦN GIAO DIỆN DÙNG CHUNG
// ==========================================
function breadcrumb(items) {
  return `<nav class="breadcrumb" aria-label="Đường dẫn">${items
    .map(([label, href], i) => `${i ? icon('right') : ''}${href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`}`)
    .join('')}</nav>`;
}

function ratingHtml(p) {
  if (!Number(p.review_count) && !Number(p.rating)) return '<span>Chưa có đánh giá</span>';
  return `<span class="stars">${icon('star', 'icon-fill')}<em>${Number(p.rating).toFixed(1)}</em></span>`;
}

function soldBar(p) {
  const total = Number(p.sold_count) + Number(p.stock);
  const pct = total > 0 ? Math.round((Number(p.sold_count) / total) * 100) : 0;
  return `<div class="sold-bar" title="Đã bán ${pct}%"><span style="width:${pct}%"></span></div>`;
}

function productCard(p, { dark = false, i = 0, quick = true, sold = false, reveal = true, link = true } = {}) {
  const out = p.stock <= 0;
  const url = `#/product/${p.id}`;
  const tags =
    (p.discount_percent > 0 ? `<span class="tag tag--dark">-${p.discount_percent}%</span>` : '') +
    (p.is_flash_sale ? `<span class="tag tag--gold">${icon('bolt')}Flash</span>` : '');
  const media = `
      <img src="${esc(imgSrc(p.image_url))}" alt="${esc(p.name)}" loading="lazy">
      ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      ${out ? '<div class="card-soldout"><span>Hết hàng</span></div>' : ''}`;
  return `
    <article class="card ${dark ? 'card--dark' : ''} ${reveal ? 'reveal' : ''}" style="--i:${i % 8}">
      <div class="card-visual">
        ${link ? `<a class="card-media" href="${url}" tabindex="-1">${media}</a>` : `<div class="card-media">${media}</div>`}
        ${
          quick && !out
            ? `<button class="btn btn--solid btn--sm card-quick" data-action="quick-add" data-id="${p.id}">${icon('bag', 'icon-sm')}Thêm vào giỏ</button>`
            : ''
        }
      </div>
      <div class="card-body">
        <p class="card-cat">${esc(p.category_name || 'AuraMall')}</p>
        <h3 class="card-title">${link ? `<a href="${url}">${esc(p.name)}</a>` : esc(p.name)}</h3>
        <div class="price"><strong>${money(p.price)}</strong>${p.original_price > p.price ? `<s>${money(p.original_price)}</s>` : ''}</div>
        <div class="card-meta">${ratingHtml(p)}<span>Đã bán ${compact(p.sold_count)}</span></div>
        ${sold ? soldBar(p) : ''}
      </div>
    </article>`;
}

function trackNav(id, dark = false) {
  const cls = dark ? '' : 'round-btn--dark';
  return `
    <div class="track-nav">
      <div class="track-progress"><span data-progress="${id}"></span></div>
      <div class="track-arrows">
        <button class="round-btn ${cls}" data-action="track-step" data-track="${id}" data-step="-1" aria-label="Xem trước">${icon('left')}</button>
        <button class="round-btn ${cls}" data-action="track-step" data-track="${id}" data-step="1" aria-label="Xem tiếp">${icon('right')}</button>
      </div>
    </div>`;
}

function updateTrack(track) {
  const bar = $(`[data-progress="${track.id}"]`);
  if (!bar) return;
  const ratio = Math.min(1, track.clientWidth / Math.max(track.scrollWidth, 1));
  const max = track.scrollWidth - track.clientWidth;
  bar.style.width = `${ratio * 100}%`;
  bar.style.left = `${max > 0 ? (track.scrollLeft / max) * (1 - ratio) * 100 : 0}%`;
}

function setupTracks() {
  for (const track of $$('.track')) {
    track.addEventListener('scroll', () => updateTrack(track), { passive: true });
    updateTrack(track);
  }
}

function qtyControl(qty, max, { id = null, small = false } = {}) {
  const idAttr = id === null ? '' : ` data-id="${id}"`;
  return `
    <div class="qty ${small ? 'qty--sm' : ''}">
      <button type="button" data-action="qty-step" data-step="-1"${idAttr} ${qty <= 1 ? 'disabled' : ''} aria-label="Giảm số lượng">${icon('minus')}</button>
      <input type="number" inputmode="numeric" min="1" max="${max}" value="${qty}" data-qty${idAttr} aria-label="Số lượng">
      <button type="button" data-action="qty-step" data-step="1"${idAttr} ${qty >= max ? 'disabled' : ''} aria-label="Tăng số lượng">${icon('plus')}</button>
    </div>`;
}

function emptyState(iconName, title, text, action = '') {
  return `<div class="empty">${icon(iconName)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}

function pageHead(crumbs, title, sub = '') {
  return `
    <section class="page-head">
      <div class="container">
        ${breadcrumb(crumbs)}
        <h1>${esc(title)}</h1>
        ${sub ? `<p>${esc(sub)}</p>` : ''}
      </div>
    </section>`;
}

function renderNotFound(message = 'Trang bạn tìm không tồn tại hoặc đã được di chuyển.') {
  $('#view').innerHTML = `<section class="container">${emptyState(
    'search',
    'Không tìm thấy',
    message,
    '<a class="btn btn--solid" href="#/">Về trang chủ</a>'
  )}</section>`;
}

function renderError(err) {
  $('#view').innerHTML = `<section class="container">${emptyState(
    'close',
    'Đã có lỗi xảy ra',
    err?.message || 'Vui lòng thử lại sau ít phút.',
    '<button class="btn btn--solid" data-action="retry">Thử lại</button>'
  )}</section>`;
}

// ==========================================
// 10. GIỎ HÀNG (lưu ở trình duyệt như bản của nhóm)
// ==========================================
function saveCart() {
  storageSet(
    localStorage,
    STORAGE.cart,
    JSON.stringify(state.cart.map(({ productId, product, quantity }) => ({ productId, product, quantity })))
  );
  storageSet(sessionStorage, STORAGE.selected, JSON.stringify([...state.selected]));
  updateCartBadge();
}

const cartCount = () => state.cart.reduce((sum, it) => sum + it.quantity, 0);
const maxQty = (stock) => Math.max(0, Math.min(Number(stock) || 0, MAX_ORDER_QTY));
const isBuyable = (it) => !it.unavailable && it.product.stock > 0;
const selectedItems = () => state.cart.filter((it) => state.selected.has(it.productId) && isBuyable(it));

function updateCartBadge() {
  const badge = $('#cartBadge');
  const count = cartCount();
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  renderCartPopover();
}

function bumpBadge() {
  const badge = $('#cartBadge');
  badge.classList.remove('bump');
  void badge.offsetWidth;
  badge.classList.add('bump');
}

// Xem nhanh 3 sản phẩm vừa thêm khi rê chuột vào biểu tượng giỏ hàng
function renderCartPopover() {
  const box = $('#cartPopover');
  if (!state.cart.length) {
    box.innerHTML = '<div class="cart-pop-empty">Giỏ hàng của bạn đang trống.</div>';
    return;
  }
  box.innerHTML = `
    <div class="cart-pop-head"><span class="eyebrow">Mới thêm vào giỏ</span></div>
    ${state.cart
      .slice(-3)
      .reverse()
      .map(
        (it) => `
        <a class="cart-pop-item" href="#/product/${it.productId}">
          <img src="${esc(imgSrc(it.product.image_url))}" alt="">
          <div><strong>${esc(it.product.name)}</strong><span>${money(it.product.price)} × ${it.quantity}</span></div>
        </a>`
      )
      .join('')}
    <div class="cart-pop-foot"><a class="btn btn--solid btn--sm btn--block" href="#/cart">Xem giỏ hàng (${cartCount()})</a></div>`;
}

function addToCart(p, qty, { fromEl = null, silent = false } = {}) {
  if (!p || p.stock <= 0) {
    toast('Rất tiếc, sản phẩm đã hết hàng.', 'error');
    return false;
  }
  const limit = maxQty(p.stock);
  const item = state.cart.find((it) => it.productId === p.id);
  const current = item ? item.quantity : 0;
  const next = Math.min(current + qty, limit);
  if (next === current) {
    if (!silent) toast(`Giỏ hàng đã có ${current} sản phẩm này, đạt mức tối đa có thể mua.`, 'error');
    return false;
  }
  const snapshot = { id: p.id, name: p.name, price: p.price, stock: p.stock, image_url: p.image_url };
  if (item) {
    state.cart.splice(state.cart.indexOf(item), 1);
  }
  state.cart.push({ productId: p.id, product: snapshot, quantity: next }); // mới nhất ở cuối
  state.selected.add(p.id);
  saveCart();
  flyToCart(fromEl);
  if (!silent) {
    toast(next - current < qty ? `Đã thêm vào giỏ (tối đa ${next} theo tồn kho).` : 'Đã thêm sản phẩm vào giỏ hàng.');
  }
  return true;
}

// "Mua ngay": thêm vào giỏ rồi chỉ chọn đúng sản phẩm này để thanh toán
function buyNow(p, qty) {
  if (!p || p.stock <= 0) {
    toast('Rất tiếc, sản phẩm đã hết hàng.', 'error');
    return;
  }
  addToCart(p, qty, { silent: true });
  state.selected = new Set([p.id]);
  saveCart();
  go('/cart');
}

// Hiệu ứng ảnh sản phẩm bay vào giỏ hàng
function flyToCart(img) {
  const target = $('#cartTrigger');
  if (!img || REDUCED_MOTION) {
    bumpBadge();
    return;
  }
  const from = img.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) {
    bumpBadge();
    return;
  }
  const fly = document.createElement('img');
  fly.src = img.currentSrc || img.src;
  fly.alt = '';
  fly.className = 'fly-img';
  Object.assign(fly.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  });
  document.body.append(fly);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      fly.style.transform = `translate(${dx}px, ${dy}px) scale(0.06)`;
      fly.style.opacity = '0.3';
    })
  );
  setTimeout(() => {
    fly.remove();
    bumpBadge();
  }, 880);
}

// Cập nhật giá, tồn kho mới nhất cho các sản phẩm trong giỏ
async function refreshCartProducts() {
  const results = await Promise.allSettled(state.cart.map((it) => api(`/api/products/${it.productId}`)));
  results.forEach((result, i) => {
    const item = state.cart[i];
    if (result.status === 'fulfilled') {
      const p = result.value.data;
      remember([p]);
      item.product = { id: p.id, name: p.name, price: p.price, stock: p.stock, image_url: p.image_url };
      item.unavailable = false;
      if (p.stock > 0) item.quantity = Math.min(item.quantity, maxQty(p.stock));
    } else if (result.reason?.status === 404) {
      item.unavailable = true;
    }
    if (!isBuyable(item)) state.selected.delete(item.productId);
  });
  saveCart();
}

// ==========================================
// 11. TRANG CHỦ
// ==========================================
async function viewHome({ token }) {
  const [products] = await Promise.all([ensureProducts(), ensureCategories()]);
  if (stale(token)) return;

  const byId = new Map(products.map((p) => [p.id, p]));
  let heroes = HERO_IDS.map((id) => byId.get(id)).filter(Boolean);
  if (heroes.length < 2) heroes = [...products].sort((a, b) => b.sold_count - a.sold_count).slice(0, 4);
  const flash = products.filter((p) => p.is_flash_sale);
  const cats = state.categories.filter((c) => c.product_count > 0);

  $('#view').innerHTML = [
    heroHtml(heroes),
    lineupHtml(cats),
    flashHtml(flash),
    categoriesHtml(cats, products),
    editorialHtml(),
    ctaHtml(),
  ].join('');

  renderLineup('all');
  setupHero(heroes.length);
  setupTracks();
  setupCountdown();
}

function heroHtml(items) {
  if (!items.length) return '';
  return `
    <section class="hero" id="hero" style="--hero-duration:${HERO_DURATION}ms">
      ${items
        .map(
          (p, i) => `
          <div class="hero-slide ${i === 0 ? 'is-active' : ''}" aria-hidden="${i !== 0}">
            <div class="hero-media"><img src="${esc(imgSrc(p.image_url))}" alt=""></div>
            <div class="container hero-copy">
              <p class="eyebrow" style="--i:0">${esc(p.category_name || 'AuraMall')}</p>
              <${i === 0 ? 'h1' : 'h2'} class="hero-title" style="--i:1">${esc(p.name)}</${i === 0 ? 'h1' : 'h2'}>
              <p class="hero-desc" style="--i:2">${esc(excerpt(p.description, 130))}</p>
              <p class="hero-price" style="--i:3">Giá từ<strong>${money(p.price)}</strong></p>
              <div class="hero-cta" style="--i:4">
                <a class="btn btn--light" href="#/product/${p.id}">Khám phá</a>
                ${p.stock > 0 ? `<button class="btn btn--gold" data-action="buy-now" data-id="${p.id}">Mua ngay</button>` : ''}
              </div>
            </div>
          </div>`
        )
        .join('')}
      <div class="hero-controls">
        <div class="container">
          <div class="hero-dots">
            ${items
              .map(
                (_, i) => `
                <button class="hero-dot ${i === 0 ? 'is-active' : ''}" data-action="hero-go" data-index="${i}" aria-label="Xem banner ${i + 1}">
                  <span>${pad2(i + 1)}</span><span class="bar"></span>
                </button>`
              )
              .join('')}
          </div>
          <div class="hero-arrows">
            <button class="round-btn" data-action="hero-step" data-step="-1" aria-label="Banner trước">${icon('left')}</button>
            <button class="round-btn" data-action="hero-step" data-step="1" aria-label="Banner sau">${icon('right')}</button>
          </div>
        </div>
      </div>
      <button class="scroll-hint" data-action="scroll-to" data-target="#lineup" aria-label="Cuộn xuống"></button>
    </section>`;
}

function setupHero(count) {
  const hero = $('#hero');
  if (!hero) return;
  let index = 0;
  let timer = null;

  const restart = () => {
    clearInterval(timer);
    if (count > 1) timer = setInterval(() => show(index + 1), HERO_DURATION);
  };
  const show = (i) => {
    index = (i + count) % count;
    $$('.hero-slide', hero).forEach((slide, k) => {
      slide.classList.toggle('is-active', k === index);
      slide.setAttribute('aria-hidden', String(k !== index));
    });
    $$('.hero-dot', hero).forEach((dot, k) => {
      dot.classList.remove('is-active');
      if (k === index) {
        void dot.offsetWidth; // chạy lại thanh tiến trình
        dot.classList.add('is-active');
      }
    });
    restart();
  };

  hero.addEventListener('mouseenter', () => {
    hero.classList.add('is-paused');
    clearInterval(timer);
  });
  hero.addEventListener('mouseleave', () => {
    hero.classList.remove('is-paused');
    show(index);
  });

  // Vuốt trái/phải trên điện thoại
  let startX = null;
  hero.addEventListener('touchstart', (e) => (startX = e.touches[0].clientX), { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  });

  state.hero = { show, step: (n) => show(index + n) };
  restart();
  onCleanup(() => {
    clearInterval(timer);
    state.hero = null;
  });
}

function lineupHtml(cats) {
  return `
    <section class="section" id="lineup">
      <div class="container">
        <div class="section-head reveal">
          <p class="eyebrow">Bộ sưu tập</p>
          <h2>Khám phá các dòng sản phẩm</h2>
          <p>Mỗi danh mục là một dòng sản phẩm được tuyển chọn, từ thiết bị âm thanh đến nội thất công thái học.</p>
        </div>
        <div class="tabs tabs--center lineup-tabs reveal" role="tablist">
          <button class="tab is-active" data-action="lineup-tab" data-cat="all" role="tab">Tất cả</button>
          ${cats.map((c) => `<button class="tab" data-action="lineup-tab" data-cat="${c.id}" role="tab">${esc(c.name)}</button>`).join('')}
        </div>
        <div class="track" id="lineupTrack"></div>
        ${trackNav('lineupTrack')}
      </div>
    </section>`;
}

function renderLineup(catId) {
  const track = $('#lineupTrack');
  if (!track || !state.products) return;
  const list = (catId === 'all' ? state.products : state.products.filter((p) => String(p.category_id) === String(catId))).slice(0, 12);
  track.innerHTML = list.map((p, i) => productCard(p, { i, reveal: false })).join('');
  track.scrollLeft = 0;
  track.classList.remove('is-switching');
  void track.offsetWidth;
  track.classList.add('is-switching');
  updateTrack(track);
  $$('[data-action="lineup-tab"]').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.cat === String(catId)));
}

function flashHtml(items) {
  if (!items.length) return '';
  return `
    <section class="section section--dark" id="flash">
      <div class="container">
        <div class="flash-head reveal">
          <div><p class="eyebrow">Ưu đãi giới hạn</p><h2>${icon('bolt')} Flash Sale</h2></div>
          <div class="countdown" id="countdown">
            <span class="countdown-label">Kết thúc sau</span><b data-unit="h">00</b><b data-unit="m">00</b><b data-unit="s">00</b>
          </div>
          <a class="link-arrow" href="#/products?flashSale=1">Xem tất cả ${icon('arrow')}</a>
        </div>
        <div class="track" id="flashTrack">${items.map((p, i) => productCard(p, { dark: true, i, sold: true, reveal: false })).join('')}</div>
        ${trackNav('flashTrack', true)}
      </div>
    </section>`;
}

// Flash Sale kết thúc lúc nửa đêm mỗi ngày
function setupCountdown() {
  const box = $('#countdown');
  if (!box) return;
  const tick = () => {
    const now = new Date();
    const end = new Date(now);
    end.setHours(24, 0, 0, 0);
    let left = Math.max(0, Math.floor((end - now) / 1000));
    const h = Math.floor(left / 3600);
    left %= 3600;
    box.querySelector('[data-unit="h"]').textContent = pad2(h);
    box.querySelector('[data-unit="m"]').textContent = pad2(Math.floor(left / 60));
    box.querySelector('[data-unit="s"]').textContent = pad2(left % 60);
  };
  tick();
  const timer = setInterval(tick, 1000);
  onCleanup(() => clearInterval(timer));
}

function categoriesHtml(cats, products) {
  if (!cats.length) return '';
  return `
    <section class="section section--mist" id="categories">
      <div class="container">
        <div class="section-head reveal">
          <p class="eyebrow">Danh mục</p>
          <h2>Mọi thứ bạn cần, tuyển chọn tinh tế</h2>
        </div>
        <div class="cat-grid">
          ${cats
            .map((c, i) => {
              const cover = products.find((p) => p.category_id === c.id && p.image_url);
              return `
              <a class="cat-tile reveal" style="--i:${i % 5}" href="#/products?category=${encodeURIComponent(c.slug)}">
                <img src="${esc(imgSrc(cover?.image_url))}" alt="" loading="lazy">
                <h3>${esc(c.name)}</h3>
                <span>${c.product_count} sản phẩm</span>
                <i class="line"></i>
              </a>`;
            })
            .join('')}
        </div>
      </div>
    </section>`;
}

function editorialHtml() {
  return `
    <section class="section">
      <div class="container editorial">
        <div class="slant-media reveal"><img src="/images/products/ban-nang-ha.jpg" alt="Góc làm việc tối giản với bàn nâng hạ" loading="lazy"></div>
        <div class="reveal" style="--i:1">
          <p class="eyebrow">Trải nghiệm AuraMall</p>
          <h2>Tinh hoa mua sắm trong từng chi tiết</h2>
          <p>Từ lúc chọn sản phẩm đến khi nhận hàng, mọi bước đều được chăm chút: thông tin minh bạch, thanh toán an toàn
          và tồn kho được trừ chính xác ngay cả khi hàng nghìn người cùng đặt mua trong giờ Flash Sale.</p>
          <div class="feature-list">
            <div class="feature"><span class="num">01</span><div><h3>Chính hãng 100%</h3><p>Nguồn gốc rõ ràng, bảo hành theo nhà sản xuất.</p></div></div>
            <div class="feature"><span class="num">02</span><div><h3>Giao nhanh toàn quốc</h3><p>Miễn phí vận chuyển cho đơn từ ${money(FREE_SHIP_FROM)}.</p></div></div>
            <div class="feature"><span class="num">03</span><div><h3>Đổi trả 30 ngày</h3><p>Không hài lòng? Hoàn trả dễ dàng trong 30 ngày.</p></div></div>
          </div>
        </div>
      </div>
    </section>`;
}

function ctaHtml() {
  return `
    <section class="cta-band">
      <div class="container cta-inner reveal">
        <div>
          <p class="eyebrow">Kênh người bán</p>
          <h2>Bán hàng cùng AuraMall</h2>
          <p>Đăng bán sản phẩm chỉ trong vài bước: thêm ảnh, đặt giá, quản lý tồn kho và theo dõi lượt bán.</p>
        </div>
        <a class="btn btn--light" href="#/sell">Đăng bán sản phẩm ${icon('arrow', 'icon-sm')}</a>
      </div>
    </section>`;
}

// ==========================================
// 12. DANH SÁCH SẢN PHẨM: LỌC, SẮP XẾP, PHÂN TRANG (LUỒNG 1: GET /api/products)
// ==========================================
function readFilters(query) {
  const page = Number.parseInt(query.get('page'), 10);
  return {
    category: query.get('category') || '',
    q: (query.get('q') || '').trim(),
    sort: SORTS.some(([key]) => key === query.get('sort')) ? query.get('sort') : 'popular',
    minPrice: query.get('minPrice') || '',
    maxPrice: query.get('maxPrice') || '',
    minRating: query.get('minRating') || '',
    flashSale: query.get('flashSale') === '1',
    page: page > 0 ? page : 1,
  };
}

function catalogUrl(changes) {
  const query = new URLSearchParams(state.route.query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === '' || value === null || value === undefined) query.delete(key);
    else query.set(key, value);
  }
  if (!('page' in changes)) query.delete('page'); // đổi bộ lọc thì về trang 1
  const qs = query.toString();
  return `/products${qs ? `?${qs}` : ''}`;
}

async function viewCatalog({ query, token }) {
  await ensureCategories();
  const f = readFilters(query);
  const params = new URLSearchParams({ page: f.page, limit: PAGE_SIZE, sort: f.sort });
  for (const key of ['category', 'q', 'minPrice', 'maxPrice', 'minRating']) {
    if (f[key]) params.set(key, f[key]);
  }
  if (f.flashSale) params.set('flashSale', 'true');

  const res = await api(`/api/products?${params}`);
  if (stale(token)) return;
  remember(res.data);

  const cat = state.categories.find((c) => c.slug === f.category || String(c.id) === f.category);
  const title = f.q
    ? `Kết quả cho “${f.q}”`
    : f.flashSale
      ? 'Flash Sale'
      : cat
        ? cat.name
        : f.sort === 'newest'
          ? 'Hàng mới về'
          : 'Tất cả sản phẩm';
  const total = state.categories.reduce((sum, c) => sum + c.product_count, 0);
  const { pagination } = res;

  $('#view').innerHTML = `
    ${pageHead(
      [['Trang chủ', '#/'], ['Sản phẩm', cat || f.q || f.flashSale ? '#/products' : ''], ...(cat ? [[cat.name]] : [])],
      title,
      `${pagination.totalItems} sản phẩm`
    )}
    <div class="container catalog">
      <aside class="filters" id="filters" aria-label="Bộ lọc">
        <div class="filters-head">
          <span class="eyebrow">Bộ lọc</span>
          <button class="icon-btn" data-action="filters-close" aria-label="Đóng bộ lọc">${icon('close')}</button>
        </div>
        <div class="filter-block">
          <h4>Danh mục</h4>
          <div class="filter-cats">
            <button class="${cat ? '' : 'is-active'}" data-action="set-filter" data-key="category" data-value=""><span>Tất cả</span><span>${total}</span></button>
            ${state.categories
              .map(
                (c) =>
                  `<button class="${cat?.id === c.id ? 'is-active' : ''}" data-action="set-filter" data-key="category" data-value="${esc(c.slug)}"><span>${esc(c.name)}</span><span>${c.product_count}</span></button>`
              )
              .join('')}
          </div>
        </div>
        <div class="filter-block">
          <h4>Khoảng giá (₫)</h4>
          <form data-form="price-filter">
            <div class="price-range">
              <input class="input input--sm" name="minPrice" type="number" min="0" step="1000" placeholder="Từ" value="${esc(f.minPrice)}" aria-label="Giá từ">
              <span>—</span>
              <input class="input input--sm" name="maxPrice" type="number" min="0" step="1000" placeholder="Đến" value="${esc(f.maxPrice)}" aria-label="Giá đến">
            </div>
            <button class="btn btn--sm btn--block" type="submit">Áp dụng</button>
          </form>
        </div>
        <div class="filter-block">
          <h4>Đánh giá</h4>
          ${[5, 4, 3]
            .map((r) => {
              const on = f.minRating === String(r);
              return `<button class="rating-opt ${on ? 'is-active' : ''}" data-action="set-filter" data-key="minRating" data-value="${on ? '' : r}">
                <span class="dot"></span><span class="stars">${icon('star', 'icon-fill').repeat(r)}</span><span>${r === 5 ? '5 sao' : `từ ${r} sao`}</span>
              </button>`;
            })
            .join('')}
        </div>
        <div class="filter-block">
          <label class="switch-row"><span>Chỉ hàng Flash Sale</span><input type="checkbox" class="cbx" data-change="flash-filter" ${f.flashSale ? 'checked' : ''}></label>
        </div>
        <button class="btn btn--sm btn--block" data-action="reset-filters" style="margin-top: 22px">Xóa bộ lọc</button>
      </aside>

      <div id="results">
        <div class="toolbar">
          <div class="tabs tabs--plain" role="tablist" aria-label="Sắp xếp">
            ${SORTS.map(
              ([key, label]) =>
                `<button class="tab ${f.sort === key ? 'is-active' : ''}" data-action="set-filter" data-key="sort" data-value="${key}" role="tab">${label}</button>`
            ).join('')}
          </div>
          <button class="btn btn--sm filter-toggle" data-action="filters-open">Bộ lọc</button>
        </div>
        ${activeFilterChips(f, cat)}
        ${
          res.data.length
            ? `<div class="grid">${res.data.map((p, i) => productCard(p, { i })).join('')}</div>`
            : emptyState(
                'search',
                'Không tìm thấy sản phẩm',
                'Hãy thử từ khóa khác hoặc điều chỉnh lại bộ lọc.',
                '<button class="btn btn--solid" data-action="reset-filters">Xóa bộ lọc</button>'
              )
        }
        ${paginationHtml(pagination)}
      </div>
    </div>`;
}

function activeFilterChips(f, cat) {
  const chips = [];
  if (f.q) chips.push(['q', `Từ khóa: ${f.q}`]);
  if (cat) chips.push(['category', cat.name]);
  if (f.minPrice || f.maxPrice) {
    chips.push(['price', `Giá: ${f.minPrice ? money(f.minPrice) : '0 ₫'} – ${f.maxPrice ? money(f.maxPrice) : 'không giới hạn'}`]);
  }
  if (f.minRating) chips.push(['minRating', `Từ ${f.minRating} sao`]);
  if (f.flashSale) chips.push(['flashSale', 'Flash Sale']);
  if (!chips.length) return '';
  return `<div class="active-filters">${chips
    .map(([key, label]) => `<button class="chip" data-action="clear-filter" data-key="${key}">${esc(label)} ${icon('close')}</button>`)
    .join('')}</div>`;
}

function pageList(page, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, page - 1, page, page + 1]);
  const sorted = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

function paginationHtml({ page, totalPages }) {
  if (totalPages <= 1) return '';
  const btn = (n, label, disabled = false) =>
    `<button class="page-btn ${n === page && !label ? 'is-active' : ''}" data-action="set-filter" data-key="page" data-value="${n}" ${disabled ? 'disabled' : ''} ${label ? `aria-label="${label}"` : ''}>${label ? icon(n < page ? 'left' : 'right', 'icon-sm') : n}</button>`;
  return `
    <nav class="pagination" aria-label="Phân trang">
      ${btn(page - 1, 'Trang trước', page <= 1)}
      ${pageList(page, totalPages)
        .map((n) => (n === '…' ? '<span class="page-btn" aria-hidden="true">…</span>' : btn(n)))
        .join('')}
      ${btn(page + 1, 'Trang sau', page >= totalPages)}
    </nav>`;
}

// ==========================================
// 13. CHI TIẾT SẢN PHẨM
// ==========================================
async function viewProduct({ params: [id], token }) {
  let res;
  try {
    res = await api(`/api/products/${id}`);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  if (stale(token)) return;
  if (!res) {
    renderNotFound('Sản phẩm không tồn tại hoặc đã bị người bán gỡ xuống.');
    return;
  }

  const p = res.data;
  remember([p]);
  const thumbs = Array.isArray(p.thumbnails) ? p.thumbnails.filter(Boolean) : [];
  const images = thumbs.length ? thumbs : [p.image_url];
  const out = p.stock <= 0;
  const limit = maxQty(p.stock);
  const isOwner = state.user && p.seller_id === state.user.id;
  state.pd = { product: p, images, index: 0, qty: 1 };

  $('#view').innerHTML = `
    <div class="subnav" id="subnav">
      <div class="container subnav-inner">
        <span class="subnav-name">${esc(p.name)}</span>
        <div class="tabs tabs--plain">
          <button class="tab" data-action="scroll-to" data-target="#pd-overview">Tổng quan</button>
          <button class="tab" data-action="scroll-to" data-target="#pd-description">Mô tả</button>
          <button class="tab" data-action="scroll-to" data-target="#pd-specs">Thông số</button>
          <button class="tab" data-action="scroll-to" data-target="#pd-related">Tương tự</button>
        </div>
        <div class="subnav-buy">
          <span>${money(p.price)}</span>
          <button class="btn btn--solid btn--sm" data-action="pd-buy" ${out ? 'disabled' : ''}>Mua ngay</button>
        </div>
      </div>
    </div>

    <section class="pd" id="pd-overview">
      <div class="container">
        ${breadcrumb([
          ['Trang chủ', '#/'],
          [p.category_name || 'Sản phẩm', p.category_slug ? `#/products?category=${encodeURIComponent(p.category_slug)}` : '#/products'],
          [excerpt(p.name, 48)],
        ])}
        <div class="pd-grid">
          <div class="reveal">
            <div class="gallery-main" data-action="lightbox-open" title="Bấm để xem ảnh lớn">
              <img id="pdMainImg" src="${esc(imgSrc(images[0]))}" alt="${esc(p.name)}">
              ${
                images.length > 1
                  ? `<button class="gallery-arrow gallery-prev" data-action="pd-step" data-step="-1" aria-label="Ảnh trước">${icon('left')}</button>
                     <button class="gallery-arrow gallery-next" data-action="pd-step" data-step="1" aria-label="Ảnh sau">${icon('right')}</button>`
                  : ''
              }
              <span class="gallery-count" id="pdCount">01 / ${pad2(images.length)}</span>
              <span class="gallery-zoom">${icon('zoom')}</span>
            </div>
            ${
              images.length > 1
                ? `<div class="thumbs">${images
                    .map(
                      (src, i) =>
                        `<button class="thumb ${i === 0 ? 'is-active' : ''}" data-action="pd-thumb" data-index="${i}" aria-label="Xem ảnh ${i + 1}"><img src="${esc(imgSrc(src))}" alt="" loading="lazy"></button>`
                    )
                    .join('')}</div>`
                : ''
            }
          </div>

          <div class="pd-info reveal" style="--i:1">
            <p class="eyebrow">${esc(p.category_name || 'AuraMall')}</p>
            <h1 class="pd-title">${esc(p.name)}</h1>
            <div class="pd-rating">
              ${ratingHtml(p)}${Number(p.review_count) ? `<span class="sep"></span><span>${p.review_count} đánh giá</span>` : ''}<span class="sep"></span><span>Đã bán ${compact(p.sold_count)}</span>
            </div>
            <div class="pd-price">
              <span class="now">${money(p.price)}</span>
              ${p.original_price > p.price ? `<s>${money(p.original_price)}</s><span class="tag tag--dark">-${p.discount_percent}%</span>` : ''}
              ${p.is_flash_sale ? `<span class="tag tag--gold">${icon('bolt')}Flash Sale</span>` : ''}
            </div>
            <div class="pd-row"><span>Tình trạng</span>
              <span class="stock ${out ? 'is-out' : p.stock <= 10 ? 'is-low' : ''}">${out ? 'Hết hàng' : `Còn ${p.stock} sản phẩm`}</span>
            </div>
            <div class="pd-row"><span>Người bán</span><span>${p.seller_username ? esc(p.seller_username) : 'AuraMall Official'}</span></div>
            <div class="pd-row"><span>Số lượng</span>${out ? '<span class="muted">Tạm hết hàng</span>' : qtyControl(1, limit)}</div>
            <div class="pd-actions">
              <button class="btn" data-action="pd-add" ${out ? 'disabled' : ''}>${icon('bag', 'icon-sm')} Thêm vào giỏ</button>
              <button class="btn btn--solid" data-action="pd-buy" ${out ? 'disabled' : ''}>Mua ngay</button>
            </div>
            ${isOwner ? `<p style="margin-top: 20px"><a class="link-arrow" href="#/sell/${p.id}">Chỉnh sửa sản phẩm của bạn ${icon('arrow')}</a></p>` : ''}
            <div class="pd-perks">
              <div class="perk">${icon('truck')}<span>Miễn phí vận chuyển cho đơn từ ${money(FREE_SHIP_FROM)}, phí thường ${money(SHIPPING_FEE)}.</span></div>
              <div class="perk">${icon('shield')}<span>Cam kết chính hãng, thanh toán an toàn.</span></div>
              <div class="perk">${icon('return')}<span>Đổi trả miễn phí trong 30 ngày.</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="pd-section" id="pd-description">
      <div class="container pd-desc">
        <div class="reveal">
          <p class="eyebrow">Mô tả</p>
          <h2>Câu chuyện sản phẩm</h2>
          <p>${esc(p.description || 'Người bán chưa thêm mô tả cho sản phẩm này.')}</p>
        </div>
        <div class="slant-media reveal" style="--i:1"><img src="${esc(imgSrc(images[1] || images[0]))}" alt="" loading="lazy"></div>
      </div>
    </section>

    <section class="pd-section section--mist" id="pd-specs">
      <div class="container">
        <p class="eyebrow reveal">Thông số</p>
        <h2 class="reveal">Thông tin chi tiết</h2>
        <table class="spec-table reveal">
          <tr><th>Mã sản phẩm</th><td>AUR-${String(p.id).padStart(6, '0')}</td></tr>
          <tr><th>Danh mục</th><td>${esc(p.category_name || 'Chưa phân loại')}</td></tr>
          <tr><th>Người bán</th><td>${p.seller_username ? esc(p.seller_username) : 'AuraMall Official'}</td></tr>
          <tr><th>Giá bán</th><td>${money(p.price)}${p.original_price > p.price ? ` (giá gốc ${money(p.original_price)}, giảm ${p.discount_percent}%)` : ''}</td></tr>
          <tr><th>Tồn kho</th><td>${p.stock} sản phẩm</td></tr>
          <tr><th>Đã bán</th><td>${Number(p.sold_count).toLocaleString('vi-VN')} sản phẩm</td></tr>
          <tr><th>Đánh giá</th><td>${Number(p.review_count) ? `${Number(p.rating).toFixed(1)} / 5 (${p.review_count} lượt)` : 'Chưa có đánh giá'}</td></tr>
          <tr><th>Flash Sale</th><td>${p.is_flash_sale ? 'Đang áp dụng' : 'Không'}</td></tr>
          <tr><th>Ngày đăng bán</th><td>${formatDate(p.created_at)}</td></tr>
        </table>
      </div>
    </section>

    <section class="pd-section" id="pd-related">
      <div class="container">
        <p class="eyebrow reveal">Có thể bạn thích</p>
        <h2 class="reveal">Sản phẩm tương tự</h2>
        <div class="track" id="relatedTrack" style="margin-top: 32px">
          ${'<div><div class="skeleton" style="aspect-ratio:1"></div></div>'.repeat(4)}
        </div>
        ${trackNav('relatedTrack')}
      </div>
    </section>`;

  // Thanh điều hướng phụ dính đầu trang khi đã cuộn qua khu mua hàng
  const subnav = $('#subnav');
  const anchor = $('.pd-actions');
  if ('IntersectionObserver' in window && anchor) {
    const io = new IntersectionObserver(([entry]) => {
      subnav.classList.toggle('is-visible', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    io.observe(anchor);
    onCleanup(() => io.disconnect());
  }

  loadRelated(p, token);
}

async function loadRelated(p, token) {
  const track = $('#relatedTrack');
  let items = [];
  try {
    const query = p.category_id ? `category=${p.category_id}&` : '';
    const res = await api(`/api/products?${query}limit=12&sort=popular`);
    items = res.data.filter((x) => x.id !== p.id);
    remember(items);
  } catch {
    /* khối gợi ý không bắt buộc */
  }
  if (stale(token) || !track) return;
  track.innerHTML = items.length
    ? items.map((x, i) => productCard(x, { i, reveal: false })).join('')
    : '<p class="muted">Chưa có sản phẩm tương tự.</p>';
  setupTracks();
}

function pdShow(index) {
  const pd = state.pd;
  if (!pd) return;
  pd.index = (index + pd.images.length) % pd.images.length;
  const img = $('#pdMainImg');
  img.classList.add('is-swapping');
  setTimeout(
    () => {
      img.src = imgSrc(pd.images[pd.index]);
      const done = () => img.classList.remove('is-swapping');
      if (img.complete) done();
      else img.addEventListener('load', done, { once: true });
    },
    REDUCED_MOTION ? 0 : 180
  );
  $$('.thumb').forEach((thumb, k) => thumb.classList.toggle('is-active', k === pd.index));
  $('#pdCount').textContent = `${pad2(pd.index + 1)} / ${pad2(pd.images.length)}`;
}

function setPdQty(value) {
  const pd = state.pd;
  if (!pd) return;
  const limit = maxQty(pd.product.stock);
  const qty = Math.min(Math.max(Number.parseInt(value, 10) || 1, 1), Math.max(limit, 1));
  pd.qty = qty;
  const box = $('.pd-info .qty');
  if (box) box.outerHTML = qtyControl(qty, limit);
}

// ==========================================
// 14. TRANG GIỎ HÀNG
// ==========================================
async function viewCart({ token }) {
  if (state.cart.length) await refreshCartProducts().catch(() => {});
  if (stale(token)) return;
  renderCartPage();
}

function renderCartPage() {
  if (!state.cart.length) {
    $('#view').innerHTML = `
      ${pageHead([['Trang chủ', '#/'], ['Giỏ hàng']], 'Giỏ hàng')}
      <section class="container">${emptyState(
        'bag',
        'Giỏ hàng đang trống',
        'Hãy khám phá các dòng sản phẩm và chọn cho mình món đồ ưng ý.',
        '<a class="btn btn--solid" href="#/products">Tiếp tục mua sắm</a>'
      )}</section>`;
    return;
  }

  const items = [...state.cart].reverse(); // mới thêm hiển thị trước
  $('#view').innerHTML = `
    ${pageHead([['Trang chủ', '#/'], ['Giỏ hàng']], 'Giỏ hàng', `${cartCount()} sản phẩm`)}
    <div class="container cart-layout">
      <div class="cart-head">
        <span><input type="checkbox" class="cbx" data-change="cart-all" aria-label="Chọn tất cả"></span>
        <span>Sản phẩm</span><span>Đơn giá</span><span>Số lượng</span><span>Thành tiền</span><span></span>
      </div>
      ${items.map((it, i) => cartRowHtml(it, i)).join('')}
      <p style="margin-top: 28px"><a class="link-arrow" href="#/products">Tiếp tục mua sắm ${icon('arrow')}</a></p>
    </div>
    <div class="checkout-bar">
      <div class="container checkout-bar-inner">
        <div class="bar-left">
          <label class="check"><input type="checkbox" class="cbx" data-change="cart-all"> Chọn tất cả (${state.cart.length})</label>
          <button class="text-btn" data-action="cart-remove-selected">Xóa đã chọn</button>
        </div>
        <div class="bar-right">
          <div class="bar-total"><span>Tổng thanh toán (<b id="selCount">0</b> sản phẩm)</span><strong id="selTotal">0 ₫</strong></div>
          <button class="btn btn--gold" data-action="cart-checkout">Mua hàng</button>
        </div>
      </div>
    </div>`;
  updateCartSummary();
}

function cartRowHtml(it, i = 0) {
  const p = it.product;
  const buyable = isBuyable(it);
  const note = it.unavailable ? 'Sản phẩm không còn được bán' : p.stock <= 0 ? 'Đã hết hàng' : `Còn ${p.stock} sản phẩm`;
  return `
    <div class="cart-row ${buyable ? '' : 'is-unavailable'}" data-row="${it.productId}" style="--i:${i}">
      <span class="c-check"><input type="checkbox" class="cbx" data-change="cart-select" data-id="${it.productId}" ${state.selected.has(it.productId) && buyable ? 'checked' : ''} ${buyable ? '' : 'disabled'} aria-label="Chọn sản phẩm"></span>
      <div class="c-product cart-product">
        <a class="cart-thumb" href="#/product/${it.productId}"><img src="${esc(imgSrc(p.image_url))}" alt="" loading="lazy"></a>
        <div>
          <a class="cart-name" href="#/product/${it.productId}">${esc(p.name)}</a>
          <p class="cart-note ${buyable && p.stock > 10 ? '' : 'is-warn'}">${note}</p>
        </div>
      </div>
      <div class="c-price">${money(p.price)}</div>
      <div class="c-qty">${buyable ? qtyControl(it.quantity, maxQty(p.stock), { id: it.productId, small: true }) : '<span class="muted">—</span>'}</div>
      <div class="c-total">${money(p.price * it.quantity)}</div>
      <button class="icon-btn c-remove" data-action="cart-remove" data-id="${it.productId}" aria-label="Xóa khỏi giỏ">${icon('trash', 'icon-sm')}</button>
    </div>`;
}

function updateCartSummary() {
  const items = selectedItems();
  const buyable = state.cart.filter(isBuyable);
  const total = items.reduce((sum, it) => sum + it.product.price * it.quantity, 0);
  const countEl = $('#selCount');
  if (!countEl) return;
  countEl.textContent = items.reduce((sum, it) => sum + it.quantity, 0);
  $('#selTotal').textContent = money(total);
  const all = buyable.length > 0 && items.length === buyable.length;
  $$('[data-change="cart-all"]').forEach((box) => (box.checked = all));
}

function setCartQty(id, value) {
  const item = state.cart.find((it) => it.productId === id);
  if (!item) return;
  const limit = maxQty(item.product.stock);
  item.quantity = Math.min(Math.max(Number.parseInt(value, 10) || 1, 1), Math.max(limit, 1));
  saveCart();
  const row = $(`[data-row="${id}"]`);
  if (row) {
    row.querySelector('.c-qty').innerHTML = qtyControl(item.quantity, limit, { id, small: true });
    row.querySelector('.c-total').textContent = money(item.product.price * item.quantity);
  }
  updateCartSummary();
}

function removeFromCart(ids) {
  const set = new Set(ids);
  const rows = $$('.cart-row').filter((row) => set.has(Number(row.dataset.row)));
  rows.forEach((row) => row.classList.add('is-removing'));
  setTimeout(
    () => {
      state.cart = state.cart.filter((it) => !set.has(it.productId));
      set.forEach((id) => state.selected.delete(id));
      saveCart();
      if (state.route.path === '/cart') renderCartPage();
    },
    REDUCED_MOTION ? 0 : 340
  );
}

async function goCheckout() {
  if (!selectedItems().length) {
    await confirmDialog('Thông báo', 'Bạn chưa chọn sản phẩm nào để mua.', { okText: 'Đã hiểu', cancelText: '' });
    return;
  }
  if (!state.token) {
    toast('Vui lòng đăng nhập để thanh toán.', 'error');
    go(`/login?redirect=${encodeURIComponent('/checkout')}`);
    return;
  }
  go('/checkout');
}

// ==========================================
// 15. THANH TOÁN (LUỒNG 2: POST /api/orders)
// ==========================================
async function viewCheckout({ token }) {
  if (state.cart.length) await refreshCartProducts().catch(() => {});
  if (stale(token)) return;
  const items = selectedItems();
  if (!items.length) {
    toast('Vui lòng chọn sản phẩm trong giỏ hàng trước khi thanh toán.', 'error');
    redirect('/cart');
    return;
  }
  await loadAddresses();
  if (stale(token)) return;

  const goods = items.reduce((sum, it) => sum + it.product.price * it.quantity, 0);
  const shipping = goods >= FREE_SHIP_FROM ? 0 : SHIPPING_FEE;
  const progress = Math.min(100, Math.round((goods / FREE_SHIP_FROM) * 100));
  const defaultAddress = state.addresses.find((a) => a.is_default) || state.addresses[0];
  state.co = { items, addressId: defaultAddress?.id ?? null, total: goods + shipping };

  $('#view').innerHTML = `
    ${pageHead([['Trang chủ', '#/'], ['Giỏ hàng', '#/cart'], ['Thanh toán']], 'Thanh toán')}
    <div class="container checkout">
      <div>
        <div class="panel" style="--i:0">
          <div class="panel-title">${icon('pin')} Địa chỉ nhận hàng</div>
          <div id="coAddress"></div>
        </div>
        <div class="panel" style="--i:1">
          <div class="panel-title">${icon('box')} Sản phẩm (${items.length})</div>
          ${items
            .map(
              (it) => `
              <div class="co-item">
                <img src="${esc(imgSrc(it.product.image_url))}" alt="" loading="lazy">
                <div><strong>${esc(it.product.name)}</strong><span>${money(it.product.price)} × ${it.quantity}</span></div>
                <b>${money(it.product.price * it.quantity)}</b>
              </div>`
            )
            .join('')}
        </div>
        <div class="panel" style="--i:2">
          <div class="panel-title">${icon('edit')} Lời nhắn cho người bán</div>
          <input class="input" id="coNote" maxlength="500" placeholder="Ví dụ: giao giờ hành chính, gọi trước khi giao...">
        </div>
        <div class="panel" style="--i:3">
          <div class="panel-title">${icon('shield')} Phương thức thanh toán</div>
          <label class="pay-opt"><input type="radio" name="payment" value="COD" checked>
            <div><strong>Thanh toán khi nhận hàng (COD)</strong><span>Trả tiền mặt cho nhân viên giao hàng.</span></div></label>
          <label class="pay-opt"><input type="radio" name="payment" value="BANK_TRANSFER">
            <div><strong>Chuyển khoản ngân hàng (VietQR)</strong><span>Chuyển khoản 24/7, đơn được xác nhận sau khi nhận tiền.</span></div></label>
        </div>
      </div>
      <aside class="summary">
        <h3>Tóm tắt đơn hàng</h3>
        <div class="summary-row"><span>Tạm tính (${items.reduce((s, it) => s + it.quantity, 0)} sản phẩm)</span><span>${money(goods)}</span></div>
        <div class="summary-row"><span>Phí vận chuyển</span><span>${shipping ? money(shipping) : 'Miễn phí'}</span></div>
        <div class="ship-progress"><span style="width:${progress}%"></span></div>
        <p class="hint">${shipping ? `Mua thêm ${money(FREE_SHIP_FROM - goods)} để được miễn phí vận chuyển.` : 'Đơn hàng được miễn phí vận chuyển.'}</p>
        <div class="summary-row summary-total"><span>Tổng thanh toán</span><strong>${money(goods + shipping)}</strong></div>
        <button class="btn btn--solid btn--block" data-action="place-order" style="margin-top: 24px">Đặt hàng</button>
        <p style="margin-top: 18px"><a class="text-btn" href="#/cart">Quay lại giỏ hàng</a></p>
      </aside>
    </div>`;
  renderCoAddress();
}

function renderCoAddress() {
  const box = $('#coAddress');
  if (!box || !state.co) return;
  const addr = state.addresses.find((a) => a.id === state.co.addressId);
  box.innerHTML = addr
    ? `<div class="address-card">
         <div>
           <strong>${esc(addr.recipient_name)}</strong> <span class="muted">· ${esc(addr.phone)}</span>${addr.is_default ? '<span class="badge">Mặc định</span>' : ''}
           <p>${esc(addr.detail_address)}</p>
         </div>
         <button class="text-btn" data-action="co-pick-address">Thay đổi</button>
       </div>`
    : `<div class="address-card"><p class="muted">Bạn chưa có địa chỉ nhận hàng.</p>
         <button class="btn btn--sm" data-action="address-new">${icon('plus', 'icon-sm')} Thêm địa chỉ</button></div>`;
}

function pickAddress() {
  openModal(
    `<h3 class="modal-title">Chọn địa chỉ nhận hàng</h3>
     <form data-form="pick-address">
       <div class="pick-list">
         ${state.addresses
           .map(
             (a) => `
             <label class="pick-item">
               <input type="radio" name="addressId" value="${a.id}" ${a.id === state.co.addressId ? 'checked' : ''}>
               <div><strong>${esc(a.recipient_name)}</strong> <span class="muted">· ${esc(a.phone)}</span>${a.is_default ? '<span class="badge">Mặc định</span>' : ''}
                 <p class="muted" style="font-size: 14px; margin-top: 4px">${esc(a.detail_address)}</p></div>
             </label>`
           )
           .join('')}
       </div>
       <div class="modal-actions">
         <button type="button" class="btn" data-action="address-new">${icon('plus', 'icon-sm')} Địa chỉ mới</button>
         <button type="submit" class="btn btn--solid">Xác nhận</button>
       </div>
     </form>`,
    { wide: true }
  );
}

async function placeOrder(button) {
  const co = state.co;
  const addr = state.addresses.find((a) => a.id === co?.addressId);
  if (!addr) {
    toast('Vui lòng thêm địa chỉ nhận hàng trước khi đặt hàng.', 'error');
    openAddressForm();
    return;
  }
  const paymentMethod = $('input[name="payment"]:checked')?.value || 'COD';
  setBusy(button, true, 'Đang xử lý đơn hàng...');
  try {
    const res = await api('/api/orders', {
      method: 'POST',
      body: {
        items: co.items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
        recipientName: addr.recipient_name,
        recipientPhone: addr.phone,
        shippingAddress: addr.detail_address,
        paymentMethod,
        note: $('#coNote').value.trim(),
      },
    });
    const bought = new Set(co.items.map((it) => it.productId));
    state.cart = state.cart.filter((it) => !bought.has(it.productId));
    bought.forEach((id) => state.selected.delete(id));
    saveCart();
    invalidateCatalog();
    showOrderSuccess(res, paymentMethod);
  } catch (err) {
    // Hết hàng: "rất tiếc, sản phẩm vừa hết hàng do số lượng có hạn!"
    toast(err.message, 'error');
    setBusy(button, false);
  }
}

function showOrderSuccess(res, paymentMethod) {
  openModal(
    `<div style="text-align: center">
       <div class="success-mark">${icon('check')}</div>
       <h3 class="modal-title">Đặt hàng thành công</h3>
       <p class="modal-text">Cảm ơn bạn đã mua sắm tại AuraMall. Đơn hàng đã được ghi nhận vào hệ thống.</p>
       <div class="success-box">
         <div><span>Mã đơn hàng</span><strong>${esc(res.orderCode || `#${res.orderId}`)}</strong></div>
         <div><span>Tổng thanh toán</span><strong>${money(res.finalTotal ?? res.totalPrice)}</strong></div>
         <div><span>Thanh toán</span><span>${esc(PAYMENT_LABEL[paymentMethod] || paymentMethod)}</span></div>
       </div>
       <div class="modal-actions" style="justify-content: center">
         <a class="btn" href="#/">Về trang chủ</a>
         <a class="btn btn--solid" href="#/account/orders">Xem đơn mua</a>
       </div>
     </div>`,
    { onClose: () => redirect('/account/orders') }
  );
}

// ==========================================
// 16. ĐĂNG NHẬP / ĐĂNG KÝ
// ==========================================
const viewLogin = (ctx) => renderAuth('login', ctx);
const viewRegister = (ctx) => renderAuth('register', ctx);

function afterAuthPath() {
  const target = state.route.query.get('redirect') || '';
  return target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/login') ? target : '/';
}

function renderAuth(mode, { query }) {
  if (state.token) {
    redirect(afterAuthPath());
    return;
  }
  const login = mode === 'login';
  const keep = query.get('redirect') ? `?redirect=${encodeURIComponent(query.get('redirect'))}` : '';
  $('#view').innerHTML = `
    <section class="auth">
      <div class="auth-visual">
        <img src="/images/products/auraphone-pro.jpg" alt="">
        <div>
          <p class="eyebrow">Đặc quyền thành viên</p>
          <h2>${login ? 'Chào mừng trở lại' : 'Gia nhập AuraMall'}</h2>
          <p>Đăng nhập để lưu giỏ hàng, theo dõi đơn mua, đăng bán sản phẩm và nhận ưu đãi Flash Sale mỗi ngày.</p>
          <ul class="auth-perks">
            <li>${icon('bolt')}Flash Sale giảm đến 50% mỗi ngày</li>
            <li>${icon('truck')}Miễn phí vận chuyển cho đơn từ ${money(FREE_SHIP_FROM)}</li>
            <li>${icon('shield')}Cam kết chính hãng, đổi trả trong 30 ngày</li>
          </ul>
        </div>
      </div>
      <div class="auth-form-wrap">
        <div class="auth-form">
          <div class="tabs">
            <a class="tab ${login ? 'is-active' : ''}" href="#/login${keep}">Đăng nhập</a>
            <a class="tab ${login ? '' : 'is-active'}" href="#/register${keep}">Đăng ký</a>
          </div>
          ${login ? loginFormHtml(keep) : registerFormHtml(keep)}
        </div>
      </div>
    </section>`;
}

function passwordInput(id, name, autocomplete) {
  return `<div class="pw-wrap">
    <input class="input" id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" required>
    <button type="button" class="pw-toggle" data-action="pw-toggle" aria-label="Hiện mật khẩu">Hiện</button>
  </div>`;
}

function loginFormHtml(keep) {
  return `
    <form data-form="login" novalidate>
      <div class="field">
        <label for="loginId">Tên đăng nhập / Email / Số điện thoại</label>
        <input class="input" id="loginId" name="login" autocomplete="username" required>
      </div>
      <div class="field">
        <label for="loginPw">Mật khẩu</label>
        ${passwordInput('loginPw', 'password', 'current-password')}
      </div>
      <div class="form-row">
        <label class="check"><input type="checkbox" class="cbx" name="remember" checked> Ghi nhớ đăng nhập</label>
        <button type="button" class="text-btn" data-action="forgot-password">Quên mật khẩu?</button>
      </div>
      <button class="btn btn--solid btn--block" type="submit">Đăng nhập</button>
      <div class="divider-text">Hoặc</div>
      <div class="social">
        <button type="button" class="btn btn--sm" data-action="social-login" data-provider="Google">Google</button>
        <button type="button" class="btn btn--sm" data-action="social-login" data-provider="Facebook">Facebook</button>
      </div>
      <p class="auth-switch">Chưa có tài khoản? <a href="#/register${keep}" class="link-lux">Đăng ký ngay</a></p>
      <div class="demo-hint">Tài khoản mẫu: <code>auramall_user</code> / <code>Password123</code></div>
    </form>`;
}

function registerFormHtml(keep) {
  return `
    <form data-form="register" novalidate>
      <div class="field">
        <label for="regUsername">Tên đăng nhập</label>
        <input class="input" id="regUsername" name="username" autocomplete="username" placeholder="3 - 30 ký tự: chữ, số, dấu gạch dưới" required>
      </div>
      <div class="field">
        <label for="regEmail">Email</label>
        <input class="input" id="regEmail" name="email" type="email" autocomplete="email" placeholder="ban@vidu.com" required>
      </div>
      <div class="field">
        <label for="regPhone">Số điện thoại</label>
        <input class="input" id="regPhone" name="phone" type="tel" autocomplete="tel" placeholder="10 - 11 chữ số, vd: 0969795794" required>
      </div>
      <div class="field">
        <label for="regPw">Mật khẩu</label>
        ${passwordInput('regPw', 'password', 'new-password')}
        <ul class="checklist" id="pwChecklist">
          <li data-rule="len">Tối thiểu 8 ký tự</li>
          <li data-rule="upper">Có chữ in hoa</li>
          <li data-rule="lower">Có chữ thường</li>
          <li data-rule="digit">Có chữ số</li>
        </ul>
      </div>
      <div class="field">
        <label for="regPw2">Nhập lại mật khẩu</label>
        ${passwordInput('regPw2', 'confirmPassword', 'new-password')}
        <span class="hint" id="pwMatch"></span>
      </div>
      <div class="form-row">
        <label class="check"><input type="checkbox" class="cbx" name="agree" checked> Tôi đồng ý với Điều khoản dịch vụ và Chính sách bảo mật</label>
      </div>
      <button class="btn btn--solid btn--block" type="submit">Đăng ký</button>
      <p class="auth-switch">Đã có tài khoản? <a href="#/login${keep}" class="link-lux">Đăng nhập</a></p>
    </form>`;
}

const PASSWORD_RULES = {
  len: (v) => v.length >= 8,
  upper: (v) => /[A-Z]/.test(v),
  lower: (v) => /[a-z]/.test(v),
  digit: (v) => /\d/.test(v),
};
const PHONE_RE = /^(0|\+84)[0-9]{9,10}$/;

function updatePasswordHints() {
  const pw = $('#regPw')?.value ?? '';
  const pw2 = $('#regPw2')?.value ?? '';
  $$('#pwChecklist li').forEach((li) => li.classList.toggle('is-ok', PASSWORD_RULES[li.dataset.rule](pw)));
  const match = $('#pwMatch');
  if (!match) return;
  if (!pw2) {
    match.textContent = '';
    match.className = 'hint';
  } else if (pw === pw2) {
    match.textContent = 'Mật khẩu khớp nhau.';
    match.className = 'hint is-ok';
  } else {
    match.textContent = 'Mật khẩu nhập lại chưa khớp.';
    match.className = 'hint is-bad';
  }
}

async function submitLogin(form, button) {
  const login = form.login.value.trim();
  const password = form.password.value;
  if (!login || !password) {
    toast('Vui lòng nhập tên đăng nhập và mật khẩu.', 'error');
    return;
  }
  setBusy(button, true, 'Đang đăng nhập...');
  try {
    const res = await api('/api/auth/login', { method: 'POST', body: { login, password, remember: form.remember.checked } });
    setSession(res.token, res.user);
    loadMe();
    toast(`Xin chào, ${res.user.username}!`);
    redirect(afterAuthPath());
  } catch (err) {
    toast(err.message, 'error');
    setBusy(button, false);
  }
}

async function submitRegister(form, button) {
  const data = {
    username: form.username.value.trim(),
    email: form.email.value.trim(),
    phone: form.phone.value.trim(),
    password: form.password.value,
    confirmPassword: form.confirmPassword.value,
  };
  let error = '';
  if (!data.username || !data.email || !data.phone || !data.password) error = 'Vui lòng điền đầy đủ tất cả các trường thông tin.';
  else if (!/^[a-zA-Z0-9_]{3,30}$/.test(data.username)) error = 'Tên đăng nhập 3 - 30 ký tự, chỉ gồm chữ, số và dấu gạch dưới.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) error = 'Địa chỉ email không đúng định dạng.';
  else if (!PHONE_RE.test(data.phone)) error = 'Số điện thoại phải gồm 10 hoặc 11 chữ số.';
  else if (!Object.values(PASSWORD_RULES).every((rule) => rule(data.password)))
    error = 'Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số.';
  else if (data.password !== data.confirmPassword) error = 'Mật khẩu nhập lại không khớp.';
  else if (!form.agree.checked) error = 'Vui lòng đồng ý với Điều khoản dịch vụ của AuraMall.';
  if (error) {
    toast(error, 'error');
    return;
  }

  setBusy(button, true, 'Đang tạo tài khoản...');
  try {
    const res = await api('/api/auth/register', { method: 'POST', body: data });
    setSession(res.token, res.user);
    loadMe();
    toast('Đăng ký tài khoản thành công!');
    redirect(afterAuthPath());
  } catch (err) {
    toast(err.message, 'error');
    setBusy(button, false);
  }
}

// ==========================================
// 17. TRUNG TÂM TÀI KHOẢN: HỒ SƠ, ĐỊA CHỈ, ĐƠN MUA, SẢN PHẨM CỦA TÔI
// ==========================================
const ACCOUNT_NAV = [
  ['profile', 'user', 'Hồ sơ của tôi'],
  ['addresses', 'pin', 'Địa chỉ nhận hàng'],
  ['orders', 'box', 'Đơn mua'],
  ['products', 'store', 'Sản phẩm của tôi'],
];

async function viewAccount({ params: [tab = 'profile'], token }) {
  await loadMe(); // lấy hồ sơ mới nhất (ngày tham gia, ảnh đại diện...)
  if (stale(token)) return;
  if (!state.user) {
    redirect(`/login?redirect=${encodeURIComponent(state.route.full)}`);
    return;
  }
  const label = ACCOUNT_NAV.find(([key]) => key === tab)?.[2] || 'Tài khoản';
  $('#view').innerHTML = `
    ${pageHead([['Trang chủ', '#/'], ['Tài khoản', '#/account/profile'], [label]], 'Tài khoản của tôi')}
    <div class="container account">
      <aside class="account-side">
        <div class="account-user">
          <img class="avatar" id="sideAvatar" src="${esc(avatarSrc(state.user))}" alt="">
          <div><strong>${esc(state.user.username)}</strong><span>Thành viên từ ${formatDate(state.user.created_at) || '2026'}</span></div>
        </div>
        <nav class="account-nav">
          ${ACCOUNT_NAV.map(
            ([key, ic, text]) => `<a href="#/account/${key}" class="${key === tab ? 'is-active' : ''}">${icon(ic, 'icon-sm')}${text}</a>`
          ).join('')}
          <a href="#/sell">${icon('plus', 'icon-sm')}Đăng bán sản phẩm</a>
          <button data-action="logout">${icon('logout', 'icon-sm')}Đăng xuất</button>
        </nav>
      </aside>
      <section class="account-panel" id="accountPanel"></section>
    </div>`;
  await ACCOUNT_TABS[tab](token);
}

function panelHead(eyebrow, title, desc, action = '') {
  return `<div class="panel-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2><p>${esc(desc)}</p></div>${action}</div>`;
}

const ACCOUNT_TABS = {
  async profile() {
    const u = state.user;
    state.pendingAvatar = null;
    const gender = ['nam', 'nu', 'khac'].includes(u.gender) ? u.gender : '';
    $('#accountPanel').innerHTML = `
      ${panelHead('Hồ sơ', 'Hồ sơ của tôi', 'Quản lý thông tin hồ sơ để bảo mật tài khoản.')}
      <form data-form="profile" class="profile-grid" novalidate>
        <div>
          <div class="field"><label>Tên đăng nhập</label><input class="input" value="${esc(u.username)}" disabled>
            <span class="hint">Tên đăng nhập cố định để định danh tài khoản.</span></div>
          <div class="field"><label for="pfEmail">Email</label><input class="input" id="pfEmail" name="email" type="email" value="${esc(u.email)}" required></div>
          <div class="field"><label for="pfPhone">Số điện thoại</label><input class="input" id="pfPhone" name="phone" type="tel" value="${esc(u.phone)}" required></div>
          <div class="field"><span class="label">Giới tính</span>
            <div class="radio-row">
              ${[['nam', 'Nam'], ['nu', 'Nữ'], ['khac', 'Khác']]
                .map(([value, text]) => `<label class="check"><input type="radio" name="gender" value="${value}" ${gender === value ? 'checked' : ''}> ${text}</label>`)
                .join('')}
            </div>
          </div>
          <div class="field"><label for="pfBirthday">Ngày sinh</label>
            <input class="input" id="pfBirthday" name="birthday" type="date" max="${toDateInput(new Date())}" value="${toDateInput(u.birthday)}"></div>
          <button class="btn btn--solid" type="submit">Lưu thay đổi</button>
        </div>
        <div class="avatar-box">
          <img class="avatar-xl" id="avatarPreview" src="${esc(avatarSrc(u))}" alt="Ảnh đại diện">
          <input type="file" id="avatarFile" accept="image/png, image/jpeg" data-change="avatar-file" hidden>
          <button type="button" class="btn btn--sm" data-action="avatar-pick">Chọn ảnh</button>
          <p class="hint">Dung lượng tối đa 2MB.<br>Định dạng: .PNG, .JPG, .JPEG</p>
        </div>
      </form>`;
  },

  async addresses(token) {
    await loadAddresses();
    if (token !== undefined && stale(token)) return;
    renderAddressList();
  },

  async orders(token) {
    const panel = $('#accountPanel');
    panel.innerHTML = `${panelHead('Đơn mua', 'Đơn mua của tôi', 'Tra cứu lại các đơn hàng đã đặt thành công.')}<div class="skeleton" style="height: 180px"></div>`;
    const res = await api('/api/orders');
    if (stale(token)) return;
    panel.innerHTML = `
      ${panelHead('Đơn mua', 'Đơn mua của tôi', 'Tra cứu lại các đơn hàng đã đặt thành công.')}
      ${
        res.data.length
          ? res.data.map(orderHtml).join('')
          : emptyState('box', 'Chưa có đơn hàng', 'Các đơn bạn đặt sẽ xuất hiện tại đây.', '<a class="btn btn--solid" href="#/products">Khám phá sản phẩm</a>')
      }`;
  },

  async products(token) {
    const panel = $('#accountPanel');
    const action = `<a class="btn btn--solid btn--sm" href="#/sell">${icon('plus', 'icon-sm')} Đăng bán</a>`;
    panel.innerHTML = `${panelHead('Kênh người bán', 'Sản phẩm của tôi', 'Sản phẩm bạn đã đăng bán trên AuraMall.', action)}<div class="skeleton" style="height: 180px"></div>`;
    const res = await api('/api/user/products');
    if (stale(token)) return;
    remember(res.data);
    panel.innerHTML = `
      ${panelHead('Kênh người bán', 'Sản phẩm của tôi', `${res.total} sản phẩm đang đăng bán.`, action)}
      ${
        res.data.length
          ? res.data
              .map(
                (p, i) => `
                <div class="mine-row" style="--i:${i}">
                  <img src="${esc(imgSrc(p.image_url))}" alt="" loading="lazy">
                  <div><a class="name" href="#/product/${p.id}">${esc(p.name)}</a><small>${esc(p.category_name || '')} · Đăng ngày ${formatDate(p.created_at)}</small></div>
                  <div>${money(p.price)}${p.original_price > p.price ? `<small><s>${money(p.original_price)}</s></small>` : ''}</div>
                  <div><small>Tồn kho</small>${p.stock}</div>
                  <div><small>Đã bán</small>${p.sold_count}</div>
                  <div class="mine-actions">
                    <a class="text-btn" href="#/sell/${p.id}">Sửa</a>
                    <button class="text-btn text-btn--danger" data-action="product-delete" data-id="${p.id}">Xóa</button>
                  </div>
                </div>`
              )
              .join('')
          : emptyState('store', 'Bạn chưa đăng bán sản phẩm nào', 'Đăng sản phẩm đầu tiên để bắt đầu bán hàng cùng AuraMall.', '<a class="btn btn--solid" href="#/sell">Đăng bán sản phẩm</a>')
      }`;
  },
};

function orderHtml(o, i) {
  const items = Array.isArray(o.items) && o.items.length ? o.items : [{ name: o.product_name, image: o.product_image, quantity: o.quantity, unitPrice: o.total_price / (o.quantity || 1) }];
  return `
    <article class="order" style="--i:${i}">
      <div class="order-head">
        <span>Mã đơn <strong>${esc(o.order_code || `#${o.id}`)}</strong> · ${formatDate(o.created_at, true)}</span>
        <span class="status">${esc(ORDER_STATUS[o.status] || o.status)}</span>
      </div>
      <div class="order-items">
        ${items
          .map(
            (it) => `
            <div class="order-item">
              <img src="${esc(imgSrc(it.image))}" alt="" loading="lazy">
              <div><strong>${it.productId ? `<a href="#/product/${it.productId}">${esc(it.name)}</a>` : esc(it.name)}</strong><span>${money(it.unitPrice)} × ${it.quantity}</span></div>
              <span>${money(Number(it.unitPrice) * Number(it.quantity))}</span>
            </div>`
          )
          .join('')}
      </div>
      <div class="order-foot">
        <span>Giao đến: ${esc(o.recipient_name || '')} · ${esc(o.shipping_address || '')}<br>${esc(PAYMENT_LABEL[o.payment_method] || o.payment_method || '')} · Phí vận chuyển ${Number(o.shipping_fee) ? money(o.shipping_fee) : 'miễn phí'}</span>
        <span>Thành tiền <strong>${money(o.final_total || o.total_price)}</strong></span>
      </div>
    </article>`;
}

async function loadAddresses() {
  const res = await api('/api/user/addresses');
  state.addresses = res.data;
  return state.addresses;
}

function renderAddressList() {
  const panel = $('#accountPanel');
  if (!panel) return;
  const only = state.addresses.length <= 1;
  const action = `<button class="btn btn--solid btn--sm" data-action="address-new">${icon('plus', 'icon-sm')} Thêm địa chỉ</button>`;
  panel.innerHTML = `
    ${panelHead('Sổ địa chỉ', 'Địa chỉ nhận hàng', 'Quản lý địa chỉ giao hàng dùng khi thanh toán.', action)}
    ${
      state.addresses.length
        ? state.addresses
            .map(
              (a, i) => `
              <div class="addr" style="--i:${i}">
                <div>
                  <strong>${esc(a.recipient_name)}</strong> <span class="muted">· ${esc(a.phone)}</span>${a.is_default ? '<span class="badge">Mặc định</span>' : ''}
                  <p>${esc(a.detail_address)}</p>
                </div>
                <div class="addr-actions">
                  ${a.is_default ? '' : `<button class="text-btn" data-action="address-default" data-id="${a.id}">Đặt làm mặc định</button>`}
                  <button class="text-btn" data-action="address-edit" data-id="${a.id}">Cập nhật</button>
                  <button class="text-btn text-btn--danger" data-action="address-delete" data-id="${a.id}" ${only ? 'disabled title="Cần ít nhất 1 địa chỉ nhận hàng"' : ''}>Xóa</button>
                </div>
              </div>`
            )
            .join('')
        : emptyState('pin', 'Chưa có địa chỉ', 'Thêm địa chỉ để thanh toán nhanh hơn.')
    }`;
}

function openAddressForm(addr = null) {
  openModal(
    `<h3 class="modal-title">${addr ? 'Cập nhật địa chỉ' : 'Thêm địa chỉ mới'}</h3>
     <form data-form="address" data-id="${addr?.id ?? ''}" novalidate>
       <div class="field"><label for="adName">Họ và tên người nhận</label>
         <input class="input" id="adName" name="recipientName" maxlength="100" value="${esc(addr?.recipient_name ?? '')}" required></div>
       <div class="field"><label for="adPhone">Số điện thoại</label>
         <input class="input" id="adPhone" name="phone" type="tel" value="${esc(addr?.phone ?? state.user?.phone ?? '')}" required></div>
       <div class="field"><label for="adDetail">Địa chỉ chi tiết</label>
         <textarea class="input" id="adDetail" name="detailAddress" rows="3" placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố" required>${esc(addr?.detail_address ?? '')}</textarea></div>
       <label class="check"><input type="checkbox" class="cbx" name="isDefault" ${addr?.is_default || !state.addresses.length ? 'checked' : ''}> Đặt làm địa chỉ mặc định</label>
       <div class="modal-actions">
         <button type="button" class="btn" data-action="modal-close">Trở lại</button>
         <button type="submit" class="btn btn--solid">Hoàn thành</button>
       </div>
     </form>`
  );
}

async function submitAddress(form, button) {
  const body = {
    recipientName: form.recipientName.value.trim(),
    phone: form.phone.value.trim(),
    detailAddress: form.detailAddress.value.trim(),
    isDefault: form.isDefault.checked,
  };
  if (!body.recipientName || !body.phone || !body.detailAddress) {
    toast('Vui lòng nhập tên người nhận, số điện thoại và địa chỉ cụ thể.', 'error');
    return;
  }
  if (!PHONE_RE.test(body.phone)) {
    toast('Số điện thoại phải gồm 10 hoặc 11 chữ số.', 'error');
    return;
  }
  const id = form.dataset.id;
  setBusy(button, true, 'Đang lưu...');
  try {
    const res = id
      ? await api(`/api/user/addresses/${id}`, { method: 'PUT', body })
      : await api('/api/user/addresses', { method: 'POST', body });
    toast(id ? 'Cập nhật địa chỉ thành công.' : 'Thêm địa chỉ mới thành công.');
    closeModal({ silent: true });
    await loadAddresses();
    renderAddressList();
    if (state.co && $('#coAddress')) {
      state.co.addressId = res.data.id; // địa chỉ vừa lưu được chọn để giao hàng
      renderCoAddress();
    }
  } catch (err) {
    toast(err.message, 'error');
    setBusy(button, false);
  }
}

async function submitProfile(form, button) {
  const body = {
    email: form.email.value.trim(),
    phone: form.phone.value.trim(),
    gender: form.gender.value || undefined,
    birthday: form.birthday.value || undefined,
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    toast('Địa chỉ email không hợp lệ.', 'error');
    return;
  }
  if (!PHONE_RE.test(body.phone)) {
    toast('Số điện thoại phải gồm 10 hoặc 11 chữ số.', 'error');
    return;
  }
  if (body.birthday && body.birthday > toDateInput(new Date())) {
    toast('Ngày sinh không được vượt quá ngày hiện tại.', 'error');
    return;
  }
  setBusy(button, true, 'Đang lưu...');
  try {
    if (state.pendingAvatar) {
      await api('/api/user/avatar', { method: 'POST', body: { imageBase64: state.pendingAvatar } });
      state.pendingAvatar = null;
    }
    const res = await api('/api/user/profile', { method: 'PUT', body });
    state.user = { ...state.user, ...res.data };
    renderAccountMenu();
    $('#sideAvatar').src = avatarSrc(state.user);
    toast('cập nhật hồ sơ thành công'); // đúng câu thông báo trong bản đặc tả
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

// Xem trước ảnh đại diện ngay khi chọn, chỉ tải lên khi bấm "Lưu thay đổi"
function pickAvatarFile(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (!/\.(png|jpe?g)$/i.test(file.name) || !/^image\/(png|jpeg)$/.test(file.type)) {
    toast('Định dạng hợp lệ: chỉ chấp nhận .png/.jpg/.jpeg', 'error');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    toast('Dung lượng file tối đa 2MB. Vui lòng chọn ảnh nhỏ hơn.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.pendingAvatar = reader.result;
    $('#avatarPreview').src = reader.result;
    toast('Đã chọn ảnh. Bấm "Lưu thay đổi" để cập nhật.');
  };
  reader.readAsDataURL(file);
}

// ==========================================
// 18. KÊNH NGƯỜI BÁN: ĐĂNG BÁN / SỬA SẢN PHẨM
// ==========================================
async function viewSell({ params: [id], token }) {
  await ensureCategories();
  if (!state.user) await loadMe();
  let product = null;
  if (id) {
    try {
      product = (await api(`/api/products/${id}`)).data;
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    if (stale(token)) return;
    if (!product) {
      renderNotFound('Không tìm thấy sản phẩm cần chỉnh sửa.');
      return;
    }
    if (product.seller_id !== state.user?.id) {
      renderNotFound('Bạn chỉ có thể chỉnh sửa sản phẩm do chính mình đăng bán.');
      return;
    }
  }
  if (stale(token)) return;

  const extra = (product?.thumbnails || []).filter((url) => url && url !== product.image_url).join('\n');
  const title = product ? 'Chỉnh sửa sản phẩm' : 'Đăng bán sản phẩm';
  $('#view').innerHTML = `
    ${pageHead([['Trang chủ', '#/'], ['Kênh người bán', '#/account/products'], [title]], title, 'Thông tin rõ ràng và hình ảnh đẹp giúp sản phẩm bán chạy hơn.')}
    <div class="container sell">
      <form data-form="product" data-id="${product?.id ?? ''}" novalidate>
        <div class="form-grid">
          <div class="field span-2">
            <label for="spName">Tên sản phẩm *</label>
            <input class="input" id="spName" name="productName" maxlength="255" value="${esc(product?.name ?? '')}" placeholder="Ví dụ: Tai nghe không dây AuraBuds Pro" required>
          </div>
          <div class="field span-2">
            <label for="spCategory">Danh mục *</label>
            <select class="input" id="spCategory" name="categoryId" required>
              <option value="">Chọn danh mục</option>
              ${state.categories
                .map((c) => `<option value="${c.id}" ${product?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field">
            <label for="spPrice">Giá bán (₫) *</label>
            <input class="input" id="spPrice" name="price" type="number" inputmode="numeric" min="1000" step="1" value="${product?.price ?? ''}" required>
          </div>
          <div class="field">
            <label for="spOriginal">Giá gốc (₫)</label>
            <input class="input" id="spOriginal" name="originalPrice" type="number" inputmode="numeric" min="1000" step="1" value="${product?.original_price ?? ''}" placeholder="Để trống nếu không giảm giá">
            <span class="hint" id="spDiscount"></span>
          </div>
          <div class="field">
            <label for="spStock">Tồn kho *</label>
            <input class="input" id="spStock" name="stock" type="number" inputmode="numeric" min="0" max="1000000" step="1" value="${product?.stock ?? ''}" required>
          </div>
          <div class="field span-2">
            <label for="spImage">Link ảnh chính</label>
            <input class="input" id="spImage" name="imageUrl" type="url" value="${esc(product?.image_url ?? '')}" placeholder="https://...">
            <span class="hint">Dán link ảnh (http/https) lấy từ trang của hãng hoặc kho ảnh. Để trống sẽ dùng ảnh mặc định.</span>
          </div>
          <div class="field span-2">
            <label for="spThumbs">Ảnh phụ (mỗi dòng một link, tối đa 7)</label>
            <textarea class="input" id="spThumbs" name="thumbnails" rows="3" placeholder="https://...">${esc(extra)}</textarea>
          </div>
          <div class="field span-2">
            <label for="spDesc">Mô tả sản phẩm</label>
            <textarea class="input" id="spDesc" name="description" rows="6" maxlength="5000" placeholder="Chất liệu, thông số, điểm nổi bật...">${esc(product?.description ?? '')}</textarea>
            <span class="counter" id="spCounter">0 / 5000</span>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn--solid" type="submit">${product ? 'Lưu thay đổi' : 'Đăng bán'}</button>
          <a class="btn" href="${product ? `#/product/${product.id}` : '#/account/products'}">Hủy</a>
        </div>
      </form>
      <aside class="sell-preview">
        <p class="eyebrow">Xem trước</p>
        <div id="sellPreview"></div>
      </aside>
    </div>`;
  updateSellPreview();
}

function readProductForm(form) {
  const thumbnails = form.thumbnails.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    name: form.productName.value.trim(), // không đặt name="name": trùng thuộc tính form.name có sẵn
    categoryId: Number(form.categoryId.value) || null,
    price: form.price.value === '' ? null : Number(form.price.value),
    originalPrice: form.originalPrice.value === '' ? null : Number(form.originalPrice.value),
    stock: form.stock.value === '' ? null : Number(form.stock.value),
    imageUrl: form.imageUrl.value.trim() || null,
    thumbnails,
    description: form.description.value.trim(),
  };
}

function updateSellPreview() {
  const form = $('form[data-form="product"]');
  if (!form) return;
  const d = readProductForm(form);
  const cat = state.categories.find((c) => c.id === d.categoryId);
  const discount = d.originalPrice > d.price && d.price > 0 ? Math.round((1 - d.price / d.originalPrice) * 100) : 0;
  $('#spDiscount').textContent = discount ? `Giảm ${discount}% so với giá gốc` : '';
  $('#spCounter').textContent = `${d.description.length} / 5000`;
  const image = d.imageUrl && isValidImageUrl(d.imageUrl) ? d.imageUrl : d.thumbnails.find(isValidImageUrl) || null;
  $('#sellPreview').innerHTML = productCard(
    {
      id: 0,
      name: d.name || 'Tên sản phẩm của bạn',
      category_name: cat?.name || 'Danh mục',
      price: d.price || 0,
      original_price: d.originalPrice,
      discount_percent: discount,
      stock: d.stock ?? 1,
      rating: 0,
      review_count: 0,
      sold_count: 0,
      image_url: image,
    },
    { quick: false, reveal: false, link: false }
  );
}

async function submitProduct(form, button) {
  const d = readProductForm(form);
  const images = [d.imageUrl, ...d.thumbnails].filter(Boolean);
  let error = '';
  if (d.name.length < 3) error = 'Tên sản phẩm phải từ 3 ký tự trở lên.';
  else if (!d.categoryId) error = 'Vui lòng chọn danh mục sản phẩm.';
  else if (!Number.isInteger(d.price) || d.price < 1000) error = 'Giá bán phải là số nguyên từ 1.000 ₫.';
  else if (d.originalPrice !== null && (!Number.isInteger(d.originalPrice) || d.originalPrice < d.price))
    error = 'Giá gốc phải lớn hơn hoặc bằng giá bán.';
  else if (!Number.isInteger(d.stock) || d.stock < 0) error = 'Tồn kho phải là số nguyên không âm.';
  else if (images.some((url) => !isValidImageUrl(url))) error = 'Link ảnh phải bắt đầu bằng http:// hoặc https://';
  else if (new Set(images).size > 8) error = 'Tối đa 8 ảnh cho mỗi sản phẩm.';
  if (error) {
    toast(error, 'error');
    return;
  }

  const id = form.dataset.id;
  setBusy(button, true, id ? 'Đang lưu...' : 'Đang đăng bán...');
  try {
    const res = id
      ? await api(`/api/products/${id}`, { method: 'PUT', body: d })
      : await api('/api/products', { method: 'POST', body: d });
    invalidateCatalog();
    remember([res.data]);
    toast(res.message);
    redirect(`/product/${res.data.id}`);
  } catch (err) {
    toast(err.message, 'error');
    setBusy(button, false);
  }
}

async function deleteProduct(id) {
  const p = state.index.get(id);
  const ok = await confirmDialog('Xóa sản phẩm', `Bạn chắc chắn muốn xóa "${p?.name ?? 'sản phẩm này'}"?`, { okText: 'Xóa' });
  if (!ok) return;
  try {
    await api(`/api/products/${id}`, { method: 'DELETE' });
    invalidateCatalog();
    toast('Đã xóa sản phẩm.');
    go('/account/products');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ==========================================
// 19. XỬ LÝ SỰ KIỆN (ỦY QUYỀN TRÊN document)
// ==========================================
const VIEWS = {
  home: viewHome,
  catalog: viewCatalog,
  product: viewProduct,
  cart: viewCart,
  checkout: viewCheckout,
  login: viewLogin,
  register: viewRegister,
  account: viewAccount,
  sell: viewSell,
  notFound: async () => renderNotFound(),
};

const ACTIONS = {
  'drawer-open': openDrawer,
  'drawer-close': closeDrawer,
  'mega-toggle': () => ($('#megaMenu').hidden ? openMega() : closeMega()),
  'mega-tab': (el) => renderMega(Number(el.dataset.cat)),
  'search-open': openSearch,
  'search-close': closeSearch,
  'search-hot': (el) => go(`/products?q=${encodeURIComponent(el.dataset.q)}`),
  logout,
  'modal-close': () => closeModal(),
  retry: () => router(),

  'hero-go': (el) => state.hero?.show(Number(el.dataset.index)),
  'hero-step': (el) => state.hero?.step(Number(el.dataset.step)),
  'scroll-to': (el) => scrollToEl($(el.dataset.target)),
  'lineup-tab': (el) => renderLineup(el.dataset.cat),
  'track-step': (el) => {
    const track = $(`#${el.dataset.track}`);
    track?.scrollBy({ left: Number(el.dataset.step) * track.clientWidth * 0.8, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  },
  'quick-add': (el) => addToCart(state.index.get(Number(el.dataset.id)), 1, { fromEl: el.closest('.card')?.querySelector('img') }),
  'buy-now': (el) => buyNow(state.index.get(Number(el.dataset.id)), 1),

  'set-filter': (el) => {
    state.pendingScroll = '#results';
    go(catalogUrl({ [el.dataset.key]: el.dataset.value }));
  },
  'clear-filter': (el) => {
    const keys = el.dataset.key === 'price' ? ['minPrice', 'maxPrice'] : [el.dataset.key];
    go(catalogUrl(Object.fromEntries(keys.map((key) => [key, '']))));
  },
  'reset-filters': () => go('/products'),
  'filters-open': () => {
    $('#filters')?.classList.add('is-open');
    lockScroll();
  },
  'filters-close': () => {
    $('#filters')?.classList.remove('is-open');
    lockScroll();
  },

  'pd-thumb': (el) => pdShow(Number(el.dataset.index)),
  'pd-step': (el) => pdShow((state.pd?.index ?? 0) + Number(el.dataset.step)),
  'lightbox-open': () => state.pd && openLightbox(state.pd.images, state.pd.index),
  'lightbox-close': closeLightbox,
  'lightbox-step': (el) => showLightbox((state.lightbox?.index ?? 0) + Number(el.dataset.step)),
  'qty-step': (el) => {
    const input = el.parentElement.querySelector('[data-qty]');
    const next = Number(input.value) + Number(el.dataset.step);
    if (el.dataset.id) setCartQty(Number(el.dataset.id), next);
    else setPdQty(next);
  },
  'pd-add': () => state.pd && addToCart(state.pd.product, state.pd.qty, { fromEl: $('#pdMainImg') }),
  'pd-buy': () => state.pd && buyNow(state.pd.product, state.pd.qty),

  'cart-remove': async (el) => {
    const id = Number(el.dataset.id);
    const item = state.cart.find((it) => it.productId === id);
    if (item && (await confirmDialog('Xóa sản phẩm', `Bạn có chắc muốn xóa "${item.product.name}" khỏi giỏ hàng?`, { okText: 'Xóa' }))) {
      removeFromCart([id]);
      toast('Đã xóa sản phẩm khỏi giỏ hàng.');
    }
  },
  'cart-remove-selected': async () => {
    const ids = state.cart.filter((it) => state.selected.has(it.productId)).map((it) => it.productId);
    if (!ids.length) {
      toast('Bạn chưa chọn sản phẩm nào.', 'error');
      return;
    }
    if (await confirmDialog('Xóa sản phẩm', `Xóa ${ids.length} sản phẩm đã chọn khỏi giỏ hàng?`, { okText: 'Xóa' })) {
      removeFromCart(ids);
    }
  },
  'cart-checkout': goCheckout,

  'co-pick-address': pickAddress,
  'address-new': () => openAddressForm(),
  'address-edit': (el) => openAddressForm(state.addresses.find((a) => a.id === Number(el.dataset.id))),
  'address-delete': async (el) => {
    if (state.addresses.length <= 1) {
      toast('Cần ít nhất 1 địa chỉ nhận hàng', 'error');
      return;
    }
    if (!(await confirmDialog('Xóa địa chỉ', 'Bạn chắc chắn muốn xóa địa chỉ này?', { okText: 'Xóa' }))) return;
    try {
      await api(`/api/user/addresses/${el.dataset.id}`, { method: 'DELETE' });
      toast('Đã xóa địa chỉ.');
      await loadAddresses();
      renderAddressList();
    } catch (err) {
      toast(err.message, 'error');
    }
  },
  'address-default': async (el) => {
    try {
      await api(`/api/user/addresses/${el.dataset.id}/default`, { method: 'PATCH' });
      toast('Đã đặt làm địa chỉ mặc định.');
      await loadAddresses();
      renderAddressList();
    } catch (err) {
      toast(err.message, 'error');
    }
  },
  'place-order': placeOrder,

  'pw-toggle': (el) => {
    const input = el.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.textContent = show ? 'Ẩn' : 'Hiện';
    el.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  },
  'forgot-password': () => toast('Vui lòng liên hệ hotline 1900 8899 để được cấp lại mật khẩu.'),
  'social-login': (el) => toast(`Đăng nhập bằng ${el.dataset.provider} sẽ sớm ra mắt.`),
  'avatar-pick': () => $('#avatarFile')?.click(),
  'product-delete': (el) => deleteProduct(Number(el.dataset.id)),
};

const CHANGES = {
  'cart-select': (el) => {
    const id = Number(el.dataset.id);
    if (el.checked) state.selected.add(id);
    else state.selected.delete(id);
    saveCart();
    updateCartSummary();
  },
  'cart-all': (el) => {
    state.selected = new Set(el.checked ? state.cart.filter(isBuyable).map((it) => it.productId) : []);
    saveCart();
    $$('[data-change="cart-select"]').forEach((box) => (box.checked = !box.disabled && el.checked));
    updateCartSummary();
  },
  'flash-filter': (el) => go(catalogUrl({ flashSale: el.checked ? '1' : '' })),
  'avatar-file': pickAvatarFile,
};

const FORMS = {
  search: (form) => {
    const q = form.q.value.trim();
    go(q ? `/products?q=${encodeURIComponent(q)}` : '/products');
  },
  'price-filter': (form) => {
    const min = form.minPrice.value;
    const max = form.maxPrice.value;
    if (min && max && Number(min) > Number(max)) {
      toast('Giá "Từ" phải nhỏ hơn hoặc bằng giá "Đến".', 'error');
      return;
    }
    state.pendingScroll = '#results';
    go(catalogUrl({ minPrice: min, maxPrice: max }));
  },
  login: submitLogin,
  register: submitRegister,
  profile: submitProfile,
  address: submitAddress,
  'pick-address': (form) => {
    const id = Number(form.addressId.value);
    if (id && state.co) {
      state.co.addressId = id;
      renderCoAddress();
    }
    closeModal({ silent: true });
  },
  product: submitProduct,
};

function bindEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const action = ACTIONS[el.dataset.action];
    if (!action) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
    action(el, e);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.change && CHANGES[el.dataset.change]) {
      CHANGES[el.dataset.change](el);
    } else if (el.matches('[data-qty]')) {
      if (el.dataset.id) setCartQty(Number(el.dataset.id), el.value);
      else setPdQty(el.value);
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'searchInput') liveSearch(el.value);
    else if (el.id === 'regPw' || el.id === 'regPw2') updatePasswordHints();
    else if (el.closest('form[data-form="product"]')) updateSellPreview();
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    FORMS[form.dataset.form]?.(form, e.submitter || form.querySelector('[type="submit"]'));
  });

  document.addEventListener('keydown', (e) => {
    if (state.lightbox) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') showLightbox(state.lightbox.index - 1);
      else if (e.key === 'ArrowRight') showLightbox(state.lightbox.index + 1);
      return;
    }
    if (e.key !== 'Escape') return;
    if ($('#modalRoot .modal:not(.is-leaving)')) closeModal();
    else {
      closeMega();
      closeSearch();
      closeDrawer();
      $('#filters')?.classList.remove('is-open');
    }
  });

  // Ảnh lỗi (link hỏng) thay bằng ảnh mặc định
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img instanceof HTMLImageElement && !img.dataset.fallback) {
        img.dataset.fallback = '1';
        img.src = PLACEHOLDER;
      }
    },
    true
  );

  // Mega menu mở khi rê chuột (máy tính), bấm để mở trên màn hình cảm ứng
  const header = $('#siteHeader');
  $('[data-action="mega-toggle"]').addEventListener('mouseenter', () => {
    if (window.matchMedia('(hover: hover)').matches) openMega();
  });
  header.addEventListener('mouseleave', () => {
    if (!$('#megaMenu').hidden) megaTimer = setTimeout(closeMega, 250);
  });
  header.addEventListener('mouseenter', () => clearTimeout(megaTimer));
  $('#megaTabs').addEventListener('mouseover', (e) => {
    const tab = e.target.closest('[data-action="mega-tab"]');
    if (tab && Number(tab.dataset.cat) !== state.megaCat) renderMega(Number(tab.dataset.cat));
  });

  // Header thu gọn khi cuộn trang
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  window.addEventListener('resize', debounce(() => $$('.track').forEach(updateTrack), 150));

  window.addEventListener('hashchange', router);
}

// ==========================================
// 20. GIÁM SÁT HẠ TẦNG & KHỞI ĐỘNG
// ==========================================
async function checkHealth() {
  const dot = $('#healthDot');
  const text = $('#healthText');
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    const data = await res.json();
    const up = res.ok && data.status === 'UP';
    dot.className = `health-dot ${up ? 'is-up' : 'is-down'}`;
    text.textContent = up ? 'Hạ tầng 3 tầng: hoạt động tốt' : 'Hạ tầng: mất kết nối CSDL';
  } catch {
    dot.className = 'health-dot is-down';
    text.textContent = 'Hạ tầng: mất kết nối API';
  }
}

async function boot() {
  bindEvents();
  updateCartBadge();
  renderAccountMenu();
  checkHealth();
  setInterval(checkHealth, 15000);
  await loadMe();
  ensureCategories().catch(() => {}); // liên kết danh mục ở footer & menu di động
  router();
}

boot();
