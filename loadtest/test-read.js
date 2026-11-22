import http from 'k6/http';
import { check, sleep } from 'k6';

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
  thresholds: {
    'http_req_duration{muc_tai:1_20VU}': ['p(95)<1000'],
    'http_req_failed{muc_tai:1_20VU}': ['rate<0.05'],

    'http_req_duration{muc_tai:2_100VU}': ['p(95)<1000'],
    'http_req_failed{muc_tai:2_100VU}': ['rate<0.05'],

    'http_req_duration{muc_tai:3_300VU}': ['p(95)<1000'],
    'http_req_failed{muc_tai:3_300VU}': ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://duytu205.id.vn';

export default function () {
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

  sleep(Math.random() * 0.4 + 0.1);
}
