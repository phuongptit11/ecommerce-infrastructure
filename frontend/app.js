/**
 * AURAMALL - Single Page Application Core Engine
 * Đề tài 07: Hệ thống TMĐT 3 tầng (Nginx -> Node.js -> PostgreSQL)
 */

'use strict';

// ==========================================
// 1. STATE MANAGEMENT
// ==========================================
const state = {
  user: null,
  token: localStorage.getItem('auramall_token') || null,
  cart: JSON.parse(localStorage.getItem('auramall_cart') || '[]'),
  selectedCartItemIds: new Set(),
  
  categories: [],
  activeCategory: null,
  
  filters: {
    page: 1,
    limit: 20, // 20 sản phẩm/lần theo bản đặc tả
    minPrice: '',
    maxPrice: '',
    minRating: '',
    sort: 'popular',
    q: '',
    flashSale: false,
  },
  
  products: [],
  pagination: { page: 1, limit: 20, totalItems: 0, totalPages: 1 },
  
  currentProduct: null,
  detailSelectedQty: 1,
  
  addresses: [],
  selectedAddressId: null,
  
  orders: [],
  
  currentView: 'home',
  lastViewBeforeAuth: 'home',
  accountTab: 'profile',
};

// ==========================================
// 2. TIỆN ÍCH & API CLIENT
// ==========================================
function getProductSvgFallback(name) {
  const safeName = (name || 'AuraMall').slice(0, 24);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fff5f2"/><stop offset="100%" stop-color="#ffe4dc"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><text x="50%" y="45%" font-size="70" text-anchor="middle" dominant-baseline="middle">🛍️</text><text x="50%" y="68%" font-size="16" font-family="-apple-system, Segoe UI, Roboto" font-weight="700" fill="#ee4d2d" text-anchor="middle" dominant-baseline="middle">${safeName}</text><text x="50%" y="78%" font-size="12" font-family="-apple-system, Segoe UI, Roboto" fill="#94a3b8" text-anchor="middle" dominant-baseline="middle">AuraMall Official</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function handleImgError(el, name) {
  el.onerror = null;
  el.src = getProductSvgFallback(name);
}

function formatCurrency(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function formatSold(sold) {
  if (!sold) return '0';
  if (sold >= 1000) {
    return (sold / 1000).toFixed(1) + 'k';
  }
  return sold.toString();
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : '⚠️'}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  try {
    const res = await fetch(endpoint, {
      ...options,
      headers,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Có lỗi xảy ra khi gửi yêu cầu.');
    }
    return data;
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err);
    throw err;
  }
}

// ==========================================
// 3. DIỀU HƯỚNG MÀN HÌNH (ROUTER)
// ==========================================
function navigate(viewName, data = null) {
  if (viewName !== 'auth') {
    state.lastViewBeforeAuth = viewName;
  }

  // Ẩn tất cả các view
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));

  state.currentView = viewName;

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.add('active');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Xử lý từng màn
  switch (viewName) {
    case 'home':
      loadCategories();
      loadProducts();
      break;
    case 'product-detail':
      if (data && data.productId) {
        loadProductDetail(data.productId);
      }
      break;
    case 'cart':
      renderCartPage();
      break;
    case 'checkout':
      renderCheckoutPage();
      break;
    case 'account':
      if (!state.token) {
        showToast('Vui lòng đăng nhập để xem thông tin tài khoản', 'error');
        navigate('auth');
        return;
      }
      loadAccountCenter();
      break;
    case 'auth':
      initAuthScreen(data?.tab || 'login');
      break;
  }
}

// ==========================================
// 4. KIỂM TRA SỨC KHỎE HẠ TẦNG (HEALTH MONITOR)
// ==========================================
async function checkHealth() {
  const badge = document.getElementById('healthStatusBadge');
  const dot = document.getElementById('healthStatusDot');
  const text = document.getElementById('healthStatusText');
  
  try {
    const res = await fetch('/health');
    const data = await res.json();
    if (res.ok && data.status === 'UP') {
      dot.className = 'status-dot';
      text.textContent = 'Hạ tầng 3 tầng: Hoạt động tốt';
    } else {
      dot.className = 'status-dot down';
      text.textContent = 'Hạ tầng: Đang bảo trì';
    }
  } catch {
    dot.className = 'status-dot down';
    text.textContent = 'Hạ tầng: Mất kết nối API';
  }
}

// ==========================================
// 5. PHÂN HỆ AUTH (ĐĂNG KÝ / ĐĂNG NHẬP)
// ==========================================
function initAuthScreen(activeTab = 'login') {
  switchAuthTab(activeTab);
  setupPasswordValidation();
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById('formLogin');
  const regForm = document.getElementById('formRegister');
  const tabLogin = document.getElementById('tabBtnLogin');
  const tabReg = document.getElementById('tabBtnRegister');

  if (tab === 'login') {
    loginForm.style.display = 'block';
    regForm.style.display = 'none';
    tabLogin.classList.add('active');
    tabReg.classList.remove('active');
  } else {
    loginForm.style.display = 'none';
    regForm.style.display = 'block';
    tabLogin.classList.remove('active');
    tabReg.classList.add('active');
  }
}

function setupPasswordValidation() {
  const pwdInput = document.getElementById('regPassword');
  const confirmInput = document.getElementById('regConfirmPassword');

  const checkLength = document.getElementById('chkLen');
  const checkUpper = document.getElementById('chkUpper');
  const checkLower = document.getElementById('chkLower');
  const checkNumber = document.getElementById('chkNumber');
  const matchMsg = document.getElementById('regMatchError');

  function validatePwd() {
    const val = pwdInput.value;
    const isLen = val.length >= 8;
    const isUpper = /[A-Z]/.test(val);
    const isLower = /[a-z]/.test(val);
    const isNumber = /\d/.test(val);

    if (checkLength) checkLength.className = isLen ? 'checklist-item valid' : 'checklist-item';
    if (checkUpper) checkUpper.className = isUpper ? 'checklist-item valid' : 'checklist-item';
    if (checkLower) checkLower.className = isLower ? 'checklist-item valid' : 'checklist-item';
    if (checkNumber) checkNumber.className = isNumber ? 'checklist-item valid' : 'checklist-item';

    validateMatch();
  }

  function validateMatch() {
    if (!confirmInput.value) {
      matchMsg.textContent = '';
      return;
    }
    if (pwdInput.value !== confirmInput.value) {
      matchMsg.textContent = '❌ Mật khẩu nhập lại chưa khớp';
      matchMsg.style.color = '#ef4444';
      confirmInput.classList.add('is-invalid');
    } else {
      matchMsg.textContent = '✔️ Mật khẩu khớp nhau';
      matchMsg.style.color = '#10b981';
      confirmInput.classList.remove('is-invalid');
    }
  }

  if (pwdInput) pwdInput.addEventListener('input', validatePwd);
  if (confirmInput) confirmInput.addEventListener('input', validateMatch);
}

async function handleLogin(e) {
  e.preventDefault();
  const loginVal = document.getElementById('loginUsername').value.trim();
  const passwordVal = document.getElementById('loginPassword').value;
  const rememberVal = document.getElementById('loginRemember').checked;

  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: loginVal, password: passwordVal, remember: rememberVal }),
    });

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('auramall_token', data.token);

    updateUserHeaderUI();
    showToast('Đăng nhập thành công!');
    
    // Điều hướng quay lại trang người dùng vừa duyệt dở (hoặc trang chủ)
    navigate(state.lastViewBeforeAuth || 'home');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;
  const agreeTerms = document.getElementById('regAgreeTerms').checked;

  if (!agreeTerms) {
    showToast('Vui lòng đồng ý với Điều khoản dịch vụ của AuraMall', 'error');
    return;
  }

  if (password !== confirmPassword) {
    showToast('Mật khẩu nhập lại không khớp!', 'error');
    return;
  }

  try {
    const data = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, phone, password, confirmPassword }),
    });

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('auramall_token', data.token);

    updateUserHeaderUI();
    showToast('Đăng ký tài khoản thành công!');
    navigate('home');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function handleLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('auramall_token');
  updateUserHeaderUI();
  showToast('Đã đăng xuất tài khoản');
  navigate('home');
}

async function loadCurrentUser() {
  if (!state.token) {
    updateUserHeaderUI();
    return;
  }
  try {
    const res = await apiRequest('/api/auth/me');
    state.user = res.data;
    updateUserHeaderUI();
  } catch {
    // Token không hợp lệ hoặc hết hạn
    state.token = null;
    state.user = null;
    localStorage.removeItem('auramall_token');
    updateUserHeaderUI();
  }
}

function updateUserHeaderUI() {
  const unloggedArea = document.getElementById('headerUserUnlogged');
  const loggedArea = document.getElementById('headerUserLogged');
  const nameEl = document.getElementById('headerUsername');
  const avatarEl = document.getElementById('headerUserAvatar');

  if (state.token && state.user) {
    if (unloggedArea) unloggedArea.style.display = 'none';
    if (loggedArea) loggedArea.style.display = 'flex';
    if (nameEl) nameEl.textContent = state.user.username || 'Người dùng';
    if (avatarEl) {
      avatarEl.src = state.user.avatar_url || state.user.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80';
    }
  } else {
    if (unloggedArea) unloggedArea.style.display = 'flex';
    if (loggedArea) loggedArea.style.display = 'none';
  }
}

// ==========================================
// 6. PHÂN HỆ SẢN PHẨM & DANH MỤC (LUỒNG 1)
// ==========================================
async function loadCategories() {
  try {
    const res = await apiRequest('/api/categories');
    state.categories = res.data;
    renderCategories();
  } catch (err) {
    console.error('Lỗi tải danh mục:', err);
  }
}

function renderCategories() {
  const container = document.getElementById('categoryTree');
  if (!container) return;

  container.innerHTML = `
    <li class="category-item ${!state.activeCategory ? 'active' : ''}" onclick="selectCategory(null)">
      <span>🌐 Tất cả danh mục</span>
    </li>
  `;

  state.categories.forEach(cat => {
    const li = document.createElement('li');
    li.className = `category-item ${state.activeCategory === cat.id ? 'active' : ''}`;
    li.onclick = () => selectCategory(cat.id);
    li.innerHTML = `
      <span>${cat.icon || '📦'} ${cat.name}</span>
      <span class="category-count">${cat.product_count}</span>
    `;
    container.appendChild(li);
  });
}

function selectCategory(catId) {
  state.activeCategory = catId;
  state.filters.page = 1;
  renderCategories();
  loadProducts();
}

async function loadProducts() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  grid.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
      ⏳ Đang tải danh mục sản phẩm từ hệ thống...
    </div>
  `;

  const params = new URLSearchParams();
  params.set('page', state.filters.page);
  params.set('limit', state.filters.limit); // 20 sản phẩm/lần
  
  if (state.activeCategory) params.set('category', state.activeCategory);
  if (state.filters.minPrice) params.set('minPrice', state.filters.minPrice);
  if (state.filters.maxPrice) params.set('maxPrice', state.filters.maxPrice);
  if (state.filters.minRating) params.set('minRating', state.filters.minRating);
  if (state.filters.sort) params.set('sort', state.filters.sort);
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.flashSale) params.set('flashSale', 'true');

  try {
    const res = await apiRequest(`/api/products?${params.toString()}`);
    state.products = res.data;
    state.pagination = res.pagination;
    renderProducts();
    renderPagination();
  } catch (err) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">
        ⚠️ Không thể tải danh sách sản phẩm: ${err.message}
      </div>
    `;
  }
}

function renderProducts() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  if (state.products.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--text-muted); background: #ffffff; border-radius: var(--radius-md);">
        <p style="font-size: 36px; margin-bottom: 10px;">🔍</p>
        <p style="font-size: 16px; font-weight: 600;">Không tìm thấy sản phẩm phù hợp</p>
        <p style="font-size: 13px; margin-top: 6px;">Hãy thử tìm từ khóa khác hoặc điều chỉnh lại bộ lọc giá.</p>
        <button class="btn-filter-apply" style="max-width: 180px; margin: 16px auto 0;" onclick="resetFilters()">Xóa bộ lọc</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  state.products.forEach(p => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.onclick = () => navigate('product-detail', { productId: p.id });

    const isOut = p.stock <= 0;
    const discountTag = p.discount_percent > 0 ? `<div class="badge-discount">-${p.discount_percent}%</div>` : '';
    const flashTag = p.is_flash_sale ? `<div class="badge-flash-sale">⚡ FLASH SALE</div>` : '';
    const outTag = isOut ? `<div class="badge-out-of-stock">HẾT HÀNG</div>` : '';

    card.innerHTML = `
      <div class="product-image-box">
        <img class="product-img" src="${p.image_url || 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=500'}" alt="${p.name}" loading="lazy" onerror="handleImgError(this, '${p.name.replace(/'/g, "\\'")}')" />
        ${discountTag}
        ${flashTag}
        ${outTag}
      </div>
      <div class="product-info">
        <h3 class="product-title" title="${p.name}">${p.name}</h3>
        <div class="product-price-box">
          <span class="product-price">${formatCurrency(p.price)}</span>
          ${p.original_price ? `<span class="product-price-old">${formatCurrency(p.original_price)}</span>` : ''}
        </div>
        <div class="product-meta">
          <div class="product-rating">
            <span class="stars-gold">⭐</span>
            <span>${p.rating || 5.0}</span>
          </div>
          <span class="product-sold">Đã bán ${formatSold(p.sold_count)}</span>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderPagination() {
  const container = document.getElementById('pagination');
  if (!container) return;

  const { page, totalPages } = state.pagination;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="changePage(${page - 1})">
      &lt;
    </button>
  `;

  for (let i = 1; i <= totalPages; i++) {
    html += `
      <button class="page-btn ${i === page ? 'active' : ''}" onclick="changePage(${i})">
        ${i}
      </button>
    `;
  }

  html += `
    <button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="changePage(${page + 1})">
      &gt;
    </button>
  `;

  container.innerHTML = html;
}

function changePage(newPage) {
  state.filters.page = newPage;
  loadProducts();
  window.scrollTo({ top: 300, behavior: 'smooth' });
}

function setSort(sortType) {
  state.filters.sort = sortType;
  state.filters.page = 1;
  document.querySelectorAll('.sort-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sortType);
  });
  loadProducts();
}

function applyPriceFilter() {
  const min = document.getElementById('filterMinPrice').value;
  const max = document.getElementById('filterMaxPrice').value;
  state.filters.minPrice = min;
  state.filters.maxPrice = max;
  state.filters.page = 1;
  loadProducts();
}

function filterByRating(minRating) {
  state.filters.minRating = state.filters.minRating === minRating ? '' : minRating;
  state.filters.page = 1;
  document.querySelectorAll('.rating-filter-item').forEach(el => {
    el.classList.toggle('active', el.dataset.rating === String(state.filters.minRating));
  });
  loadProducts();
}

function toggleFlashSaleFilter() {
  state.filters.flashSale = !state.filters.flashSale;
  state.filters.page = 1;
  loadProducts();
}

function resetFilters() {
  state.filters = {
    page: 1,
    limit: 20,
    minPrice: '',
    maxPrice: '',
    minRating: '',
    sort: 'popular',
    q: '',
    flashSale: false,
  };
  state.activeCategory = null;
  document.getElementById('filterMinPrice').value = '';
  document.getElementById('filterMaxPrice').value = '';
  document.getElementById('headerSearchInput').value = '';
  renderCategories();
  loadProducts();
}

// ==========================================
// 7. PHÂN HỆ CHI TIẾT SẢN PHẨM (SCREEN 3)
// ==========================================
async function loadProductDetail(productId) {
  try {
    const res = await apiRequest(`/api/products/${productId}`);
    state.currentProduct = res.data;
    state.detailSelectedQty = 1;
    renderProductDetail();
  } catch (err) {
    showToast(err.message, 'error');
    navigate('home');
  }
}

function renderProductDetail() {
  const p = state.currentProduct;
  if (!p) return;

  const mainImg = document.getElementById('detailMainImage');
  const thumbStrip = document.getElementById('detailThumbnails');
  const titleEl = document.getElementById('detailTitle');
  const starsEl = document.getElementById('detailStars');
  const reviewCountEl = document.getElementById('detailReviewCount');
  const soldCountEl = document.getElementById('detailSoldCount');
  const currentPriceEl = document.getElementById('detailCurrentPrice');
  const oldPriceEl = document.getElementById('detailOldPrice');
  const stockBadgeEl = document.getElementById('detailStockBadge');
  const stockTextEl = document.getElementById('detailStockText');
  const qtyInput = document.getElementById('detailQtyInput');
  const descEl = document.getElementById('detailDescription');
  const btnAdd = document.getElementById('detailBtnAddCart');
  const btnBuy = document.getElementById('detailBtnBuyNow');

  if (mainImg) mainImg.src = p.image_url || 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600';
  if (titleEl) titleEl.textContent = p.name;
  if (starsEl) starsEl.innerHTML = `⭐ ${p.rating || 5.0}`;
  if (reviewCountEl) reviewCountEl.textContent = `${p.review_count || 120} Đánh giá`;
  if (soldCountEl) soldCountEl.textContent = `${formatSold(p.sold_count)} Đã bán`;
  if (currentPriceEl) currentPriceEl.textContent = formatCurrency(p.price);
  if (oldPriceEl) {
    oldPriceEl.textContent = p.original_price ? formatCurrency(p.original_price) : '';
  }
  if (descEl) descEl.textContent = p.description || 'Sản phẩm chính hãng, phân phối bởi AuraMall.';

  // Dải Thumbnail
  if (thumbStrip) {
    thumbStrip.innerHTML = '';
    const images = Array.isArray(p.thumbnails) && p.thumbnails.length > 0 ? p.thumbnails : [p.image_url];
    images.forEach((imgUrl, idx) => {
      const item = document.createElement('div');
      item.className = `thumb-item ${idx === 0 ? 'active' : ''}`;
      item.innerHTML = `<img class="thumb-img" src="${imgUrl}" alt="thumb" />`;
      item.onclick = () => {
        document.querySelectorAll('.thumb-item').forEach(t => t.classList.remove('active'));
        item.classList.add('active');
        if (mainImg) mainImg.src = imgUrl;
      };
      thumbStrip.appendChild(item);
    });
  }

  // Tình trạng kho hàng
  const isOutOfStock = p.stock <= 0;
  if (stockBadgeEl && stockTextEl) {
    if (isOutOfStock) {
      stockBadgeEl.className = 'stock-tag-badge stock-tag-out';
      stockTextEl.textContent = 'Hết hàng';
    } else {
      stockBadgeEl.className = 'stock-tag-badge stock-tag-in';
      stockTextEl.textContent = `Còn hàng (${p.stock} sản phẩm có sẵn)`;
    }
  }

  // Cụm chọn số lượng & các nút mua hàng
  if (qtyInput) qtyInput.value = state.detailSelectedQty;

  const btnMinus = document.getElementById('detailQtyMinus');
  const btnPlus = document.getElementById('detailQtyPlus');

  if (isOutOfStock) {
    if (btnMinus) btnMinus.disabled = true;
    if (btnPlus) btnPlus.disabled = true;
    if (qtyInput) qtyInput.disabled = true;
    if (btnAdd) btnAdd.disabled = true;
    if (btnBuy) btnBuy.disabled = true;
  } else {
    if (btnMinus) btnMinus.disabled = state.detailSelectedQty <= 1;
    if (btnPlus) btnPlus.disabled = state.detailSelectedQty >= p.stock;
    if (qtyInput) qtyInput.disabled = false;
    if (btnAdd) btnAdd.disabled = false;
    if (btnBuy) btnBuy.disabled = false;
  }
}

function adjustDetailQty(delta) {
  const p = state.currentProduct;
  if (!p || p.stock <= 0) return;

  const nextQty = state.detailSelectedQty + delta;
  if (nextQty >= 1 && nextQty <= p.stock) {
    state.detailSelectedQty = nextQty;
    const input = document.getElementById('detailQtyInput');
    if (input) input.value = nextQty;

    const btnMinus = document.getElementById('detailQtyMinus');
    const btnPlus = document.getElementById('detailQtyPlus');
    if (btnMinus) btnMinus.disabled = nextQty <= 1;
    if (btnPlus) btnPlus.disabled = nextQty >= p.stock;
  }
}

function onDetailQtyChange(val) {
  const p = state.currentProduct;
  if (!p || p.stock <= 0) return;

  let qty = parseInt(val, 10);
  if (isNaN(qty) || qty < 1) qty = 1;
  if (qty > p.stock) qty = p.stock;

  state.detailSelectedQty = qty;
  const input = document.getElementById('detailQtyInput');
  if (input) input.value = qty;
}

// Hiệu ứng bay sản phẩm vào giỏ hàng (Parabolic Flying Animation)
function triggerFlyToCartAnimation(imgElement) {
  const cartIcon = document.getElementById('headerCartBtn');
  if (!cartIcon || !imgElement) return;

  const startRect = imgElement.getBoundingClientRect();
  const endRect = cartIcon.getBoundingClientRect();

  const flyer = document.createElement('img');
  flyer.src = imgElement.src;
  flyer.className = 'flying-product';
  flyer.style.top = `${startRect.top}px`;
  flyer.style.left = `${startRect.left}px`;
  document.body.appendChild(flyer);

  // Kích hoạt transition bay
  requestAnimationFrame(() => {
    flyer.style.top = `${endRect.top + 10}px`;
    flyer.style.left = `${endRect.left + 10}px`;
    flyer.style.transform = 'scale(0.2)';
    flyer.style.opacity = '0.5';
  });

  setTimeout(() => {
    flyer.remove();
    // Hiệu ứng nhún nảy icon giỏ hàng
    cartIcon.style.transform = 'scale(1.25)';
    setTimeout(() => {
      cartIcon.style.transform = 'scale(1)';
    }, 200);
  }, 800);
}

function addToCart(andBuyNow = false) {
  const p = state.currentProduct;
  if (!p || p.stock <= 0) {
    showToast('Sản phẩm đã hết hàng!', 'error');
    return;
  }

  const existingIdx = state.cart.findIndex(it => it.productId === p.id);
  const addQty = state.detailSelectedQty;

  if (existingIdx >= 0) {
    const newTotal = state.cart[existingIdx].quantity + addQty;
    if (newTotal > p.stock) {
      showToast(`Kho chỉ còn ${p.stock} sản phẩm. Đã điều chỉnh về mức tối đa.`, 'error');
      state.cart[existingIdx].quantity = p.stock;
    } else {
      state.cart[existingIdx].quantity = newTotal;
    }
  } else {
    state.cart.push({
      productId: p.id,
      product: {
        id: p.id,
        name: p.name,
        price: p.price,
        stock: p.stock,
        image_url: p.image_url,
      },
      quantity: addQty,
    });
  }

  // Tự động chọn sản phẩm này cho thanh toán
  state.selectedCartItemIds.add(p.id);

  saveCart();
  updateCartBadgeUI();

  // Hiệu ứng animation & toast
  const mainImg = document.getElementById('detailMainImage');
  triggerFlyToCartAnimation(mainImg);

  showToast('Sản phẩm đã được thêm vào giỏ hàng');

  if (andBuyNow) {
    navigate('cart');
  }
}

// ==========================================
// 8. PHÂN HỆ GIỎ HÀNG (SCREEN 4)
// ==========================================
function saveCart() {
  localStorage.setItem('auramall_cart', JSON.stringify(state.cart));
}

function updateCartBadgeUI() {
  const badge = document.getElementById('headerCartBadge');
  const totalCount = state.cart.reduce((acc, it) => acc + it.quantity, 0);
  if (badge) {
    badge.textContent = totalCount;
    badge.style.display = totalCount > 0 ? 'flex' : 'none';
  }
  renderCartPopover();
}

function renderCartPopover() {
  const popoverList = document.getElementById('cartPopoverList');
  if (!popoverList) return;

  if (state.cart.length === 0) {
    popoverList.innerHTML = `<div class="cart-popover-empty">Chưa có sản phẩm trong giỏ</div>`;
    return;
  }

  const recentItems = state.cart.slice(-3).reverse();
  popoverList.innerHTML = recentItems
    .map(
      it => `
    <div class="cart-popover-item">
      <img class="cart-popover-thumb" src="${it.product.image_url || 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=100'}" alt="${it.product.name}" />
      <div class="cart-popover-info">
        <div class="cart-popover-title">${it.product.name}</div>
        <div class="cart-popover-price">${formatCurrency(it.product.price)} x ${it.quantity}</div>
      </div>
    </div>
  `
    )
    .join('');
}

function renderCartPage() {
  const tbody = document.getElementById('cartTableBody');
  const emptyView = document.getElementById('cartEmptyView');
  const tableWrapper = document.getElementById('cartTableWrapper');
  const stickyBar = document.getElementById('cartStickyBar');

  if (!tbody) return;

  if (state.cart.length === 0) {
    if (emptyView) emptyView.style.display = 'block';
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (stickyBar) stickyBar.style.display = 'none';
    return;
  }

  if (emptyView) emptyView.style.display = 'none';
  if (tableWrapper) tableWrapper.style.display = 'block';
  if (stickyBar) stickyBar.style.display = 'block';

  // Khởi tạo checkbox nếu chưa có
  if (state.selectedCartItemIds.size === 0) {
    state.cart.forEach(it => state.selectedCartItemIds.add(it.productId));
  }

  tbody.innerHTML = '';
  state.cart.forEach(it => {
    const isChecked = state.selectedCartItemIds.has(it.productId);
    const lineTotal = it.product.price * it.quantity;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="checkbox" class="cart-item-check" data-id="${it.productId}" ${isChecked ? 'checked' : ''} onchange="toggleCartItemSelect(${it.productId}, this.checked)" />
      </td>
      <td>
        <div class="cart-product-cell">
          <img class="cart-item-thumb" src="${it.product.image_url || 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=150'}" alt="${it.product.name}" />
          <div>
            <div class="cart-item-name">${it.product.name}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Tồn kho: ${it.product.stock}</div>
          </div>
        </div>
      </td>
      <td>
        <span class="cart-item-price">${formatCurrency(it.product.price)}</span>
      </td>
      <td>
        <div class="quantity-control">
          <button class="qty-btn" ${it.quantity <= 1 ? 'disabled' : ''} onclick="updateCartQty(${it.productId}, -1)">-</button>
          <input class="qty-input" type="text" value="${it.quantity}" readonly />
          <button class="qty-btn" ${it.quantity >= it.product.stock ? 'disabled' : ''} onclick="updateCartQty(${it.productId}, 1)">+</button>
        </div>
      </td>
      <td>
        <span class="cart-item-subtotal">${formatCurrency(lineTotal)}</span>
      </td>
      <td>
        <button class="btn-cart-delete" title="Xóa" onclick="confirmDeleteCartItem(${it.productId})">
          🗑️
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updateCartStickyBar();
}

function toggleSelectAllCart(checked) {
  if (checked) {
    state.cart.forEach(it => state.selectedCartItemIds.add(it.productId));
  } else {
    state.selectedCartItemIds.clear();
  }
  renderCartPage();
}

function toggleCartItemSelect(productId, checked) {
  if (checked) {
    state.selectedCartItemIds.add(productId);
  } else {
    state.selectedCartItemIds.delete(productId);
  }
  updateCartStickyBar();
}

function updateCartQty(productId, delta) {
  const item = state.cart.find(it => it.productId === productId);
  if (!item) return;

  const nextQty = item.quantity + delta;
  if (nextQty >= 1 && nextQty <= item.product.stock) {
    item.quantity = nextQty;
    saveCart();
    renderCartPage();
    updateCartBadgeUI();
  }
}

function confirmDeleteCartItem(productId) {
  const item = state.cart.find(it => it.productId === productId);
  if (!item) return;

  showConfirmModal('Xóa sản phẩm', `Bạn có chắc chắn muốn xóa "${item.product.name}" khỏi giỏ hàng?`, () => {
    state.cart = state.cart.filter(it => it.productId !== productId);
    state.selectedCartItemIds.delete(productId);
    saveCart();
    renderCartPage();
    updateCartBadgeUI();
    showToast('Đã xóa sản phẩm khỏi giỏ hàng');
  });
}

function updateCartStickyBar() {
  const countEl = document.getElementById('stickySelectedCount');
  const priceEl = document.getElementById('stickyTotalPrice');
  const checkAllEl = document.getElementById('cartCheckAll');

  const selectedItems = state.cart.filter(it => state.selectedCartItemIds.has(it.productId));
  const totalAmount = selectedItems.reduce((acc, it) => acc + it.product.price * it.quantity, 0);

  if (countEl) countEl.textContent = `(chọn ${selectedItems.length} sản phẩm)`;
  if (priceEl) priceEl.textContent = formatCurrency(totalAmount);

  if (checkAllEl) {
    checkAllEl.checked = state.cart.length > 0 && selectedItems.length === state.cart.length;
  }
}

function proceedToCheckout() {
  const selectedItems = state.cart.filter(it => state.selectedCartItemIds.has(it.productId));
  if (selectedItems.length === 0) {
    // Popup xác nhận chưa chọn sp nào (PDF Screen 4)
    showConfirmModal('Thông báo', 'Bạn chưa chọn sản phẩm nào để tiến hành mua hàng.', null, false);
    return;
  }
  navigate('checkout');
}

// ==========================================
// 9. PHÂN HỆ THANH TOÁN (SCREEN 5: LUỒNG 2)
// ==========================================
async function renderCheckoutPage() {
  const selectedItems = state.cart.filter(it => state.selectedCartItemIds.has(it.productId));
  if (selectedItems.length === 0) {
    navigate('cart');
    return;
  }

  // Tải sổ địa chỉ của user để hiển thị địa chỉ mặc định
  await loadUserAddresses();

  // Render thông tin địa chỉ nhận hàng
  renderCheckoutAddress();

  // Render danh sách sản phẩm tóm tắt (read-only)
  const itemsContainer = document.getElementById('checkoutItemsList');
  if (itemsContainer) {
    itemsContainer.innerHTML = selectedItems
      .map(
        it => `
      <div class="checkout-item-row">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${it.product.image_url}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;" />
          <div>
            <div style="font-weight: 600;">${it.product.name}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${formatCurrency(it.product.price)} x ${it.quantity}</div>
          </div>
        </div>
        <div style="font-weight: 700; color: var(--text-main);">${formatCurrency(it.product.price * it.quantity)}</div>
      </div>
    `
      )
      .join('');
  }

  // Tính chi phí
  const goodsTotal = selectedItems.reduce((acc, it) => acc + it.product.price * it.quantity, 0);
  const shippingFee = goodsTotal >= 500000 ? 0 : 30000;
  const finalTotal = goodsTotal + shippingFee;

  document.getElementById('checkoutGoodsTotal').textContent = formatCurrency(goodsTotal);
  document.getElementById('checkoutShippingFee').textContent = shippingFee === 0 ? 'Miễn phí' : formatCurrency(shippingFee);
  document.getElementById('checkoutFinalTotal').textContent = formatCurrency(finalTotal);
}

function renderCheckoutAddress() {
  const addressView = document.getElementById('checkoutAddressContent');
  if (!addressView) return;

  const defaultAddr = state.addresses.find(a => a.is_default) || state.addresses[0];
  if (defaultAddr) {
    state.selectedAddressId = defaultAddr.id;
    addressView.innerHTML = `
      <div class="address-details-view">
        <div><strong>${defaultAddr.recipient_name}</strong> (${defaultAddr.phone})</div>
        <div style="color: var(--text-muted); margin-top: 4px;">${defaultAddr.detail_address}</div>
      </div>
      <button class="btn-change-address" onclick="openAddressModal()">Thay đổi</button>
    `;
  } else {
    state.selectedAddressId = null;
    addressView.innerHTML = `
      <div style="color: var(--text-muted);">Chưa có địa chỉ nhận hàng</div>
      <button class="btn-change-address" onclick="openAddressModal()">+ Thêm địa chỉ nhận hàng</button>
    `;
  }
}

async function handlePlaceOrder() {
  const selectedItems = state.cart.filter(it => state.selectedCartItemIds.has(it.productId));
  if (selectedItems.length === 0) {
    showToast('Vui lòng chọn sản phẩm trước khi đặt hàng', 'error');
    return;
  }

  const selectedAddr = state.addresses.find(a => a.id === state.selectedAddressId) || state.addresses[0];
  if (!selectedAddr) {
    showToast('Vui lòng thêm địa chỉ nhận hàng trước khi đặt hàng', 'error');
    openAddressModal();
    return;
  }

  const buyerNote = document.getElementById('checkoutBuyerNote')?.value || '';
  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'COD';

  const orderPayload = {
    items: selectedItems.map(it => ({
      productId: it.productId,
      quantity: it.quantity,
    })),
    // Cũng gửi productId và quantity của item đầu tiên để tương thích tuyệt đối
    productId: selectedItems[0].productId,
    quantity: selectedItems[0].quantity,
    recipientName: selectedAddr.recipient_name,
    recipientPhone: selectedAddr.phone,
    shippingAddress: selectedAddr.detail_address,
    paymentMethod,
    note: buyerNote,
  };

  const btnOrder = document.getElementById('btnSubmitOrder');
  if (btnOrder) {
    btnOrder.disabled = true;
    btnOrder.textContent = 'Đang xử lý đơn hàng...';
  }

  try {
    const res = await apiRequest('/api/orders', {
      method: 'POST',
      body: JSON.stringify(orderPayload),
    });

    // Xóa các sản phẩm đã mua khỏi giỏ hàng
    const boughtIds = new Set(selectedItems.map(it => it.productId));
    state.cart = state.cart.filter(it => !boughtIds.has(it.productId));
    state.selectedCartItemIds.clear();
    saveCart();
    updateCartBadgeUI();

    // Hiển thị Popup Đặt hàng thành công (Page 3 PDF)
    showOrderSuccessModal(res.orderCode || res.orderId, res.finalTotal || res.totalPrice);
  } catch (err) {
    // Thông báo lỗi rõ ràng theo PDF: "rất tiếc, sản phẩm vừa hết hàng do số lượng có hạn!"
    showToast(err.message, 'error');
  } finally {
    if (btnOrder) {
      btnOrder.disabled = false;
      btnOrder.textContent = 'Đặt hàng';
    }
  }
}

function showOrderSuccessModal(orderCode, totalAmount) {
  const modal = document.getElementById('orderSuccessModal');
  const codeEl = document.getElementById('successOrderCode');
  const totalEl = document.getElementById('successOrderTotal');

  if (codeEl) codeEl.textContent = orderCode;
  if (totalEl) totalEl.textContent = formatCurrency(totalAmount);

  if (modal) modal.classList.add('active');
}

function closeOrderSuccessModal(goToOrders = false) {
  const modal = document.getElementById('orderSuccessModal');
  if (modal) modal.classList.remove('active');

  if (goToOrders) {
    navigate('account');
    switchAccountTab('orders');
  } else {
    navigate('home');
  }
}

// ==========================================
// 10. PHÂN HỆ TRUNG TÂM NGƯỜI DÙNG (SCREEN 6)
// ==========================================
async function loadAccountCenter() {
  await loadCurrentUser();
  await loadUserAddresses();
  renderProfileTab();
}

function switchAccountTab(tabName) {
  state.accountTab = tabName;
  document.querySelectorAll('.sidebar-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabName);
  });

  const tabProfile = document.getElementById('accountTabProfile');
  const tabAddresses = document.getElementById('accountTabAddresses');
  const tabOrders = document.getElementById('accountTabOrders');

  if (tabProfile) tabProfile.style.display = tabName === 'profile' ? 'block' : 'none';
  if (tabAddresses) tabAddresses.style.display = tabName === 'addresses' ? 'block' : 'none';
  if (tabOrders) tabOrders.style.display = tabName === 'orders' ? 'block' : 'none';

  if (tabName === 'addresses') {
    renderAddressesTab();
  } else if (tabName === 'orders') {
    loadUserOrders();
  }
}

function renderProfileTab() {
  const user = state.user;
  if (!user) return;

  const unameInput = document.getElementById('profileUsername');
  const emailInput = document.getElementById('profileEmail');
  const phoneInput = document.getElementById('profilePhone');
  const bdayInput = document.getElementById('profileBirthday');
  const avatarBig = document.getElementById('profileAvatarBig');
  const sidebarAvatar = document.getElementById('accountSidebarAvatar');
  const sidebarName = document.getElementById('accountSidebarName');

  if (unameInput) unameInput.value = user.username || '';
  if (emailInput) emailInput.value = user.email || '';
  if (phoneInput) phoneInput.value = user.phone || '';
  if (bdayInput && user.birthday) {
    bdayInput.value = user.birthday.slice(0, 10);
  }

  // Radio giới tính
  const gender = user.gender || 'nam';
  const radio = document.querySelector(`input[name="profileGender"][value="${gender}"]`);
  if (radio) radio.checked = true;

  const avatarSrc = user.avatar_url || user.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80';
  if (avatarBig) avatarBig.src = avatarSrc;
  if (sidebarAvatar) sidebarAvatar.src = avatarSrc;
  if (sidebarName) sidebarName.textContent = user.username;
}

// Xem trước ảnh đại diện ngay lập tức trước khi lưu (UX PDF Page 4)
function handleAvatarFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Validate định dạng .png/.jpg/.jpeg
  if (!/\.(jpe?g|png)$/i.test(file.name)) {
    showToast('Định dạng hợp lệ: chỉ chấp nhận .png/.jpg/.jpeg', 'error');
    return;
  }

  // Validate dung lượng tối đa 2MB
  if (file.size > 2 * 1024 * 1024) {
    showToast('Dung lượng file tối đa 2MB. Vui lòng chọn ảnh nhỏ hơn!', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function (evt) {
    const base64Data = evt.target.result;
    const previewEl = document.getElementById('profileAvatarBig');
    if (previewEl) previewEl.src = base64Data;
    previewEl.dataset.pendingUpload = base64Data;
  };
  reader.readAsDataURL(file);
}

async function handleSaveProfile(e) {
  e.preventDefault();
  const email = document.getElementById('profileEmail').value.trim();
  const phone = document.getElementById('profilePhone').value.trim();
  const birthday = document.getElementById('profileBirthday').value;
  const gender = document.querySelector('input[name="profileGender"]:checked')?.value || 'nam';

  // Validate ngày sinh không vượt quá ngày hiện tại
  if (birthday) {
    const bDate = new Date(birthday);
    if (bDate > new Date()) {
      showToast('Ngày sinh không được vượt quá ngày hiện tại!', 'error');
      return;
    }
  }

  // Validate số điện thoại (10-11 số)
  if (!/^(0|\+84)[0-9]{9,10}$/.test(phone)) {
    showToast('Số điện thoại phải gồm 10 hoặc 11 chữ số!', 'error');
    return;
  }

  try {
    const previewEl = document.getElementById('profileAvatarBig');
    let avatarUrl = state.user?.avatar_url;

    // Nếu người dùng vừa chọn ảnh mới
    if (previewEl?.dataset?.pendingUpload) {
      const uploadRes = await apiRequest('/api/user/avatar', {
        method: 'POST',
        body: JSON.stringify({ imageBase64: previewEl.dataset.pendingUpload }),
      });
      avatarUrl = uploadRes.avatarUrl;
      delete previewEl.dataset.pendingUpload;
    }

    const res = await apiRequest('/api/user/profile', {
      method: 'PUT',
      body: JSON.stringify({ email, phone, birthday, gender, avatarUrl }),
    });

    state.user = res.data;
    updateUserHeaderUI();
    renderProfileTab();
    // Thông báo toast chính xác: "cập nhật hồ sơ thành công" (PDF Page 4)
    showToast('cập nhật hồ sơ thành công');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Sổ địa chỉ
async function loadUserAddresses() {
  try {
    const res = await apiRequest('/api/user/addresses');
    state.addresses = res.data;
  } catch (err) {
    console.error('Lỗi nạp địa chỉ:', err);
  }
}

function renderAddressesTab() {
  const container = document.getElementById('addressListContainer');
  if (!container) return;

  if (state.addresses.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Bạn chưa có địa chỉ nhận hàng nào.</div>`;
    return;
  }

  const isOnlyOne = state.addresses.length === 1;

  container.innerHTML = state.addresses
    .map(
      addr => `
    <div class="address-item-card">
      <div>
        <div style="font-weight: 700; font-size: 15px;">
          ${addr.recipient_name}
          <span style="font-weight: 500; color: var(--text-muted); margin-left: 8px;">${addr.phone}</span>
          ${addr.is_default ? '<span class="address-badge-default">Mặc định</span>' : ''}
        </div>
        <div style="color: var(--text-muted); font-size: 14px; margin-top: 6px;">
          ${addr.detail_address}
        </div>
      </div>
      <div class="address-actions">
        <button class="btn-action-text" onclick="openAddressModal(${addr.id})">Cập nhật</button>
        <button class="btn-action-text btn-delete" ${isOnlyOne ? 'disabled title="Cần ít nhất 1 địa chỉ nhận hàng"' : ''} onclick="confirmDeleteAddress(${addr.id})">
          Xóa
        </button>
      </div>
    </div>
  `
    )
    .join('');
}

function openAddressModal(addressId = null) {
  const modal = document.getElementById('addressEditModal');
  const title = document.getElementById('modalAddressTitle');
  const nameInput = document.getElementById('addrRecipientName');
  const phoneInput = document.getElementById('addrPhone');
  const detailInput = document.getElementById('addrDetail');
  const defaultCheck = document.getElementById('addrIsDefault');
  const form = document.getElementById('formAddressModal');

  if (addressId) {
    const addr = state.addresses.find(a => a.id === addressId);
    if (!addr) return;
    title.textContent = 'Cập nhật địa chỉ';
    nameInput.value = addr.recipient_name;
    phoneInput.value = addr.phone;
    detailInput.value = addr.detail_address;
    defaultCheck.checked = addr.is_default;
    form.dataset.editId = addressId;
  } else {
    title.textContent = 'Thêm địa chỉ mới';
    nameInput.value = '';
    phoneInput.value = state.user?.phone || '';
    detailInput.value = '';
    defaultCheck.checked = state.addresses.length === 0;
    delete form.dataset.editId;
  }

  modal.classList.add('active');
}

function closeAddressModal() {
  const modal = document.getElementById('addressEditModal');
  if (modal) modal.classList.remove('active');
}

async function handleSaveAddress(e) {
  e.preventDefault();
  const form = document.getElementById('formAddressModal');
  const editId = form.dataset.editId;
  const recipientName = document.getElementById('addrRecipientName').value.trim();
  const phone = document.getElementById('addrPhone').value.trim();
  const detailAddress = document.getElementById('addrDetail').value.trim();
  const isDefault = document.getElementById('addrIsDefault').checked;

  try {
    if (editId) {
      await apiRequest(`/api/user/addresses/${editId}`, {
        method: 'PUT',
        body: JSON.stringify({ recipientName, phone, detailAddress, isDefault }),
      });
      showToast('Cập nhật địa chỉ thành công');
    } else {
      await apiRequest('/api/user/addresses', {
        method: 'POST',
        body: JSON.stringify({ recipientName, phone, detailAddress, isDefault }),
      });
      showToast('Thêm địa chỉ mới thành công');
    }

    closeAddressModal();
    await loadUserAddresses();
    renderAddressesTab();
    renderCheckoutAddress(); // Tự động đồng bộ với trang checkout!
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function confirmDeleteAddress(addressId) {
  if (state.addresses.length <= 1) {
    showToast('Cần ít nhất 1 địa chỉ nhận hàng', 'error');
    return;
  }

  showConfirmModal('Xóa địa chỉ', 'Bạn chắc chắn muốn xóa địa chỉ này không?', async () => {
    try {
      await apiRequest(`/api/user/addresses/${addressId}`, { method: 'DELETE' });
      showToast('Đã xóa địa chỉ thành công');
      await loadUserAddresses();
      renderAddressesTab();
      renderCheckoutAddress();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// Lịch sử đơn hàng
async function loadUserOrders() {
  const container = document.getElementById('ordersListContainer');
  if (!container) return;

  container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Đang tải lịch sử đơn hàng...</div>`;

  try {
    const res = await apiRequest('/api/orders');
    state.orders = res.data;
    renderUserOrders();
  } catch (err) {
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--danger);">Lỗi tải đơn hàng: ${err.message}</div>`;
  }
}

function renderUserOrders() {
  const container = document.getElementById('ordersListContainer');
  if (!container) return;

  if (state.orders.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <p style="font-size: 36px; margin-bottom: 10px;">📦</p>
        <p style="font-size: 16px; font-weight: 600;">Bạn chưa có đơn hàng nào</p>
        <button class="btn-primary-block" style="max-width: 180px; margin: 16px auto 0;" onclick="navigate('home')">Khám phá sản phẩm</button>
      </div>
    `;
    return;
  }

  container.innerHTML = state.orders
    .map(
      ord => `
    <div class="order-history-card">
      <div class="order-history-header">
        <div>
          <strong>Mã đơn:</strong> ${ord.order_code || ord.id}
          <span style="margin-left: 14px; color: var(--text-muted);">${new Date(ord.created_at).toLocaleString('vi-VN')}</span>
        </div>
        <span style="font-weight: 700; color: #10b981;">ĐÃ GHI NHẬN</span>
      </div>
      <div class="order-history-body">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600;">${ord.product_name || 'Đơn hàng AuraMall'}</div>
            <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
              Giao đến: ${ord.recipient_name || 'Khách hàng'} - ${ord.shipping_address || 'Địa chỉ mặc định'}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 12px; color: var(--text-muted);">Tổng thanh toán:</div>
            <div style="font-size: 18px; font-weight: 800; color: var(--price-red);">${formatCurrency(ord.final_total || ord.total_price)}</div>
          </div>
        </div>
      </div>
    </div>
  `
    )
    .join('');
}

// Modal xác nhận chung
function showConfirmModal(title, message, onConfirm = null, showCancel = true) {
  const modal = document.getElementById('genericConfirmModal');
  const titleEl = document.getElementById('confirmModalTitle');
  const msgEl = document.getElementById('confirmModalMsg');
  const btnOk = document.getElementById('confirmModalBtnOk');
  const btnCancel = document.getElementById('confirmModalBtnCancel');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  if (btnCancel) {
    btnCancel.style.display = showCancel ? 'inline-block' : 'none';
  }

  btnOk.onclick = () => {
    modal.classList.remove('active');
    if (typeof onConfirm === 'function') onConfirm();
  };

  btnCancel.onclick = () => {
    modal.classList.remove('active');
  };

  modal.classList.add('active');
}

// ==========================================
// 11. KHỞI TẠO HỆ THỐNG KHI TẢI TRANG
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  // Lắng nghe sự kiện tìm kiếm
  const searchInput = document.getElementById('headerSearchInput');
  const searchBtn = document.getElementById('headerSearchBtn');

  if (searchBtn && searchInput) {
    const doSearch = () => {
      state.filters.q = searchInput.value.trim();
      state.filters.page = 1;
      navigate('home');
      loadProducts();
    };

    searchBtn.onclick = doSearch;
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch();
    });
  }

  // Khởi tạo người dùng & giỏ hàng
  updateCartBadgeUI();
  await loadCurrentUser();

  // Kiểm tra sức khỏe hệ thống
  checkHealth();
  setInterval(checkHealth, 15000); // 15s kiểm tra 1 lần

  // Mở trang chủ mặc định
  navigate('home');
});
