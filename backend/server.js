'use strict';

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const swaggerUi = require('swagger-ui-express');
const { Pool, types } = require('pg');
const openapiSpec = require('./openapi');

// Cột NUMERIC (giá tiền) và COUNT(*) mặc định được trả về dạng chuỗi, đổi sang Number để JSON trả về dạng số
types.setTypeParser(types.builtins.NUMERIC, parseFloat);
types.setTypeParser(types.builtins.INT8, Number);

const PORT = Number(process.env.PORT) || 5000;
const MAX_INT = 2147483647; // giới hạn kiểu INT của PostgreSQL
const MAX_PAGE = 100000;
const MAX_ORDER_QUANTITY = 100;
const MAX_PRICE = 9999999999; // giới hạn NUMERIC(12, 2)
const MAX_STOCK = 1000000;
const MAX_PRODUCT_IMAGES = 8;
const JWT_SECRET = process.env.JWT_SECRET || 'auramall_jwt_secret_ecommerce_2026';
// OAuth Client ID tạo tại Google Cloud Console; để trống thì tắt đăng nhập Google
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();

// Phân quyền: admin (quản trị), seller (người bán), user (người mua)
const ROLES = ['admin', 'seller', 'user'];
const SELF_SIGNUP_ROLES = ['user', 'seller']; // quyền admin chỉ do admin khác cấp
const ORDER_STATUSES = ['CREATED', 'CONFIRMED', 'DELIVERING', 'COMPLETED', 'CANCELLED'];
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// Connection pool PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'ecommerce_db',
  user: process.env.DB_USER || 'ecommerce_user',
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Lỗi kết nối CSDL:', err.message);
});

// Custom Error Class
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ==========================================
// CÁC HÀM TIỆN ÍCH AUTH & MẬT KHẨU (NATIVE CRYPTO)
// ==========================================
function hashPassword(password, salt) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, actualSalt, 10000, 64, 'sha512').toString('hex');
  return `${actualSalt}:${hash}`;
}

function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash || !storedPasswordHash.includes(':')) return false;
  const [salt, originalHash] = storedPasswordHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

function generateToken(payload, expiresInSeconds = 86400 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (signatureB64 !== expectedSignature) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Token hết hạn
    }
    return payload;
  } catch {
    return null;
  }
}

// Middleware xác thực JWT
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (token) {
    const decoded = verifyToken(token);
    if (decoded && decoded.userId) {
      req.user = decoded;
      return next();
    }
  }

  // Nếu không có token hợp lệ, req.user là null nhưng không block ở middleware này
  req.user = null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({ status: 'fail', message: 'Vui lòng đăng nhập để thực hiện thao tác này.' });
  }
  next();
}

// Chỉ cho các vai trò được liệt kê. Vai trò đọc từ CSDL nên admin đổi quyền là có hiệu lực ngay, không cần đăng nhập lại.
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user || !req.user.userId) {
      throw new HttpError(401, 'Vui lòng đăng nhập để thực hiện thao tác này.');
    }
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.userId]);
    if (result.rowCount === 0) {
      throw new HttpError(401, 'Tài khoản không còn tồn tại, vui lòng đăng nhập lại.');
    }
    req.user.role = result.rows[0].role;
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này.');
    }
    next();
  };
}

// ==========================================
// ĐĂNG NHẬP GOOGLE: kiểm tra ID token (chữ ký RS256 theo khóa công khai của Google)
// ==========================================
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let googleKeys = { byKid: new Map(), expiresAt: 0 };

async function getGoogleKey(kid) {
  if (Date.now() > googleKeys.expiresAt || !googleKeys.byKid.has(kid)) {
    let res;
    try {
      res = await fetch(GOOGLE_CERTS_URL);
    } catch {
      res = null;
    }
    if (!res || !res.ok) {
      throw new HttpError(502, 'Không kết nối được máy chủ Google để xác thực, vui lòng thử lại.');
    }
    const { keys } = await res.json();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1]) || 3600;
    googleKeys = {
      byKid: new Map(keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })])),
      expiresAt: Date.now() + maxAge * 1000,
    };
  }
  return googleKeys.byKid.get(kid);
}

async function verifyGoogleIdToken(idToken) {
  const invalid = new HttpError(401, 'Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn.');
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3) throw invalid;

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  if (header.alg !== 'RS256') throw invalid;

  const key = await getGoogleKey(header.kid);
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!key || !crypto.verify('RSA-SHA256', signed, key, Buffer.from(parts[2], 'base64url'))) throw invalid;

  const issuerOk = payload.iss === 'accounts.google.com' || payload.iss === 'https://accounts.google.com';
  if (!issuerOk || payload.aud !== GOOGLE_CLIENT_ID || !(payload.exp * 1000 > Date.now())) throw invalid;
  if (!payload.email || !(payload.email_verified === true || payload.email_verified === 'true')) {
    throw new HttpError(400, 'Email Google chưa được xác minh.');
  }
  return payload;
}

// Tên đăng nhập cho tài khoản tạo từ Google: lấy từ email, thêm số nếu trùng
async function uniqueUsername(email) {
  let base = slugify(email.split('@')[0]).replace(/-/g, '_').slice(0, 24);
  if (base.length < 3) base = `user_${base}`;
  let candidate = base;
  while ((await pool.query('SELECT 1 FROM users WHERE username = $1', [candidate])).rowCount > 0) {
    candidate = `${base}_${crypto.randomInt(1000, 10000)}`;
  }
  return candidate;
}

// Thông tin người dùng trả về khi đăng ký / đăng nhập
function authUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    phone: row.phone,
    gender: row.gender,
    birthday: row.birthday,
    avatarUrl: row.avatar_url,
    role: row.role,
  };
}

// Helper kiểm tra số nguyên
function toInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : NaN;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return NaN;
}

function parseInteger(value, name, min, max) {
  const number = toInteger(value);
  if (!(number >= min && number <= max)) {
    throw new HttpError(400, `${name} phải là số nguyên từ ${min} đến ${max}`);
  }
  return number;
}

function parseId(value, name) {
  const id = toInteger(value);
  if (!(id >= 1 && id <= MAX_INT)) {
    throw new HttpError(400, `${name} phải là số nguyên dương`);
  }
  return id;
}

// Format che email dạng ab***@gmail.com
function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local}***@${domain}`;
  return `${local.substring(0, 2)}***@${domain}`;
}

// Bỏ dấu tiếng Việt để tạo slug: "Bàn phím cơ" -> "ban-phim-co"
function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

// Chỉ nhận link ảnh http(s) hoặc ảnh có sẵn của hệ thống (/images/...), chặn javascript:, data:...
function parseImageUrl(value, name) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (url.length > 2048 || !(/^https?:\/\/[^\s"'<>]+$/i.test(url) || /^\/images\/[\w./-]+$/.test(url))) {
    throw new HttpError(400, `${name} phải là đường dẫn ảnh http(s) hợp lệ.`);
  }
  return url;
}

// Kiểm tra dữ liệu form đăng bán / sửa sản phẩm
async function validateProductInput(body) {
  const { name, categoryId, price, originalPrice, stock, imageUrl, thumbnails, description } = body ?? {};

  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (cleanName.length < 3 || cleanName.length > 255) {
    throw new HttpError(400, 'Tên sản phẩm phải từ 3 đến 255 ký tự.');
  }

  const cleanCategoryId = parseId(categoryId, 'categoryId');
  const category = await pool.query('SELECT 1 FROM categories WHERE id = $1', [cleanCategoryId]);
  if (category.rowCount === 0) {
    throw new HttpError(400, 'Danh mục sản phẩm không tồn tại.');
  }

  const cleanPrice = parseInteger(price, 'price', 1000, MAX_PRICE);
  const hasOriginal = originalPrice !== undefined && originalPrice !== null && originalPrice !== '';
  const cleanOriginal = hasOriginal ? parseInteger(originalPrice, 'originalPrice', 1000, MAX_PRICE) : null;
  if (cleanOriginal !== null && cleanOriginal < cleanPrice) {
    throw new HttpError(400, 'Giá gốc phải lớn hơn hoặc bằng giá bán.');
  }

  if (thumbnails !== undefined && !Array.isArray(thumbnails)) {
    throw new HttpError(400, 'thumbnails phải là mảng đường dẫn ảnh.');
  }
  // Ảnh chính luôn đứng đầu dải ảnh, bỏ ảnh trùng
  const images = [];
  for (const url of [imageUrl, ...(thumbnails ?? [])]) {
    if (url === undefined || url === null || url === '') continue;
    const clean = parseImageUrl(url, 'Ảnh sản phẩm');
    if (!images.includes(clean)) images.push(clean);
  }
  if (images.length > MAX_PRODUCT_IMAGES) {
    throw new HttpError(400, `Tối đa ${MAX_PRODUCT_IMAGES} ảnh cho mỗi sản phẩm.`);
  }

  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new HttpError(400, 'Mô tả sản phẩm không hợp lệ.');
  }
  const cleanDescription = (description ?? '').trim();
  if (cleanDescription.length > 5000) {
    throw new HttpError(400, 'Mô tả sản phẩm tối đa 5000 ký tự.');
  }

  return {
    name: cleanName,
    slug: slugify(cleanName),
    categoryId: cleanCategoryId,
    price: cleanPrice,
    originalPrice: cleanOriginal,
    discountPercent: cleanOriginal ? Math.round((1 - cleanPrice / cleanOriginal) * 100) : 0,
    stock: parseInteger(stock, 'stock', 0, MAX_STOCK),
    imageUrl: images[0] ?? null,
    thumbnails: images,
    description: cleanDescription || null,
  };
}

// Sản phẩm phải tồn tại và do chính người bán đăng (admin được quản lý mọi sản phẩm)
async function findOwnProduct(productId, user) {
  const result = await pool.query('SELECT seller_id FROM products WHERE id = $1', [productId]);
  if (result.rowCount === 0) {
    throw new HttpError(404, 'Không tìm thấy sản phẩm.');
  }
  if (user.role !== 'admin' && result.rows[0].seller_id !== user.userId) {
    throw new HttpError(403, 'Bạn chỉ có thể thay đổi sản phẩm do chính mình đăng bán.');
  }
}

const app = express();

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        connectSrc: ["'self'", 'http://localhost:*', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(morgan('short', { skip: (req) => req.path === '/health' }));
app.use(express.json({ limit: '10mb' })); // Hỗ trợ upload ảnh đại diện base64 đến 2MB
app.use(authenticateToken);

// ==========================================
// 1. HEALTHCHECK
// ==========================================
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'UP',
      service: 'ecommerce-backend',
      database: 'CONNECTED',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'DOWN', database: 'DISCONNECTED', timestamp: new Date().toISOString() });
  }
});

// ==========================================
// 2. AUTHENTICATION (ĐĂNG KÝ, ĐĂNG NHẬP, PROFILE)
// ==========================================

// Màn Đăng ký
app.post('/api/auth/register', async (req, res) => {
  const { username, email, phone, password, confirmPassword, role = 'user' } = req.body || {};

  // Validate các trường bắt buộc
  if (!username || !email || !phone || !password) {
    throw new HttpError(400, 'Vui lòng điền đầy đủ tất cả các trường thông tin.');
  }

  // Loại tài khoản: người mua hoặc người bán, quyền admin không tự đăng ký được
  if (!SELF_SIGNUP_ROLES.includes(role)) {
    throw new HttpError(400, 'Loại tài khoản chỉ được chọn người mua (user) hoặc người bán (seller).');
  }

  const cleanUsername = String(username).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPhone = String(phone).trim();

  // Validate tên đăng nhập
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(cleanUsername)) {
    throw new HttpError(400, 'Tên đăng nhập phải từ 3 đến 30 ký tự (chỉ bao gồm chữ, số và dấu gạch dưới).');
  }

  // Validate email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new HttpError(400, 'Địa chỉ email không đúng định dạng.');
  }

  // Validate số điện thoại (10-11 chữ số theo PDF)
  if (!/^(0|\+84)[0-9]{9,10}$/.test(cleanPhone)) {
    throw new HttpError(400, 'Số điện thoại phải gồm 10 hoặc 11 chữ số (vd: 0969795794).');
  }

  // Validate mật khẩu: tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số (theo PDF màn 1)
  if (!PASSWORD_RULE.test(password)) {
    throw new HttpError(400, 'Mật khẩu tối thiểu 8 ký tự, phải bao gồm ít nhất 1 chữ hoa, 1 chữ thường và 1 số.');
  }

  // Kiểm tra khớp mật khẩu
  if (confirmPassword !== undefined && password !== confirmPassword) {
    throw new HttpError(400, 'Mật khẩu nhập lại không khớp.');
  }

  // Kiểm tra trùng username, email
  const existing = await pool.query(
    'SELECT username, email FROM users WHERE username = $1 OR email = $2',
    [cleanUsername, cleanEmail]
  );
  if (existing.rowCount > 0) {
    if (existing.rows[0].username === cleanUsername) {
      throw new HttpError(400, 'Tên đăng nhập đã được sử dụng.');
    }
    throw new HttpError(400, 'Email đã được đăng ký trong hệ thống.');
  }

  const passwordHash = hashPassword(password);
  const insertUser = await pool.query(
    `INSERT INTO users (username, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, email, phone, gender, birthday, avatar_url, role, created_at`,
    [cleanUsername, cleanEmail, cleanPhone, passwordHash, role]
  );

  const newUser = insertUser.rows[0];
  const token = generateToken({ userId: newUser.id, username: newUser.username });

  res.status(201).json({
    status: 'success',
    message: 'Đăng ký tài khoản thành công!',
    token,
    user: authUser(newUser),
  });
});

// Màn Đăng nhập
app.post('/api/auth/login', async (req, res) => {
  const { login, password, remember } = req.body || {};

  if (!login || !password) {
    throw new HttpError(400, 'Vui lòng nhập tên đăng nhập/email/số điện thoại và mật khẩu.');
  }

  const cleanLogin = String(login).trim();

  // Tìm kiếm theo username, email hoặc số điện thoại
  const result = await pool.query(
    `SELECT id, username, email, phone, password_hash, gender, birthday, avatar_url, role
     FROM users
     WHERE username = $1 OR email = $1 OR phone = $1`,
    [cleanLogin]
  );

  if (result.rowCount === 0) {
    throw new HttpError(401, 'Tài khoản hoặc mật khẩu không chính xác.');
  }

  const user = result.rows[0];
  if (!user.password_hash) {
    throw new HttpError(401, 'Tài khoản này được tạo bằng Google. Hãy chọn "Đăng nhập với Google".');
  }
  const isValid = verifyPassword(password, user.password_hash);
  if (!isValid) {
    throw new HttpError(401, 'Tài khoản hoặc mật khẩu không chính xác.');
  }

  // Thời gian token: 30 ngày nếu ghi nhớ đăng nhập, 2 ngày nếu không
  const expiresInSeconds = remember ? 86400 * 30 : 86400 * 2;
  const token = generateToken({ userId: user.id, username: user.username }, expiresInSeconds);

  res.json({
    status: 'success',
    message: 'Đăng nhập thành công!',
    token,
    user: authUser(user),
  });
});

// Cấu hình đăng nhập Google cho giao diện (Client ID là thông tin công khai)
app.get('/api/auth/config', (req, res) => {
  res.json({ status: 'success', data: { googleClientId: GOOGLE_CLIENT_ID || null } });
});

// Đăng nhập / đăng ký bằng Google: giao diện gửi ID token nhận từ nút "Sign in with Google"
app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    throw new HttpError(503, 'Đăng nhập Google chưa được cấu hình (thiếu GOOGLE_CLIENT_ID).');
  }
  const { credential, role = 'user' } = req.body || {};
  if (!SELF_SIGNUP_ROLES.includes(role)) {
    throw new HttpError(400, 'Loại tài khoản chỉ được chọn người mua (user) hoặc người bán (seller).');
  }
  const google = await verifyGoogleIdToken(credential);
  const email = String(google.email).toLowerCase();
  const columns = 'id, username, email, phone, gender, birthday, avatar_url, role, google_sub';

  let result = await pool.query(
    `SELECT ${columns} FROM users WHERE google_sub = $1 OR email = $2
     ORDER BY (google_sub = $1) DESC NULLS LAST LIMIT 1`,
    [google.sub, email]
  );
  let user = result.rows[0];
  let created = false;

  if (user && user.google_sub && user.google_sub !== google.sub) {
    throw new HttpError(409, 'Email này đã liên kết với một tài khoản Google khác.');
  }
  if (user && !user.google_sub) {
    // Email đã đăng ký bằng mật khẩu: Google đã xác minh email nên liên kết vào tài khoản đó
    result = await pool.query(`UPDATE users SET google_sub = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING ${columns}`, [
      google.sub,
      user.id,
    ]);
    user = result.rows[0];
  } else if (!user) {
    result = await pool.query(
      `INSERT INTO users (username, email, phone, password_hash, role, google_sub, avatar_url)
       VALUES ($1, $2, '', NULL, $3, $4, $5)
       RETURNING ${columns}`,
      [await uniqueUsername(email), email, role, google.sub, google.picture || null]
    );
    user = result.rows[0];
    created = true;
  }

  const token = generateToken({ userId: user.id, username: user.username }, 86400 * 30);
  res.status(created ? 201 : 200).json({
    status: 'success',
    message: created ? 'Đã tạo tài khoản bằng Google!' : 'Đăng nhập thành công!',
    token,
    user: authUser(user),
  });
});

// Đổi mật khẩu (tài khoản tạo bằng Google chưa có mật khẩu thì đặt mới, không cần mật khẩu cũ)
app.put('/api/auth/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.userId]);
  if (result.rowCount === 0) {
    throw new HttpError(404, 'Không tìm thấy người dùng.');
  }
  const { password_hash: currentHash } = result.rows[0];

  // Sai mật khẩu cũ trả 400 (không phải 401) để giao diện không hiểu nhầm là phiên đăng nhập hết hạn
  if (currentHash && !verifyPassword(String(currentPassword ?? ''), currentHash)) {
    throw new HttpError(400, 'Mật khẩu hiện tại không chính xác.');
  }
  if (typeof newPassword !== 'string' || !PASSWORD_RULE.test(newPassword)) {
    throw new HttpError(400, 'Mật khẩu mới tối thiểu 8 ký tự, phải bao gồm ít nhất 1 chữ hoa, 1 chữ thường và 1 số.');
  }
  if (newPassword !== confirmPassword) {
    throw new HttpError(400, 'Mật khẩu nhập lại không khớp.');
  }
  if (currentHash && verifyPassword(newPassword, currentHash)) {
    throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại.');
  }

  await pool.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
    hashPassword(newPassword),
    req.user.userId,
  ]);
  res.json({ status: 'success', message: currentHash ? 'Đổi mật khẩu thành công.' : 'Đặt mật khẩu thành công.' });
});

// Lấy thông tin tài khoản hiện tại (Me)
app.get('/api/auth/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, username, email, phone, gender, birthday, avatar_url, created_at, role,
            (password_hash IS NOT NULL) AS has_password, (google_sub IS NOT NULL) AS google_linked
     FROM users WHERE id = $1`,
    [req.user.userId]
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, 'Không tìm thấy người dùng.');
  }

  const user = result.rows[0];
  res.json({
    status: 'success',
    data: {
      ...user,
      maskedEmail: maskEmail(user.email),
    },
  });
});

// ==========================================
// 3. DANH MỤC (CATEGORIES)
// ==========================================
app.get('/api/categories', async (req, res) => {
  const result = await pool.query(
    `SELECT c.id, c.name, c.slug, c.icon, c.display_order,
            COUNT(p.id)::int as product_count
     FROM categories c
     LEFT JOIN products p ON c.id = p.category_id
     GROUP BY c.id
     ORDER BY c.display_order ASC, c.id ASC`
  );

  res.json({
    status: 'success',
    total: result.rowCount,
    data: result.rows,
  });
});

// ==========================================
// 4. SẢN PHẨM (PRODUCTS) - LUỒNG NGHIỆP VỤ 1 (GET /api/products)
// ==========================================
const DETAILED_PRODUCT_COLUMNS = `
  p.id, p.name, p.slug, p.category_id, p.price, p.original_price,
  p.discount_percent, p.stock, p.rating, p.review_count, p.sold_count,
  p.is_flash_sale, p.image_url, p.thumbnails, p.description, p.created_at,
  c.name AS category_name, c.slug AS category_slug,
  p.seller_id, s.username AS seller_username
`;

app.get('/api/products', async (req, res) => {
  const page = req.query.page === undefined ? 1 : parseInteger(req.query.page, 'page', 1, MAX_PAGE);
  const limit = req.query.limit === undefined ? 20 : parseInteger(req.query.limit, 'limit', 1, 100);

  // Điều kiện lọc
  const whereClauses = [];
  const params = [];
  let paramIndex = 1;

  // Lọc theo danh mục
  if (req.query.category) {
    const catVal = String(req.query.category).trim();
    if (/^\d+$/.test(catVal)) {
      whereClauses.push(`p.category_id = $${paramIndex++}`);
      params.push(Number(catVal));
    } else {
      whereClauses.push(`c.slug = $${paramIndex++}`);
      params.push(catVal);
    }
  }

  // Lọc theo khoảng giá (từ - đến)
  if (req.query.minPrice !== undefined && req.query.minPrice !== '') {
    const minP = parseFloat(req.query.minPrice);
    if (!isNaN(minP) && minP >= 0) {
      whereClauses.push(`p.price >= $${paramIndex++}`);
      params.push(minP);
    }
  }

  if (req.query.maxPrice !== undefined && req.query.maxPrice !== '') {
    const maxP = parseFloat(req.query.maxPrice);
    if (!isNaN(maxP) && maxP >= 0) {
      whereClauses.push(`p.price <= $${paramIndex++}`);
      params.push(maxP);
    }
  }

  // Lọc theo số sao đánh giá (5 sao, 4 sao trở lên...)
  if (req.query.minRating !== undefined && req.query.minRating !== '') {
    const minR = parseFloat(req.query.minRating);
    if (!isNaN(minR) && minR >= 0 && minR <= 5) {
      whereClauses.push(`p.rating >= $${paramIndex++}`);
      params.push(minR);
    }
  }

  // Lọc Flash Sale
  if (req.query.flashSale === 'true' || req.query.flashSale === '1') {
    whereClauses.push(`p.is_flash_sale = true`);
  }

  // Tìm kiếm từ khóa (Search Bar)
  if (req.query.q) {
    const keyword = `%${String(req.query.q).trim()}%`;
    whereClauses.push(`(p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`);
    params.push(keyword);
    paramIndex++;
  }

  // Sắp xếp
  // - phổ biến: rating DESC, sold_count DESC
  // - mới nhất: p.created_at DESC
  // - bán chạy: p.sold_count DESC
  // - giá thấp đến cao: p.price ASC
  // - giá cao đến thấp: p.price DESC
  let orderByClause = 'p.id ASC';
  const sort = req.query.sort;
  if (sort === 'popular') {
    orderByClause = 'p.rating DESC, p.sold_count DESC';
  } else if (sort === 'newest') {
    orderByClause = 'p.created_at DESC, p.id DESC';
  } else if (sort === 'best_seller') {
    orderByClause = 'p.sold_count DESC';
  } else if (sort === 'price_asc') {
    orderByClause = 'p.price ASC';
  } else if (sort === 'price_desc') {
    orderByClause = 'p.price DESC';
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Đếm tổng sản phẩm theo điều kiện
  const countSql = `SELECT COUNT(*) AS total FROM products p LEFT JOIN categories c ON p.category_id = c.id ${whereSql}`;
  const countResult = await pool.query(countSql, params);
  const totalItems = countResult.rows[0].total;

  // Truy vấn lấy dữ liệu với LIMIT và OFFSET
  const limitParamIndex = paramIndex++;
  const offsetParamIndex = paramIndex++;
  const dataParams = [...params, limit, (page - 1) * limit];

  const dataSql = `
    SELECT ${DETAILED_PRODUCT_COLUMNS}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN users s ON p.seller_id = s.id
    ${whereSql}
    ORDER BY ${orderByClause}
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
  `;

  const items = await pool.query(dataSql, dataParams);

  res.json({
    status: 'success',
    total: items.rowCount,
    data: items.rows,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit) || 1,
    },
  });
});

async function getProductById(id) {
  const result = await pool.query(
    `SELECT ${DETAILED_PRODUCT_COLUMNS}
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     LEFT JOIN users s ON p.seller_id = s.id
     WHERE p.id = $1`,
    [id]
  );
  return result.rows[0];
}

app.get('/api/products/:id', async (req, res) => {
  const product = await getProductById(parseId(req.params.id, 'id'));
  if (!product) {
    throw new HttpError(404, 'Không tìm thấy sản phẩm.');
  }

  res.json({ status: 'success', data: product });
});

// ==========================================
// 4b. ĐĂNG BÁN SẢN PHẨM (KÊNH NGƯỜI BÁN) - chỉ người bán và admin
// ==========================================

// Đăng bán sản phẩm mới
app.post('/api/products', requireRole('seller', 'admin'), async (req, res) => {
  const input = await validateProductInput(req.body);
  const inserted = await pool.query(
    `INSERT INTO products (
       name, slug, category_id, price, original_price, discount_percent, stock,
       rating, review_count, sold_count, image_url, thumbnails, description, seller_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.name,
      input.slug,
      input.categoryId,
      input.price,
      input.originalPrice,
      input.discountPercent,
      input.stock,
      input.imageUrl,
      JSON.stringify(input.thumbnails),
      input.description,
      req.user.userId,
    ]
  );

  res.status(201).json({
    status: 'success',
    message: 'Đăng bán sản phẩm thành công!',
    data: await getProductById(inserted.rows[0].id),
  });
});

// Sửa sản phẩm do mình đăng bán
app.put('/api/products/:id', requireRole('seller', 'admin'), async (req, res) => {
  const id = parseId(req.params.id, 'id');
  await findOwnProduct(id, req.user);
  const input = await validateProductInput(req.body);

  await pool.query(
    `UPDATE products
     SET name = $1, slug = $2, category_id = $3, price = $4, original_price = $5, discount_percent = $6,
         stock = $7, image_url = $8, thumbnails = $9, description = $10
     WHERE id = $11`,
    [
      input.name,
      input.slug,
      input.categoryId,
      input.price,
      input.originalPrice,
      input.discountPercent,
      input.stock,
      input.imageUrl,
      JSON.stringify(input.thumbnails),
      input.description,
      id,
    ]
  );

  res.json({ status: 'success', message: 'Cập nhật sản phẩm thành công.', data: await getProductById(id) });
});

// Xóa sản phẩm do mình đăng bán (chỉ khi chưa phát sinh đơn hàng)
app.delete('/api/products/:id', requireRole('seller', 'admin'), async (req, res) => {
  const id = parseId(req.params.id, 'id');
  await findOwnProduct(id, req.user);

  try {
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
  } catch (err) {
    if (err.code === '23503') {
      // Vi phạm khóa ngoại: đơn hàng cũ vẫn tham chiếu tới sản phẩm này
      throw new HttpError(409, 'Sản phẩm đã có đơn hàng nên không thể xóa. Hãy đặt tồn kho về 0 để ngừng bán.');
    }
    throw err;
  }

  res.json({ status: 'success', message: 'Đã xóa sản phẩm.' });
});

// Danh sách sản phẩm do người dùng hiện tại đăng bán
app.get('/api/user/products', requireRole('seller', 'admin'), async (req, res) => {
  const result = await pool.query(
    `SELECT ${DETAILED_PRODUCT_COLUMNS}
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     LEFT JOIN users s ON p.seller_id = s.id
     WHERE p.seller_id = $1
     ORDER BY p.created_at DESC, p.id DESC`,
    [req.user.userId]
  );

  res.json({ status: 'success', total: result.rowCount, data: result.rows });
});

// ==========================================
// 5. ĐƠN HÀNG (ORDERS) - LUỒNG NGHIỆP VỤ 2 (POST /api/orders)
// ==========================================
function parseOrderItems(body) {
  // Hỗ trợ cả 2 định dạng:
  // 1. Single item (k6 load test & script kiểm thử cũ): { productId: 1, quantity: 2 }
  // 2. Multi-item cart checkout (PDF screens): { items: [{ productId, quantity }], ... }
  if (Array.isArray(body?.items) && body.items.length > 0) {
    return body.items.map((it, idx) => ({
      productId: parseId(it.productId, `items[${idx}].productId`),
      quantity: it.quantity === undefined ? 1 : parseInteger(it.quantity, `items[${idx}].quantity`, 1, MAX_ORDER_QUANTITY),
    }));
  }

  const { productId, quantity } = body || {};
  if (productId !== undefined) {
    return [
      {
        productId: parseId(productId, 'productId'),
        quantity: quantity === undefined ? 1 : parseInteger(quantity, 'quantity', 1, MAX_ORDER_QUANTITY),
      },
    ];
  }

  throw new HttpError(400, 'Dữ liệu đơn hàng không hợp lệ, cần ít nhất 1 sản phẩm.');
}

app.post('/api/orders', async (req, res) => {
  const itemsToBuy = parseOrderItems(req.body);
  const recipientName = req.body.recipientName || 'Khách hàng';
  const recipientPhone = req.body.recipientPhone || '0969795794';
  const shippingAddress = req.body.shippingAddress || 'Địa chỉ nhận hàng mặc định';
  const paymentMethod = req.body.paymentMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'COD';
  const buyerNote = req.body.note || req.body.buyerNote || '';
  // Không có token (k6 loadtest): đơn của khách vãng lai, user_id = NULL, không gán vào tài khoản nào
  const userId = req.user ? req.user.userId : null;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let totalGoodsPrice = 0;
    const processedItems = [];

    // Duyệt qua từng sản phẩm để trừ kho nguyên tử
    // Sắp xếp ID tăng dần để tránh Deadlock khi nhiều request trừ kho các sản phẩm giống nhau
    const sortedItems = [...itemsToBuy].sort((a, b) => a.productId - b.productId);

    for (const item of sortedItems) {
      const updated = await client.query(
        'UPDATE products SET stock = stock - $1, sold_count = sold_count + $1 WHERE id = $2 AND stock >= $1 RETURNING id, name, price, stock, image_url',
        [item.quantity, item.productId]
      );

      if (updated.rowCount === 0) {
        // Kiểm tra xem sản phẩm có tồn tại không hay do hết hàng
        const exists = await client.query('SELECT 1 FROM products WHERE id = $1', [item.productId]);
        if (exists.rowCount === 0) {
          throw new HttpError(404, `Không tìm thấy sản phẩm có ID ${item.productId}.`);
        }
        // Thông báo lỗi chính xác theo yêu cầu phân tích màn hình (Page 3 PDF)
        throw new HttpError(409, 'rất tiếc, sản phẩm vừa hết hàng do số lượng có hạn!');
      }

      const prod = updated.rows[0];
      const subtotal = prod.price * item.quantity;
      totalGoodsPrice += subtotal;

      processedItems.push({
        productId: prod.id,
        name: prod.name,
        price: prod.price,
        quantity: item.quantity,
        subtotal,
        imageUrl: prod.image_url,
        remainingStock: prod.stock,
      });
    }

    // Phí vận chuyển: mặc định 30,000 VND, miễn phí nếu đơn hàng từ 500,000 VND
    const shippingFee = totalGoodsPrice >= 500000 ? 0 : 30000;
    const finalTotal = totalGoodsPrice + shippingFee;

    // Sinh mã đơn hàng ngẫu nhiên chuyên nghiệp: vd AUR-20261103-A8F2
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    const orderCode = `AUR-${dateStr}-${randomHex}`;

    // Lưu vào bảng orders (giữ product_id và quantity của item đầu tiên để tương thích test k6 và query cũ)
    const firstItem = processedItems[0];
    const orderResult = await client.query(
      `INSERT INTO orders (
        order_code, user_id, product_id, quantity, total_price, shipping_fee, final_total,
        recipient_name, recipient_phone, shipping_address, payment_method, buyer_note, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'CREATED')
      RETURNING id, order_code, total_price, shipping_fee, final_total, status, created_at`,
      [
        orderCode,
        userId,
        firstItem.productId,
        firstItem.quantity,
        totalGoodsPrice,
        shippingFee,
        finalTotal,
        recipientName,
        recipientPhone,
        shippingAddress,
        paymentMethod,
        buyerNote,
      ]
    );

    const createdOrder = orderResult.rows[0];

    // Lưu chi tiết từng sản phẩm vào order_items
    for (const item of processedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [createdOrder.id, item.productId, item.name, item.imageUrl, item.quantity, item.price, item.subtotal]
      );
    }

    await client.query('COMMIT');

    // Phản hồi HTTP 201 Created (Bao gồm cả các trường cũ cho k6 loadtest)
    res.status(201).json({
      status: 'success',
      message: 'Tạo đơn hàng thành công!',
      orderId: createdOrder.id,
      orderCode: createdOrder.order_code,
      product: {
        id: firstItem.productId,
        name: firstItem.name,
        remainingStock: firstItem.remainingStock,
      },
      items: processedItems,
      quantity: firstItem.quantity,
      totalPrice: createdOrder.total_price,
      shippingFee: createdOrder.shipping_fee,
      finalTotal: createdOrder.final_total,
      paymentMethod,
      createdAt: createdOrder.created_at,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// Tra cứu danh sách đơn hàng của chính người đang đăng nhập (admin xem toàn bộ tại /api/admin/orders)
app.get('/api/orders', requireAuth, async (req, res) => {
  const userId = req.user.userId;

  let querySql = `
    SELECT o.id, o.order_code, o.quantity, o.total_price, o.shipping_fee, o.final_total,
           o.recipient_name, o.recipient_phone, o.shipping_address, o.payment_method,
           o.status, o.created_at, p.name AS product_name, p.image_url AS product_image,
           COALESCE(json_agg(
             json_build_object(
               'productId', oi.product_id,
               'name', oi.product_name,
               'image', oi.product_image,
               'quantity', oi.quantity,
               'unitPrice', oi.unit_price,
               'subtotal', oi.subtotal
             )
           ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
  `;

  querySql += `
    WHERE o.user_id = $1
    GROUP BY o.id, p.name, p.image_url
    ORDER BY o.id DESC
    LIMIT 50
  `;

  const result = await pool.query(querySql, [userId]);
  res.json({ status: 'success', total: result.rowCount, data: result.rows });
});

// Tra cứu 1 đơn hàng cụ thể: chỉ chủ đơn hoặc admin
app.get('/api/orders/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id, 'id');
  const result = await pool.query(
    `SELECT o.*, COALESCE(json_agg(
       json_build_object(
         'productId', oi.product_id,
         'name', oi.product_name,
         'image', oi.product_image,
         'quantity', oi.quantity,
         'unitPrice', oi.unit_price,
         'subtotal', oi.subtotal
       )
     ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE o.id = $1
     GROUP BY o.id`,
    [id]
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, 'Không tìm thấy đơn hàng.');
  }

  const order = result.rows[0];
  if (order.user_id !== req.user.userId) {
    const viewer = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.userId]);
    if (viewer.rows[0]?.role !== 'admin') {
      throw new HttpError(403, 'Bạn không có quyền xem đơn hàng này.');
    }
  }

  res.json({ status: 'success', data: order });
});

// ==========================================
// 6. THÔNG TIN NGƯỜI DÙNG & SỔ ĐỊA CHỈ (USER PROFILE & ADDRESSES)
// ==========================================

// Lấy hồ sơ người dùng
app.get('/api/user/profile', requireAuth, async (req, res) => {
  const userId = req.user.userId;

  const result = await pool.query(
    `SELECT id, username, email, phone, gender, birthday, avatar_url, created_at
     FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, 'Không tìm thấy thông tin người dùng.');
  }

  const user = result.rows[0];
  res.json({
    status: 'success',
    data: {
      ...user,
      maskedEmail: maskEmail(user.email),
    },
  });
});

// Cập nhật hồ sơ người dùng (PUT /api/user/profile)
app.put('/api/user/profile', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const { email, phone, gender, birthday, avatarUrl } = req.body || {};

  // Validate email
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    throw new HttpError(400, 'Địa chỉ email không hợp lệ.');
  }

  // Validate số điện thoại (10-11 chữ số theo PDF Page 3)
  if (phone && !/^(0|\+84)[0-9]{9,10}$/.test(String(phone).trim())) {
    throw new HttpError(400, 'Số điện thoại phải gồm 10 hoặc 11 chữ số đúng định dạng (vd: 0969795794).');
  }

  // Validate ngày sinh không vượt quá ngày hiện tại (PDF Page 3)
  if (birthday) {
    const bDate = new Date(birthday);
    if (isNaN(bDate.getTime())) {
      throw new HttpError(400, 'Ngày sinh không hợp lệ.');
    }
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (bDate > today) {
      throw new HttpError(400, 'Ngày sinh không được vượt quá ngày hiện tại.');
    }
  }

  // Giới tính hợp lệ: nam, nu, khac
  const validGenders = ['nam', 'nu', 'khac'];
  const sanitizedGender = gender && validGenders.includes(gender.toLowerCase()) ? gender.toLowerCase() : undefined;

  const updateResult = await pool.query(
    `UPDATE users
     SET email = COALESCE($1, email),
         phone = COALESCE($2, phone),
         gender = COALESCE($3, gender),
         birthday = COALESCE($4, birthday),
         avatar_url = COALESCE($5, avatar_url),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $6
     RETURNING id, username, email, phone, gender, birthday, avatar_url, updated_at`,
    [
      email ? String(email).trim().toLowerCase() : null,
      phone ? String(phone).trim() : null,
      sanitizedGender || null,
      birthday ? new Date(birthday) : null,
      avatarUrl || null,
      userId,
    ]
  );

  const updatedUser = updateResult.rows[0];
  res.json({
    status: 'success',
    message: 'cập nhật hồ sơ thành công', // chuỗi thông báo toast theo PDF
    data: {
      ...updatedUser,
      maskedEmail: maskEmail(updatedUser.email),
    },
  });
});

// Upload avatar người dùng (POST /api/user/avatar)
app.post('/api/user/avatar', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const { imageBase64 } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw new HttpError(400, 'Dữ liệu ảnh không hợp lệ.');
  }

  // Kiểm tra định dạng: chỉ chấp nhận png, jpg, jpeg (theo PDF Page 4)
  const mimeMatch = imageBase64.match(/^data:image\/(png|jpeg|jpg);base64,/i);
  if (!mimeMatch) {
    throw new HttpError(400, 'Định dạng hợp lệ: chỉ chấp nhận .png/.jpg/.jpeg');
  }

  // Ràng buộc dung lượng tối đa 2MB (tránh tràn bộ nhớ server - PDF Page 4)
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const bufferLength = Buffer.byteLength(base64Data, 'base64');
  const MAX_SIZE = 2 * 1024 * 1024; // 2MB
  if (bufferLength > MAX_SIZE) {
    throw new HttpError(400, 'Dung lượng file tối đa 2MB. Vui lòng chọn ảnh nhỏ hơn.');
  }

  await pool.query('UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
    imageBase64,
    userId,
  ]);

  res.json({
    status: 'success',
    message: 'Cập nhật ảnh đại diện thành công.',
    avatarUrl: imageBase64,
  });
});

// Lấy danh sách địa chỉ nhận hàng
app.get('/api/user/addresses', requireAuth, async (req, res) => {
  const userId = req.user.userId;

  const result = await pool.query(
    `SELECT id, recipient_name, phone, detail_address, is_default, created_at
     FROM user_addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, id DESC`,
    [userId]
  );

  res.json({
    status: 'success',
    total: result.rowCount,
    data: result.rows,
  });
});

// Thêm địa chỉ nhận hàng mới
app.post('/api/user/addresses', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const { recipientName, phone, detailAddress, isDefault } = req.body || {};

  if (!recipientName || !phone || !detailAddress) {
    throw new HttpError(400, 'Vui lòng nhập tên người nhận, số điện thoại và địa chỉ cụ thể.');
  }

  // Validate SĐT
  if (!/^(0|\+84)[0-9]{9,10}$/.test(String(phone).trim())) {
    throw new HttpError(400, 'Số điện thoại không đúng định dạng (10-11 số).');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Kiểm tra xem user đã có địa chỉ nào chưa
    const existing = await client.query('SELECT COUNT(*) AS total FROM user_addresses WHERE user_id = $1', [userId]);
    const isFirst = Number(existing.rows[0].total) === 0;
    const shouldBeDefault = isDefault || isFirst;

    if (shouldBeDefault) {
      // Hủy mặc định của các địa chỉ cũ
      await client.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [userId]);
    }

    const insertResult = await client.query(
      `INSERT INTO user_addresses (user_id, recipient_name, phone, detail_address, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, recipient_name, phone, detail_address, is_default, created_at`,
      [userId, String(recipientName).trim(), String(phone).trim(), String(detailAddress).trim(), shouldBeDefault]
    );

    await client.query('COMMIT');
    res.status(201).json({
      status: 'success',
      message: 'Thêm địa chỉ nhận hàng thành công.',
      data: insertResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// Sửa địa chỉ nhận hàng (PUT /api/user/addresses/:id)
app.put('/api/user/addresses/:id', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const addressId = parseId(req.params.id, 'addressId');
  const { recipientName, phone, detailAddress, isDefault } = req.body || {};

  if (!recipientName || !phone || !detailAddress) {
    throw new HttpError(400, 'Vui lòng điền đầy đủ tên người nhận, số điện thoại và địa chỉ chi tiết.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (isDefault) {
      await client.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [userId]);
    }

    const updateResult = await client.query(
      `UPDATE user_addresses
       SET recipient_name = $1, phone = $2, detail_address = $3,
           is_default = COALESCE($4, is_default), updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND user_id = $6
       RETURNING id, recipient_name, phone, detail_address, is_default, updated_at`,
      [String(recipientName).trim(), String(phone).trim(), String(detailAddress).trim(), isDefault, addressId, userId]
    );

    if (updateResult.rowCount === 0) {
      throw new HttpError(404, 'Không tìm thấy địa chỉ để cập nhật.');
    }

    await client.query('COMMIT');
    res.json({
      status: 'success',
      message: 'Cập nhật địa chỉ thành công.',
      data: updateResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// Xóa địa chỉ nhận hàng (DELETE /api/user/addresses/:id)
// Quy tắc nghiệp vụ (PDF Page 4): Nếu chỉ có duy nhất 1 địa chỉ mặc định, không được xóa và báo "Cần ít nhất 1 địa chỉ nhận hàng"
app.delete('/api/user/addresses/:id', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const addressId = parseId(req.params.id, 'addressId');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Đếm tổng số địa chỉ hiện có của user
    const totalCountRes = await client.query('SELECT COUNT(*) AS total FROM user_addresses WHERE user_id = $1', [userId]);
    const totalCount = Number(totalCountRes.rows[0].total);

    if (totalCount <= 1) {
      throw new HttpError(400, 'Cần ít nhất 1 địa chỉ nhận hàng');
    }

    // Kiểm tra địa chỉ cần xóa có tồn tại và có phải là mặc định không
    const targetRes = await client.query('SELECT is_default FROM user_addresses WHERE id = $1 AND user_id = $2', [
      addressId,
      userId,
    ]);

    if (targetRes.rowCount === 0) {
      throw new HttpError(404, 'Không tìm thấy địa chỉ.');
    }

    const wasDefault = targetRes.rows[0].is_default;

    await client.query('DELETE FROM user_addresses WHERE id = $1 AND user_id = $2', [addressId, userId]);

    // Nếu vừa xóa địa chỉ mặc định, tự động chuyển 1 địa chỉ còn lại thành mặc định
    if (wasDefault) {
      await client.query(
        `UPDATE user_addresses
         SET is_default = true
         WHERE id = (SELECT id FROM user_addresses WHERE user_id = $1 ORDER BY id DESC LIMIT 1)`,
        [userId]
      );
    }

    await client.query('COMMIT');
    res.json({
      status: 'success',
      message: 'Xóa địa chỉ thành công.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// Đặt làm địa chỉ mặc định (PATCH /api/user/addresses/:id/default)
app.patch('/api/user/addresses/:id/default', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const addressId = parseId(req.params.id, 'addressId');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [userId]);

    const result = await client.query(
      `UPDATE user_addresses
       SET is_default = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING id, recipient_name, phone, detail_address, is_default`,
      [addressId, userId]
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, 'Không tìm thấy địa chỉ.');
    }

    await client.query('COMMIT');
    res.json({
      status: 'success',
      message: 'Đã thiết lập làm địa chỉ mặc định.',
      data: result.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// ==========================================
// 7a. KÊNH NGƯỜI BÁN: ĐƠN HÀNG CÓ SẢN PHẨM CỦA SHOP
// ==========================================
app.get('/api/seller/orders', requireRole('seller', 'admin'), async (req, res) => {
  const [items, summary] = await Promise.all([
    pool.query(
      `SELECT o.id AS order_id, o.order_code, o.status, o.created_at, o.payment_method,
              o.recipient_name, o.recipient_phone, o.shipping_address, u.username AS buyer_username,
              oi.product_id, oi.product_name, oi.product_image, oi.quantity, oi.unit_price, oi.subtotal
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN users u ON u.id = o.user_id
       WHERE p.seller_id = $1
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 200`,
      [req.user.userId]
    ),
    // Thống kê bỏ qua đơn đã hủy
    pool.query(
      `SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.quantity), 0) AS items_sold,
              COALESCE(SUM(oi.subtotal), 0) AS revenue
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE p.seller_id = $1 AND o.status <> 'CANCELLED'`,
      [req.user.userId]
    ),
  ]);

  const { orders, items_sold: itemsSold, revenue } = summary.rows[0];
  res.json({ status: 'success', total: items.rowCount, summary: { orders, itemsSold, revenue }, data: items.rows });
});

// ==========================================
// 7b. QUẢN TRỊ HỆ THỐNG - chỉ admin
// ==========================================
// Đơn cũ từ KT1 chưa có final_total (mặc định 0) thì lấy total_price
const ORDER_TOTAL_SQL = 'CASE WHEN o.final_total > 0 THEN o.final_total ELSE o.total_price END';

app.get('/api/admin/stats', requireRole('admin'), async (req, res) => {
  const [users, products, orders] = await Promise.all([
    pool.query('SELECT role, COUNT(*) AS count FROM users GROUP BY role'),
    pool.query('SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE stock = 0) AS out_of_stock FROM products'),
    pool.query(`SELECT o.status, COUNT(*) AS count, COALESCE(SUM(${ORDER_TOTAL_SQL}), 0) AS amount FROM orders o GROUP BY o.status`),
  ]);

  const byRole = Object.fromEntries(ROLES.map((role) => [role, 0]));
  users.rows.forEach((row) => (byRole[row.role] = row.count));
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
  let revenue = 0;
  orders.rows.forEach((row) => {
    byStatus[row.status] = row.count;
    if (row.status !== 'CANCELLED') revenue += row.amount;
  });

  res.json({
    status: 'success',
    data: {
      users: { total: users.rows.reduce((sum, row) => sum + row.count, 0), ...byRole },
      products: { total: products.rows[0].total, outOfStock: products.rows[0].out_of_stock },
      orders: { total: orders.rows.reduce((sum, row) => sum + row.count, 0), byStatus },
      revenue,
    },
  });
});

// Danh sách người dùng (lọc theo quyền, tìm theo tên/email/SĐT)
app.get('/api/admin/users', requireRole('admin'), async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.role) {
    if (!ROLES.includes(req.query.role)) {
      throw new HttpError(400, 'role phải là admin, seller hoặc user.');
    }
    params.push(req.query.role);
    where.push(`u.role = $${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    where.push(`(u.username ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.phone ILIKE $${params.length})`);
  }

  // Không trả avatar_url: ảnh tải lên lưu dạng base64 rất nặng
  const result = await pool.query(
    `SELECT u.id, u.username, u.email, u.phone, u.role, u.created_at,
            (u.google_sub IS NOT NULL) AS google_linked,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
            (SELECT COUNT(*) FROM products p WHERE p.seller_id = u.id) AS product_count
     FROM users u
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY u.id
     LIMIT 500`,
    params
  );
  res.json({ status: 'success', total: result.rowCount, data: result.rows });
});

// Phân quyền người dùng
app.patch('/api/admin/users/:id/role', requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id, 'id');
  const { role } = req.body || {};
  if (!ROLES.includes(role)) {
    throw new HttpError(400, 'Quyền không hợp lệ, chỉ nhận admin, seller hoặc user.');
  }
  // Tránh tự khóa mình khỏi trang quản trị
  if (id === req.user.userId) {
    throw new HttpError(400, 'Không thể tự thay đổi quyền của chính mình.');
  }

  const result = await pool.query(
    'UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, username, role',
    [role, id]
  );
  if (result.rowCount === 0) {
    throw new HttpError(404, 'Không tìm thấy người dùng.');
  }
  res.json({ status: 'success', message: `Đã cập nhật quyền cho ${result.rows[0].username}.`, data: result.rows[0] });
});

// Toàn bộ đơn hàng, có phân trang và lọc theo trạng thái
app.get('/api/admin/orders', requireRole('admin'), async (req, res) => {
  const page = req.query.page === undefined ? 1 : parseInteger(req.query.page, 'page', 1, MAX_PAGE);
  const limit = req.query.limit === undefined ? 20 : parseInteger(req.query.limit, 'limit', 1, 100);
  const params = [];
  let where = '';
  if (req.query.status) {
    const status = String(req.query.status).toUpperCase();
    if (!ORDER_STATUSES.includes(status)) {
      throw new HttpError(400, `status phải là một trong: ${ORDER_STATUSES.join(', ')}.`);
    }
    params.push(status);
    where = 'WHERE o.status = $1';
  }

  const [count, rows] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS total FROM orders o ${where}`, params),
    pool.query(
      `SELECT o.id, o.order_code, o.status, o.created_at, o.payment_method, o.quantity,
              o.total_price, o.shipping_fee, ${ORDER_TOTAL_SQL} AS final_total,
              o.recipient_name, o.recipient_phone, o.shipping_address, o.buyer_note,
              u.username AS buyer_username, p.name AS product_name, p.image_url AS product_image,
              COALESCE(json_agg(
                json_build_object(
                  'productId', oi.product_id,
                  'name', oi.product_name,
                  'image', oi.product_image,
                  'quantity', oi.quantity,
                  'unitPrice', oi.unit_price,
                  'subtotal', oi.subtotal
                )
              ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${where}
       GROUP BY o.id, u.username, p.name, p.image_url
       ORDER BY o.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    ),
  ]);

  const totalItems = count.rows[0].total;
  res.json({
    status: 'success',
    total: rows.rowCount,
    data: rows.rows,
    pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) || 1 },
  });
});

// Cập nhật trạng thái đơn hàng; hủy đơn thì hoàn lại tồn kho và lượt bán
app.patch('/api/admin/orders/:id/status', requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id, 'id');
  const status = String(req.body?.status ?? '').toUpperCase();
  if (!ORDER_STATUSES.includes(status)) {
    throw new HttpError(400, `Trạng thái phải là một trong: ${ORDER_STATUSES.join(', ')}.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT status, product_id, quantity FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (found.rowCount === 0) {
      throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    }
    const current = found.rows[0];
    if (current.status === 'CANCELLED' && status !== 'CANCELLED') {
      throw new HttpError(409, 'Đơn hàng đã hủy, không thể chuyển sang trạng thái khác.');
    }

    if (status === 'CANCELLED' && current.status !== 'CANCELLED') {
      const items = await client.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id',
        [id]
      );
      // Đơn cũ từ KT1 không có order_items: hoàn theo product_id/quantity của đơn
      const restock = items.rowCount ? items.rows : [{ product_id: current.product_id, quantity: current.quantity }];
      for (const item of restock) {
        if (!item.product_id) continue;
        await client.query(
          'UPDATE products SET stock = stock + $1, sold_count = GREATEST(sold_count - $1, 0) WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  res.json({ status: 'success', message: 'Đã cập nhật trạng thái đơn hàng.', data: { id, status } });
});

// ==========================================
// 8. TÀI LIỆU API (SWAGGER UI) - qua Nginx: http://localhost/api/docs/
// ==========================================
app.get('/api/docs/openapi.json', (req, res) => {
  res.json(openapiSpec);
});

// Đường dẫn tương đối của CSS/JS Swagger cần dấu "/" ở cuối
app.get('/api/docs', (req, res, next) => {
  if (!req.originalUrl.split('?')[0].endsWith('/')) {
    return res.redirect(301, '/api/docs/');
  }
  next();
});

app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'AuraMall API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: { persistAuthorization: true, validatorUrl: null },
  })
);

// ==========================================
// 404 & ERROR HANDLING MIDDLEWARE
// ==========================================
app.use((req, res) => {
  res.status(404).json({ status: 'fail', message: 'Không tìm thấy đường dẫn.' });
});

app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ status: 'fail', message: err.message });
  }
  if (err.expose && err.status < 500) {
    return res.status(err.status).json({ status: 'fail', message: 'Dữ liệu gửi lên không hợp lệ.' });
  }
  console.error('Server error:', err);
  res.status(500).json({ status: 'error', message: 'Lỗi máy chủ nội bộ.' });
});

// Khởi chạy HTTP Server
const server = app.listen(PORT, () => {
  console.log(`Backend Auramall đang chạy tại cổng ${PORT}`);
  autoMigrateDatabase();
});

// Ảnh của 24 sản phẩm mẫu, lưu tại frontend/images/products để Nginx phục vụ trực tiếp (nguồn ảnh: CREDITS.md)
const SEED_PRODUCT_IMAGES = {
  1: ['akko-3087.jpg', 'akko-3087-2.jpg', 'akko-3087-3.jpg'],
  2: ['logitech-g502.jpg', 'logitech-g502-2.jpg', 'logitech-g502-3.jpg'],
  3: ['sony-wh1000xm5.jpg', 'sony-wh1000xm5-2.jpg'],
  4: ['dell-ultrasharp-27.jpg', 'dell-ultrasharp-27-2.jpg'],
  5: ['gia-do-laptop.jpg'],
  6: ['webcam-1080p.jpg', 'webcam-1080p-2.jpg'],
  7: ['den-ban-led.jpg', 'den-ban-led-2.jpg'],
  8: ['samsung-t7.jpg', 'samsung-t7-2.jpg', 'samsung-t7-3.jpg'],
  9: ['cap-usb-c-100w.jpg', 'cap-usb-c-100w-2.jpg'],
  10: ['cu-sac-gan-65w.jpg', 'cu-sac-gan-65w-2.jpg'],
  11: ['hub-usb-c-8in1.jpg', 'hub-usb-c-8in1-2.jpg'],
  12: ['jbl-flip-6.jpg', 'jbl-flip-6-2.jpg'],
  13: ['micro-podcast.jpg'],
  14: ['ghe-cong-thai-hoc.jpg', 'ghe-cong-thai-hoc-2.jpg', 'ghe-cong-thai-hoc-3.jpg'],
  15: ['ban-nang-ha.jpg'],
  16: ['lot-chuot-xl.jpg', 'lot-chuot-xl-2.jpg'],
  17: ['quat-mini.jpg', 'quat-mini-2.jpg', 'quat-mini-3.jpg'],
  18: ['pin-du-phong-20000.jpg', 'pin-du-phong-20000-2.jpg'],
  19: ['tui-chong-soc-laptop.jpg'],
  20: ['flash-sale-test.jpg'],
  21: ['auraphone-pro.jpg'],
  22: ['ao-polo.jpg', 'ao-polo-2.jpg'],
  23: ['giay-aurasport.jpg'],
  24: ['aurawatch-ultra.jpg'],
};

// Tự động kiểm tra, bổ sung cột mới và nạp dữ liệu mẫu/hình ảnh nếu CSDL chưa có
async function autoMigrateDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        icon VARCHAR(50) DEFAULT '📦',
        display_order INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        phone VARCHAR(20) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        gender VARCHAR(10) DEFAULT 'other',
        birthday DATE,
        avatar_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_addresses (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        detail_address TEXT NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE products ADD COLUMN IF NOT EXISTS slug VARCHAR(255);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS original_price NUMERIC(12, 2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_percent INT DEFAULT 0;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS rating NUMERIC(2, 1) DEFAULT 5.0;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count INT DEFAULT 0;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_count INT DEFAULT 0;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS is_flash_sale BOOLEAN DEFAULT FALSE;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS thumbnails JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_id INT;
      CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products(seller_id);

      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'seller', 'user'));
      ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255) UNIQUE;
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

      ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_code VARCHAR(50);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12, 2) DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_total NUMERIC(12, 2) DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(100);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(20);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'COD';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_note TEXT;

      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INT NOT NULL REFERENCES products(id),
        product_name VARCHAR(255) NOT NULL,
        product_image TEXT,
        quantity INT NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
        subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0)
      );
    `);

    // 1. Kiểm tra nạp danh mục
    const catCheck = await pool.query('SELECT COUNT(*) AS total FROM categories');
    if (Number(catCheck.rows[0].total) === 0) {
      await pool.query(`
        INSERT INTO categories (id, name, slug, icon, display_order) VALUES
        (1, 'Điện thoại & Phụ kiện', 'dien-thoai-phu-kien', '📱', 1),
        (2, 'Thời trang & Quần áo', 'thoi-trang-quan-ao', '👕', 2),
        (3, 'Laptop & Máy tính', 'laptop-may-tinh', '💻', 3),
        (4, 'Thiết bị Âm thanh', 'thiet-bi-am-thanh', '🎧', 4),
        (5, 'Màn hình & Đồ họa', 'man-hinh-do-hoa', '🖥️', 5),
        (6, 'Bàn ghế Công thái học', 'ban-ghe-cong-thai-hoc', '🪑', 6),
        (7, 'Ổ cứng & Thiết bị lưu trữ', 'thiet-bi-luu-tru', '💾', 7),
        (8, 'Cáp sạc & Pin sạc', 'cap-sac-pin-sac', '🔋', 8),
        (9, 'Thiết bị Nhà thông minh', 'thiet-bi-nha-thong-minh', '💡', 9),
        (10, 'Gaming & Ngoại vi', 'gaming-ngoai-vi', '🎮', 10)
        ON CONFLICT (id) DO NOTHING;
        SELECT setval('categories_id_seq', (SELECT MAX(id) FROM categories));
      `);
    }

    // 2. Kiểm tra nạp user mẫu
    const userCheck = await pool.query('SELECT COUNT(*) AS total FROM users');
    if (Number(userCheck.rows[0].total) === 0) {
      await pool.query(`
        INSERT INTO users (id, username, email, phone, password_hash, gender, birthday, avatar_url) VALUES
        (1, 'auramall_user', 'user@auramall.vn', '0969795794', 'auramall_salt_2026:65c7a1753ec3bd87b6778e501e946f368c4e4c4186e3c43f82d531eed6393e83a1dbf4da15d567a56a3fb6cf8ae517f35389e5dde5ecf9a63bfc81bae53501ac', 'nam', '1998-05-15', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80')
        ON CONFLICT (id) DO NOTHING;
        SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

        INSERT INTO user_addresses (id, user_id, recipient_name, phone, detail_address, is_default) VALUES
        (1, 1, 'Nguyễn Văn A', '0969795794', 'Số 12 ngõ 86 đường Cầu Giấy, Phường Quan Hoa, Quận Cầu Giấy, Hà Nội', true),
        (2, 1, 'Nguyễn Văn A (Văn phòng)', '0969795794', 'Tầng 18, Keangnam Landmark 72, Đường Phạm Hùng, Phường Mễ Trì, Quận Nam Từ Liêm, Hà Nội', false)
        ON CONFLICT (id) DO NOTHING;
        SELECT setval('user_addresses_id_seq', (SELECT MAX(id) FROM user_addresses));
      `);
    }

    // 3. Cập nhật thông tin mở rộng cho sản phẩm (CSDL cũ từ KT1 chưa có ảnh và danh mục)
    const prodImgCheck = await pool.query('SELECT COUNT(*) AS total FROM products WHERE image_url IS NOT NULL');
    if (Number(prodImgCheck.rows[0].total) < 20) {
      const sampleProducts = [
        { id: 1, cat: 10, orig: 1550000, disc: 19, rate: 4.9, sold: 1240, flash: false, desc: 'Bàn phím cơ không dây AKKO 3087 v2 switch Akko CS độc quyền, keycap PBT Doubleshot bền bỉ, kết nối Bluetooth 5.0 và Type-C.' },
        { id: 2, cat: 10, orig: 1190000, disc: 25, rate: 4.8, sold: 2400, flash: true, desc: 'Cảm biến HERO 25K tiên tiến, 11 nút có thể lập trình, hệ thống tạ điều chỉnh trọng lượng linh hoạt.' },
        { id: 3, cat: 4, orig: 7990000, disc: 18, rate: 4.9, sold: 850, flash: false, desc: 'Công nghệ chống ồn hàng đầu thế giới với bộ xử lý Integrated Processor V1, pin 30 giờ.' },
        { id: 4, cat: 5, orig: 12900000, disc: 13, rate: 5.0, sold: 420, flash: false, desc: 'Tấm nền IPS Black độ tương phản 2000:1, độ phủ màu 100% sRGB, cổng kết nối Type-C cấp nguồn 90W.' },
        { id: 5, cat: 3, orig: 450000, disc: 28, rate: 4.7, sold: 3100, flash: false, desc: 'Chất liệu hợp kim nhôm nguyên khối, đệm silicon chống trượt và trầy xước, tùy chỉnh 6 cấp độ cao.' },
        { id: 6, cat: 10, orig: 950000, disc: 21, rate: 4.6, sold: 620, flash: false, desc: 'Độ phân giải Full HD 1080p 60fps mượt mà, tự động lấy nét nhanh, mic kép lọc ồn thông minh.' },
        { id: 7, cat: 9, orig: 600000, disc: 25, rate: 4.8, sold: 980, flash: false, desc: 'Chỉ số hoàn màu Ra>95 bảo vệ thị lực, điều khiển cảm ứng trượt mượt mà, hẹn giờ tắt thông minh.' },
        { id: 8, cat: 7, orig: 2890000, disc: 18, rate: 4.9, sold: 1150, flash: false, desc: 'Tốc độ đọc/ghi lên tới 1.050MB/s NVMe, vỏ nhôm chống sốc rơi vỡ tới 2 mét, bảo mật vân tay.' },
        { id: 9, cat: 8, orig: 250000, disc: 24, rate: 4.9, sold: 5600, flash: true, desc: 'Hỗ trợ công suất Power Delivery 100W, dây bọc dù bện nylon siêu bền chịu uốn 25.000 lần.' },
        { id: 10, cat: 8, orig: 650000, disc: 24, rate: 4.8, sold: 1800, flash: true, desc: 'Công nghệ bán dẫn GaN nhỏ gọn hơn 50%, trang bị 2 cổng USB-C và 1 USB-A sạc cùng lúc 3 thiết bị.' },
        { id: 11, cat: 3, orig: 790000, disc: 21, rate: 4.7, sold: 920, flash: false, desc: 'Mở rộng toàn diện: HDMI 4K 60Hz, sạc pass-through PD 100W, khe thẻ SD/TF, 3 cổng USB 3.0, LAN Gigabit.' },
        { id: 12, cat: 4, orig: 2990000, disc: 16, rate: 4.8, sold: 1100, flash: false, desc: 'Hệ thống loa 2 chiều âm bass uy lực, chuẩn chống nước bụi IP67, pin sử dụng liên tục 12 giờ.' },
        { id: 13, cat: 4, orig: 1450000, disc: 20, rate: 4.7, sold: 380, flash: false, desc: 'Mô hình thu âm Cardioid tập trung bắt trọn giọng nói, màng lọc pop filter lọc tạp âm thở.' },
        { id: 14, cat: 6, orig: 4600000, disc: 17, rate: 4.9, sold: 460, flash: false, desc: 'Tựa lưng cánh bướm ôm sát cột sống, lưới thoáng khí Hàn Quốc, kê tay 3D linh hoạt.' },
        { id: 15, cat: 6, orig: 8900000, disc: 15, rate: 4.9, sold: 210, flash: false, desc: 'Động cơ kép nâng hạ êm ái tải trọng 120kg, bộ điều khiển nhớ 4 vị trí chiều cao, cảm biến chống va chạm.' },
        { id: 16, cat: 10, orig: 180000, disc: 33, rate: 4.8, sold: 4800, flash: true, desc: 'Bề mặt vải dệt micro-weave siêu mịn rê chuột chuẩn xác, đáy cao su tự nhiên chống trượt.' },
        { id: 17, cat: 9, orig: 240000, disc: 25, rate: 4.6, sold: 890, flash: false, desc: 'Pin 4000mAh liên tục 8 tiếng, 4 chế độ gió êm ái dưới 20dB, xoay linh hoạt 120 độ.' },
        { id: 18, cat: 8, orig: 720000, disc: 23, rate: 4.8, sold: 2150, flash: false, desc: 'Dung lượng thực 20.000mAh Polymer, sạc nhanh PD 22.5W hai chiều, màn hình LED hiển thị % pin.' },
        { id: 19, cat: 2, orig: 290000, disc: 24, rate: 4.7, sold: 1400, flash: false, desc: 'Đệm mút bong bóng 360 độ chống va đập, vải Polyester chống thấm nước mưa, nhiều ngăn phụ tiện lợi.' },
        { id: 20, cat: 10, orig: 199000, disc: 50, rate: 4.9, sold: 3200, flash: true, desc: 'Sản phẩm đặc biệt phục vụ kiểm thử luồng Flash Sale chịu tải cao (k6). Giới hạn số lượng ít trong kho.' }
      ];

      for (const p of sampleProducts) {
        await pool.query(
          `UPDATE products
           SET category_id = $1, original_price = $2, discount_percent = $3,
               rating = $4, sold_count = $5, is_flash_sale = $6, description = $7
           WHERE id = $8`,
          [p.cat, p.orig, p.disc, p.rate, p.sold, p.flash, p.desc, p.id]
        );
      }

      await pool.query(`
        INSERT INTO products (id, name, slug, category_id, price, original_price, discount_percent, stock, rating, review_count, sold_count, is_flash_sale, description) VALUES
        (21, 'Điện thoại Flagship AuraPhone Pro 256GB', 'dien-thoai-flagship-auraphone-pro-256gb', 1, 18990000, 21990000, 13, 25, 4.9, 150, 890, false, 'Vi xử lý 4nm đỉnh cao, màn hình Dynamic AMOLED 120Hz mượt mà, camera 108MP chống rung OIS.'),
        (22, 'Áo Polo Nam AuraMall Classic Cotton', 'ao-polo-nam-auramall-classic-cotton', 2, 299000, 399000, 25, 120, 4.8, 340, 1850, true, 'Chất liệu 100% Cotton chải kỹ tự nhiên, thấm hút mồ hôi tối ưu, form Regular Fit tôn dáng.'),
        (23, 'Giày Sneaker AuraSport Pro Running (Hết hàng mẫu)', 'giay-sneaker-aurasport-pro-running', 2, 850000, 1100000, 22, 0, 4.7, 85, 520, false, 'Đế đệm khí êm ái, vải dệt Flyknit thoáng khí. Sản phẩm mẫu có stock = 0 để kiểm tra giao diện nhãn Hết hàng & nút vô hiệu hóa.'),
        (24, 'Đồng hồ thông minh AuraWatch Ultra', 'dong-ho-thong-minh-aurawatch-ultra', 1, 3450000, 4200000, 17, 18, 4.8, 95, 410, false, 'Khung titan siêu nhẹ, đo nhịp tim SpO2 liên tục 24/7, định vị GPS kép độc lập, chống nước 5ATM.')
        ON CONFLICT (id) DO NOTHING;
        SELECT setval('products_id_seq', (SELECT MAX(id) FROM products));
      `);
    }

    // 4. Gắn ảnh cho sản phẩm mẫu: CSDL cũ chưa có ảnh hoặc còn link Unsplash cũ (một số link đã hỏng)
    for (const [id, files] of Object.entries(SEED_PRODUCT_IMAGES)) {
      const images = files.map((file) => `/images/products/${file}`);
      await pool.query(
        `UPDATE products SET image_url = $1, thumbnails = $2
         WHERE id = $3 AND (image_url IS NULL OR image_url LIKE 'https://images.unsplash.com/%')`,
        [images[0], JSON.stringify(images), id]
      );
    }

    // 5. Tài khoản mẫu người bán & quản trị (mật khẩu Password123) cho CSDL tạo trước khi có phân quyền
    await pool.query(`
      INSERT INTO users (username, email, phone, password_hash, role, gender) VALUES
      ('auramall_seller', 'seller@auramall.vn', '0912345678', 'auramall_salt_seller:305af70b667dbdd263ecc65df505e3902410d1d4ce5aac12a655852709815cabe2a32746ddeeb67e3eaf8c635cb5bf69298e0146e7c77f96a3fa758ceb7c7483', 'seller', 'nu'),
      ('auramall_admin', 'admin@auramall.vn', '0987654321', 'auramall_salt_admin:46cf8fb666a4fe54dca9ca8eeb2bbef1690ab8eca207613665a5a068541488f2862e90e1949ea413495a37a6c5b5827040f630902a41a35d61f1e6ef5f95f1b1', 'admin', 'khac')
      ON CONFLICT DO NOTHING;

      UPDATE products SET seller_id = (SELECT id FROM users WHERE username = 'auramall_seller')
      WHERE id IN (21, 22, 23, 24) AND seller_id IS NULL;
    `);
    console.log('Đồng bộ và nạp dữ liệu mẫu AuraMall thành công!');
  } catch (err) {
    console.warn('Lưu ý autoMigrateDatabase:', err.message);
  }
}

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

function shutdown(signal) {
  console.log(`Nhận ${signal}, đang dừng backend...`);
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
