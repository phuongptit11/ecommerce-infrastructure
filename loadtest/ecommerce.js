import http from 'k6/http';
import { check, sleep } from 'k6';

// Kịch bản tổng hợp TMĐT Flash Sale: 80% Đọc danh mục, 20% Đặt hàng
export const options = {
  stages: [
    { duration: '10s', target: 20 },   // Mức 1: 20 VU (Bình thường)
    { duration: '20s', target: 20 },
    { duration: '10s', target: 100 },  // Mức 2: 100 VU (Cao điểm)
    { duration: '20s', target: 100 },
    { duration: '10s', target: 300 },  // Mức 3: 300 VU (Flash Sale quá tải)
    { duration: '20s', target: 300 },
    { duration: '10s', target: 0 },    // Hạ tải
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost';

export default function () {
  const rand = Math.random();

  if (rand < 0.8) {
    // 80% lưu lượng là ĐỌC danh mục sản phẩm
    const page = Math.floor(Math.random() * 2) + 1;
    const res = http.get(`${BASE_URL}/api/products?page=${page}&limit=10`);
    check(res, { 'GET status 200': (r) => r.status === 200 });
  } else {
    // 20% lưu lượng là GHI tạo đơn hàng
    const productId = Math.floor(Math.random() * 19) + 1;
    const payload = JSON.stringify({ productId, quantity: 1 });
    const params = { headers: { 'Content-Type': 'application/json' } };
    const res = http.post(`${BASE_URL}/api/orders`, payload, params);
    check(res, { 'POST status 201 hoặc 409': (r) => r.status === 201 || r.status === 409 });
  }

  sleep(Math.random() * 0.4 + 0.1);
}
