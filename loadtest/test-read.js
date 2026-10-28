import http from 'k6/http';
import { check, sleep } from 'k6';

// Tác vụ Đọc: GET /api/products
// Có thể chạy theo 3 mức tùy biến bằng tham số lệnh:
//   Mức 1: k6 run --vus 20 --duration 30s loadtest/test-read.js
//   Mức 2: k6 run --vus 100 --duration 30s loadtest/test-read.js
//   Mức 3: k6 run --vus 300 --duration 30s loadtest/test-read.js

export const options = {
  // Cấu hình mặc định nếu chạy lệnh `k6 run loadtest/test-read.js`:
  stages: [
    { duration: '10s', target: 20 },   // Mức 1: Tải nhẹ 20 VU
    { duration: '20s', target: 20 },
    { duration: '10s', target: 100 },  // Mức 2: Tải cao 100 VU
    { duration: '20s', target: 100 },
    { duration: '10s', target: 300 },  // Mức 3: Tải đột biến 300 VU
    { duration: '20s', target: 300 },
    { duration: '10s', target: 0 },    // Hạ tải
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],     // Tỷ lệ lỗi < 5%
    http_req_duration: ['p(95)<1000'],  // p95 < 1000ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost';

export default function () {
  // Random xem trang 1 hoặc trang 2 để giả lập người dùng thật
  const page = Math.floor(Math.random() * 2) + 1;
  const res = http.get(`${BASE_URL}/api/products?page=${page}&limit=10`);

  check(res, {
    'mã phản hồi là 200': (r) => r.status === 200,
    'có dữ liệu sản phẩm': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'success' && Array.isArray(body.data);
      } catch (e) {
        return false;
      }
    },
  });

  // Nghỉ ngẫu nhiên 0.1s - 0.5s giữa các lần gọi
  sleep(Math.random() * 0.4 + 0.1);
}
