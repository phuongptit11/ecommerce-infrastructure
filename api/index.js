// Bản deploy Vercel: chạy toàn bộ backend Express như một serverless function.
// vercel.json chuyển mọi request /api/* và /health về đây; giao diện (thư mục frontend) được phục vụ dạng tĩnh.
// Chạy bằng Docker thì không dùng file này (Nginx -> backend/server.js).
module.exports = require('../backend/server');
