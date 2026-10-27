const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Cấu hình Connection Pool kết nối PostgreSQL trong mạng nội bộ
const pool = new Pool({
    host: process.env.DB_HOST || 'database',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'ecommerce_db',
    user: process.env.DB_USER || 'ecommerce_user',
    password: process.env.DB_PASSWORD || 'ecommerce_secret',
    max: 20, // Số kết nối tối đa trong Pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

app.use(cors());
app.use(express.json());

// Middleware ghi log request để phục vụ minh chứng nghiệm thu KT1
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// ==========================================
// 1. ENDPOINT KIỂM TRA SỨC KHỎE (HEALTH CHECK)
// ==========================================
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        return res.status(200).json({
            status: 'UP',
            timestamp: new Date().toISOString(),
            service: 'ecommerce-backend',
            database: 'CONNECTED'
        });
    } catch (error) {
        return res.status(503).json({
            status: 'DOWN',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// ==========================================
// 2. TÁC VỤ ĐỌC: LẤY DANH MỤC SẢN PHẨM (YC2, YC3, KT1)
// ==========================================
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, price, stock, created_at FROM products ORDER BY id ASC LIMIT 20;'
        );
        return res.status(200).json({
            status: 'success',
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('Lỗi truy vấn danh mục sản phẩm:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Lỗi truy vấn cơ sở dữ liệu'
        });
    }
});

// ==========================================
// 3. TÁC VỤ GHI: ĐẶT HÀNG & TRỪ KHO NGUYÊN TỬ (YC2, YC3, KT1)
// ==========================================
app.post('/api/orders', async (req, res) => {
    const { productId, quantity } = req.body;

    // Kiểm tra tính hợp lệ của tham số đầu vào
    const pId = parseInt(productId, 10);
    const qty = parseInt(quantity, 10) || 1;

    if (isNaN(pId) || pId <= 0 || qty <= 0) {
        return res.status(400).json({
status: 'fail',
            message: 'Mã sản phẩm (productId) hoặc số lượng (quantity) không hợp lệ.'
        });
    }

    const client = await pool.connect();
    try {
        // Mở Database Transaction nguyên tử (Atomic)
        await client.query('BEGIN');

        // BƯỚC 1: Trừ kho an toàn có điều kiện (Chống bán âm kho - Race condition)
        const updateResult = await client.query(
            'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id, name, price, stock;',
            [qty, pId]
        );

        // Nếu rows.length === 0 có nghĩa là sản phẩm không tồn tại hoặc không đủ hàng
        if (updateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                status: 'fail',
                message: 'Sản phẩm đã hết hàng hoặc số lượng tồn kho không đủ để đáp ứng.'
            });
        }

        const product = updateResult.rows[0];
        const totalPrice = Number(product.price) * qty;

        // BƯỚC 2: Ghi nhận đơn hàng vào bảng orders
        const insertOrderResult = await client.query(
            'INSERT INTO orders (product_id, quantity, total_price, status) VALUES ($1, $2, $3, $4) RETURNING id, created_at;',
            [pId, qty, totalPrice, 'CREATED']
        );

        // Hoàn tất Transaction
        await client.query('COMMIT');

        const order = insertOrderResult.rows[0];
        return res.status(201).json({
            status: 'success',
            message: 'Tạo đơn hàng thành công!',
            orderId: order.id,
            product: {
                id: product.id,
                name: product.name,
                remainingStock: product.stock
            },
            quantity: qty,
            totalPrice: totalPrice,
            createdAt: order.created_at
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Lỗi trong quá trình tạo đơn hàng:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Lỗi máy chủ khi xử lý đơn hàng.'
        });
    } finally {
        client.release();
    }
});

// ==========================================
// 4. API BỔ TRỢ: XEM DANH SÁCH ĐƠN HÀNG ĐÃ TẠO
// ==========================================
app.get('/api/orders', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT o.id, o.quantity, o.total_price, o.status, o.created_at, p.name AS product_name ' +
            'FROM orders o JOIN products p ON o.product_id = p.id ' +
            'ORDER BY o.id DESC LIMIT 20;'
        );
        return res.status(200).json({
            status: 'success',
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
return res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(port, () => {
    console.log(`Backend Server đang chạy tại cổng ${port}`);
});