import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    step_100: { executor: 'constant-vus', vus: 100, duration: '15s', startTime: '0s', tags: { muc: '100_VU' } },
    step_200: { executor: 'constant-vus', vus: 200, duration: '15s', startTime: '15s', tags: { muc: '200_VU' } },
    step_400: { executor: 'constant-vus', vus: 400, duration: '15s', startTime: '30s', tags: { muc: '400_VU' } },
    step_600: { executor: 'constant-vus', vus: 600, duration: '15s', startTime: '45s', tags: { muc: '600_VU' } },
  },
  thresholds: {
    'http_req_failed{muc:100_VU}': ['rate<0.05'],
    'http_req_failed{muc:200_VU}': ['rate<0.05'],
    'http_req_failed{muc:400_VU}': ['rate<0.05'],
    'http_req_failed{muc:600_VU}': ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://duytu205.id.vn';

export default function () {
  const res = http.get(`${BASE_URL}/api/products?page=1&limit=10`);
  check(res, { 'Status 200': (r) => r.status === 200 });
  sleep(0.3);
}
