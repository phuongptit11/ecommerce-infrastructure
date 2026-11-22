import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 80,
  duration: '5m', // Chạy bền bỉ trong 5 phút liên tục
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    http_req_failed: ['rate<0.01'], // Chạy lâu không được phát sinh lỗi rò rỉ kết nối
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://duytu205.id.vn';

export default function () {
  const res = http.get(`${BASE_URL}/api/products?page=1&limit=10`);
  check(res, { 'Ổn định 200 OK': (r) => r.status === 200 });
  sleep(0.5);
}
