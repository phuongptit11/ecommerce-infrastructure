import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    login_20: { executor: 'constant-vus', vus: 20, duration: '20s', startTime: '0s', tags: { muc: 'Login_20VU' } },
    login_100: { executor: 'constant-vus', vus: 100, duration: '20s', startTime: '20s', tags: { muc: 'Login_100VU' } },
  },
  thresholds: {
    'http_req_duration{muc:Login_20VU}': ['p(95)<2000'],
    'http_req_duration{muc:Login_100VU}': ['p(95)<5000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://duytu205.id.vn';

export default function () {
  const payload = JSON.stringify({
    identifier: 'auramall_user',
    password: 'Password123',
  });
  const res = http.post(`${BASE_URL}/api/auth/login`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'Login phản hồi (200 hoặc 401)': (r) => r.status === 200 || r.status === 401 });
  sleep(0.5);
}
