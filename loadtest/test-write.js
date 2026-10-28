import http from 'k6/http';
import { check, sleep } from 'k6';

// Tác vụ Ghi: POST /api/orders
// Có thể chạy theo 3 mức tùy biến bằng tham số lệnh:
//   Mức 1: k6 run --vus 20 --duration 30s loadtest/test-write.js
//   Mức 2: k6 run --vus 100 --duration 30s loadtest/test-write.js
//   Mức 3: k6 run --vus 300 --duration 30s loadtest/test-write.js

export const options = {
  stages: [
    { duration: '10s', target: 20 },   // Mức 1: 20 VU
    { duration: '20s', target: 20 },
    { duration: '10s', target: 100 },  // Mức 2: 100 VU
    { duration: '20s', target: 100 },
    { duration: '10s', target: 300 },  // Mức 3: 300 VU
    { duration: '20s', target: 300 },
    { duration: '10s', target: 0 },    // Hạ tải
  ],
  thresholds: {
    // Chỉ tính lỗi khi server trả về 5xx hoặc timeout
    // Mã 201 (Thành công) và 409 (Hết hàng) đều là phản hồi hợp lệ của nghiệp vụ
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost';

export default function () {
  // Chọn ngẫu nhiên sản phẩm từ 1 đến 19 (các sản phẩm có nhiều tồn kho trong seed.sql)
  const productId = Math.floor(Math.random() * 19) + 1;
  const payload = JSON.stringify({
    productId: productId,
    quantity: 1,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(`${BASE_URL}/api/orders`, payload, params);

  check(res, {
    'đặt hàng thành công (201) hoặc hết hàng (409)': (r) => r.status === 201 || r.status === 409,
    'thời gian phản hồi < 1000ms': (r) => r.timings.duration < 1000,
  });

  sleep(Math.random() * 0.4 + 0.1);
}
