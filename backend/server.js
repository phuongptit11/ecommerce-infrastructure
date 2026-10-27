'use strict';

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { Pool, types } = require('pg');

// Cột NUMERIC (giá tiền) và COUNT(*) mặc định được trả về dạng chuỗi, đổi sang Number để JSON trả về dạng số
types.setTypeParser(types.builtins.NUMERIC, parseFloat);
types.setTypeParser(types.builtins.INT8, Number);

const PORT = Number(process.env.PORT) || 5000;
const MAX_INT = 2147483647; // giới hạn kiểu INT của PostgreSQL
const MAX_PAGE = 100000;
const MAX_ORDER_QUANTITY = 100;
const PRODUCT_COLUMNS = 'id, name, price, stock, created_at';

// Connection pool: tái sử dụng kết nối thay vì mở mới cho mỗi request.
// Khi scale N bản sao backend, tổng kết nối là N x DB_POOL_MAX, phải nhỏ hơn max_connections (100) của PostgreSQL.
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

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Nhận số nguyên dạng number hoặc chuỗi chữ số (ô input của frontend gửi lên dạng chuỗi)
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

function validateOrder(body) {
  const { productId, quantity } = body ?? {};
  return {
    productId: parseId(productId, 'productId'),
    quantity: quantity === undefined ? 1 : parseInteger(quantity, 'quantity', 1, MAX_ORDER_QUANTITY),
  };
}

const app = express();

app.set('trust proxy', 1); // chạy sau Nginx: lấy IP thật của khách từ X-Forwarded-For
app.use(helmet());
// Log mỗi request kèm thời gian xử lý để giám sát; bỏ qua /health vì Docker gọi liên tục
app.use(morgan('short', { skip: (req) => req.path === '/health' }));
app.use(express.json({ limit: '10kb' }));

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

app.get('/api/products', async (req, res) => {
  const page = req.query.page === undefined ? 1 : parseInteger(req.query.page, 'page', 1, MAX_PAGE);
  const limit = req.query.limit === undefined ? 20 : parseInteger(req.query.limit, 'limit', 1, 100);

  const [items, count] = await Promise.all([
    pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY id LIMIT $1 OFFSET $2`, [limit, (page - 1) * limit]),
    pool.query('SELECT COUNT(*) AS total FROM products'),
  ]);
  const totalItems = count.rows[0].total;

  res.json({
    status: 'success',
    total: items.rowCount,
    data: items.rows,
    pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
  });
});

app.get('/api/products/:id', async (req, res) => {
  const id = parseId(req.params.id, 'id');
  const result = await pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`, [id]);
  if (result.rowCount === 0) {
    throw new HttpError(404, 'Không tìm thấy sản phẩm.');
  }
  res.json({ status: 'success', data: result.rows[0] });
});

app.post('/api/orders', async (req, res) => {
  const { productId, quantity } = validateOrder(req.body);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Trừ kho nguyên tử: chỉ thành công khi còn đủ hàng, dòng sản phẩm bị khóa đến khi COMMIT,
    // nên nhiều khách đặt cùng lúc cũng không bán vượt tồn kho.
    const updated = await client.query(
      'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id, name, price, stock',
      [quantity, productId]
    );
    if (updated.rowCount === 0) {
      const exists = await client.query('SELECT 1 FROM products WHERE id = $1', [productId]);
      throw exists.rowCount === 0
        ? new HttpError(404, 'Không tìm thấy sản phẩm.')
        : new HttpError(409, 'Sản phẩm đã hết hàng hoặc số lượng tồn kho không đủ để đáp ứng.');
    }

    const product = updated.rows[0];
    const inserted = await client.query(
      'INSERT INTO orders (product_id, quantity, total_price) VALUES ($1, $2, $3) RETURNING id, total_price, created_at',
      [productId, quantity, product.price * quantity]
    );

    await client.query('COMMIT');

    const order = inserted.rows[0];
    res.status(201).json({
      status: 'success',
      message: 'Tạo đơn hàng thành công!',
      orderId: order.id,
      product: { id: product.id, name: product.name, remainingStock: product.stock },
      quantity,
      totalPrice: order.total_price,
      createdAt: order.created_at,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

app.get('/api/orders', async (req, res) => {
  const result = await pool.query(
    `SELECT o.id, o.quantity, o.total_price, o.status, o.created_at, p.name AS product_name
     FROM orders o JOIN products p ON o.product_id = p.id
     ORDER BY o.id DESC LIMIT 20`
  );
  res.json({ status: 'success', total: result.rowCount, data: result.rows });
});

app.use((req, res) => {
  res.status(404).json({ status: 'fail', message: 'Không tìm thấy đường dẫn.' });
});

// Express 5 tự chuyển lỗi của handler async vào đây
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ status: 'fail', message: err.message });
  }
  // Lỗi từ express.json(): JSON sai cú pháp, body quá lớn...
  if (err.expose && err.status < 500) {
    return res.status(err.status).json({ status: 'fail', message: 'Dữ liệu gửi lên không hợp lệ.' });
  }
  console.error(err);
  res.status(500).json({ status: 'error', message: 'Lỗi máy chủ.' });
});

const server = app.listen(PORT, () => {
  console.log(`Backend đang chạy tại cổng ${PORT}`);
});

// Giữ kết nối lâu hơn keepalive của Nginx để tránh lỗi 502 khi Nginx tái sử dụng kết nối đã bị đóng
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Dừng êm khi Docker gửi SIGTERM (scale giảm, cập nhật): ngừng nhận request mới,
// xử lý xong request đang chạy rồi đóng pool
function shutdown(signal) {
  console.log(`Nhận ${signal}, đang dừng backend...`);
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

