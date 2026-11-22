import http from 'k6/http';
import { check, sleep } from 'k6';

// Không tính mã 400/409 (hết hàng) là lỗi sập server
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 400, 409));

export const options = {
  scenarios: {
    muc_1_20vu: {
      executor: 'ramping-vus',
      startTime: '0s',
      stages: [
        { duration: '10s', target: 20 },
        { duration: '20s', target: 20 },
      ],
      tags: { muc_tai: '1_20VU' },
    },
    muc_2_100vu: {
      executor: 'ramping-vus',
      startTime: '30s',
      stages: [
        { duration: '10s', target: 100 },
        { duration: '20s', target: 100 },
      ],
      tags: { muc_tai: '2_100VU' },
    },
    muc_3_300vu: {
      executor: 'ramping-vus',
      startTime: '60s',
      stages: [
        { duration: '10s', target: 300 },
        { duration: '20s', target: 300 },
        { duration: '10s', target: 0 },
      ],
      tags: { muc_tai: '3_300VU' },
    },
  },
  // Khai báo thresholds theo từng nhãn để k6 bắt buộc in bảng thông số tách riêng từng mức
  thresholds: {
    'http_req_duration{muc_tai:1_20VU}': ['p(95)<1500'],
    'http_req_failed{muc_tai:1_20VU}': ['rate<0.05'],

    'http_req_duration{muc_tai:2_100VU}': ['p(95)<1500'],
    'http_req_failed{muc_tai:2_100VU}': ['rate<0.05'],

    'http_req_duration{muc_tai:3_300VU}': ['p(95)<1500'],
    'http_req_failed{muc_tai:3_300VU}': ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://duytu205.id.vn';

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
    check(res, { 'POST status 201 hoặc 409': (r) => r.status === 201 || r.status === 409 || r.status === 400 });
  }

  sleep(Math.random() * 0.4 + 0.1);
}
