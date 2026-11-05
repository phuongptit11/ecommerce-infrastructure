-- ========================================================
-- THIẾT KẾ CƠ SỞ DỮ LIỆU HỆ THỐNG TMĐT AURAMALL (ĐỀ TÀI 07)
-- Mô hình phân vùng mạng 3 tầng: Nginx -> Node.js -> PostgreSQL
-- ========================================================

-- 1. Bảng danh mục sản phẩm (categories)
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    icon VARCHAR(50) DEFAULT '📦',
    display_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng người dùng (users)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL, -- tài khoản tạo bằng Google để trống, bổ sung trong hồ sơ
    password_hash VARCHAR(255), -- NULL: tài khoản chỉ đăng nhập bằng Google, chưa đặt mật khẩu
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'seller', 'user')), -- phân quyền
    google_sub VARCHAR(255) UNIQUE, -- mã tài khoản Google đã liên kết
    gender VARCHAR(10) DEFAULT 'other', -- nam, nu, khac
    birthday DATE,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bảng sổ địa chỉ nhận hàng (user_addresses)
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

-- 4. Bảng sản phẩm (products)
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    original_price NUMERIC(12, 2) CHECK (original_price >= 0),
    discount_percent INT DEFAULT 0,
    stock INT NOT NULL CHECK (stock >= 0),
    rating NUMERIC(2, 1) DEFAULT 5.0,
    review_count INT DEFAULT 0,
    sold_count INT DEFAULT 0,
    is_flash_sale BOOLEAN DEFAULT FALSE,
    image_url TEXT,
    thumbnails JSONB DEFAULT '[]'::jsonb,
    description TEXT,
    seller_id INT REFERENCES users(id) ON DELETE SET NULL, -- người đăng bán; NULL = hàng của AuraMall
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Bảng đơn hàng (orders)
-- Lưu ý: Giữ lại product_id để tương thích ngược 100% với k6 loadtest (ecommerce.js, test-write.js)
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_code VARCHAR(50) UNIQUE,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    product_id INT REFERENCES products(id),
    quantity INT NOT NULL CHECK (quantity > 0),
    total_price NUMERIC(12, 2) NOT NULL CHECK (total_price >= 0),
    shipping_fee NUMERIC(12, 2) DEFAULT 0 CHECK (shipping_fee >= 0),
    final_total NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (final_total >= 0),
    recipient_name VARCHAR(100),
    recipient_phone VARCHAR(20),
    shipping_address TEXT,
    payment_method VARCHAR(50) DEFAULT 'COD', -- 'COD' hoặc 'BANK_TRANSFER'
    buyer_note TEXT,
    status VARCHAR(50) DEFAULT 'CREATED', -- 'CREATED', 'CONFIRMED', 'DELIVERING', 'COMPLETED', 'CANCELLED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Bảng chi tiết đơn hàng (order_items)
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

-- Tối ưu hóa chỉ mục (Indexes) theo tiêu chuẩn hiệu năng hạ tầng TMĐT
CREATE INDEX IF NOT EXISTS idx_products_id ON products(id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_rating ON products(rating);
CREATE INDEX IF NOT EXISTS idx_products_sold_count ON products(sold_count);
CREATE INDEX IF NOT EXISTS idx_products_flash_sale ON products(is_flash_sale);
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products(seller_id);

CREATE INDEX IF NOT EXISTS idx_orders_product_id ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON user_addresses(user_id);
