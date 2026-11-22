import http from 'k6/http';
import { check, sleep } from 'k6';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 400, 409));

export const options = {
  scenarios: {
    truoc_flash_sale: {
      executor: 'ramping-vus',
      startTime: '0s',
      stages: [{ duration: '15s', target: 10 }],
      tags: { giai_doan: '1_Truoc_Shock_10VU' },
    },
    bung_no_flash_sale: {
      executor: 'ramping-vus',
      startTime: '15s',
      stages: [
        { duration: '3s', target: 400 },  // Tăng dựng đứng lên 400 VU trong 3 giây
        { duration: '20s', target: 400 }, // Giữ đỉnh 400 VU
        { duration: '5s', target: 10 },   // Rút đột ngột về 10 VU
      ],
      tags: { giai_doan: '2_Dinh_Shock_400VU' },
    },
    hoi_phuc_he_thong: {
      executor: 'ramping-vus',
      startTime: '43s',
      stages: [{ duration: '15s', target: 10 }],
      tags: { giai_doan: '3_Hoi_Phuc_10VU' },
    },
  },
  thresholds: {
    'http_req_duration{giai_doan:1_Truoc_Shock_10VU}': ['p(95)<1000'],
    'http_req_duration{giai_doan:2_Dinh_Shock_400VU}': ['p(95)<5000'],
    'http_req_duration{giai_doan:3_Hoi_Phuc_10VU}': ['p(95)<1000'], // Kiểm tra web có tự khỏe lại không
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://duytu205.id.vn';

export default function () {
  const productId = Math.floor(Math.random() * 5) + 1; // Dồn vào 5 món hot
  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({ productId, quantity: 1 }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'Không sập server (<500)': (r) => r.status < 500 });
  sleep(0.2);
}
