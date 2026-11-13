// Khởi tạo CSDL PostgreSQL trên mây (Neon / Vercel Postgres...) cho bản deploy Vercel. Chạy 1 lần từ máy:
//   cd backend && npm ci && cd ..
//   DATABASE_URL="postgres://user:pass@host/db?sslmode=require" node scripts/init-cloud-db.js
// CSDL còn trống: chạy database/schema.sql + seed.sql (sản phẩm và 3 tài khoản mẫu).
// CSDL đã có dữ liệu: chỉ nâng cấp cấu trúc (autoMigrateDatabase), không ghi đè dữ liệu.
'use strict';

const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  console.error('Thiếu DATABASE_URL. Ví dụ:');
  console.error('  DATABASE_URL="postgres://user:pass@host/db?sslmode=require" node scripts/init-cloud-db.js');
  process.exit(1);
}

// Chỉ nạp app (không mở cổng) để dùng chung pool và hàm nâng cấp CSDL với backend
const { pool, autoMigrateDatabase } = require('../backend/server');

async function main() {
  const { rows } = await pool.query(`SELECT to_regclass('public.users') IS NOT NULL AS ready`);
  if (rows[0].ready) {
    console.log('CSDL đã có dữ liệu: bỏ qua schema/seed, chỉ nâng cấp cấu trúc.');
  } else {
    for (const file of ['schema.sql', 'seed.sql']) {
      console.log(`Đang chạy database/${file}...`);
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'database', file), 'utf8'));
    }
  }
  await autoMigrateDatabase();
  const users = await pool.query('SELECT COUNT(*) AS total FROM users');
  const products = await pool.query('SELECT COUNT(*) AS total FROM products');
  console.log(`Xong: ${users.rows[0].total} tài khoản, ${products.rows[0].total} sản phẩm.`);
}

main()
  .catch((err) => {
    console.error('Lỗi khởi tạo CSDL:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
