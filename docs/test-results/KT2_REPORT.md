# BÁO CÁO KẾT QUẢ KIỂM THỬ CHỊU TẢI KT2 (YÊU CẦU 3)
## HỆ THỐNG THƯƠNG MẠI ĐIỆN TỬ AURAMALL - ĐỀ TÀI 07

- **Môn học / Học phần:** Thiết kế và Triển khai Hạ tầng CNTT cho Hệ thống TMĐT
- **Mô hình kiến trúc kiểm thử:** 3 tầng phân vùng mạng độc lập
  - **Tầng 1 (Web Tier):** Nginx 1.28 Alpine (Cổng 80)
  - **Tầng 2 (App Tier):** Node.js 22 Express 5 (Cổng 5000 nội bộ)
  - **Tầng 3 (Data Tier):** PostgreSQL 15 Alpine (Cổng 5432 nội bộ)
- **Công cụ kiểm thử tải:** Grafana k6 v2.2.0
- **Thời gian thực hiện đo đạc:** 04/11/2026

---

## 1. MỤC TIÊU & KẾ HOẠCH KIỂM THỬ (KT2)

Thực hiện kiểm thử hiệu năng chịu tải hệ thống TMĐT theo kế hoạch đã soạn, bao gồm:
1. **Ít nhất 3 mức tải** tương ứng với các tình huống thực tế:
   - **Mức 1 (Tải nhẹ / Bình thường):** 20 VU (Virtual Users)
   - **Mức 2 (Tải cao / Giờ cao điểm):** 100 VU
   - **Mức 3 (Tải đột biến / Flash Sale quá tải):** 300 VU
2. **Thực thi trên cả 2 tác vụ cốt lõi:**
   - **Tác vụ Đọc:** `GET /api/products?page=...&limit=10` (Kịch bản [loadtest/test-read.js](../../loadtest/test-read.js))
   - **Tác vụ Ghi:** `POST /api/orders` với body `{"productId": X, "quantity": 1}` (Kịch bản [loadtest/test-write.js](../../loadtest/test-write.js))
3. **Kịch bản tổng hợp TMĐT Flash Sale:** Tỷ lệ 80% Đọc danh mục và 20% Ghi đặt hàng tăng dần qua các stages trong 100s ([loadtest/ecommerce.js](../../loadtest/ecommerce.js)).
4. **Ghi nhận đầy đủ 4 nhóm chỉ số:**
   - Thời gian đáp ứng (Response Time: Avg, Min, Med, p90, p95, Max).
   - Tỷ lệ lỗi (Error Rate & Check Success Rate).
   - Thông lượng (Throughput: req/s, total requests, network I/O).
   - Mức tiêu thụ tài nguyên máy chủ (CPU %, RAM MB qua `docker stats`).

---

## 2. BẢNG TỔNG HỢP SỐ LIỆU ĐO ĐẠC THỰC TẾ

### 2.1. Tác vụ ĐỌC: `GET /api/products` (Thời gian: 30s/mức)

| Chỉ số đo đạc | Mức 1 (20 VUs) | Mức 2 (100 VUs) | Mức 3 (300 VUs) | Tiêu chí đánh giá (Threshold) |
| :--- | :---: | :---: | :---: | :---: |
| **Tổng số Request (HTTP Req)** | **1.929** req | **8.860** req | **10.191** req | Khả năng phục vụ cao |
| **Thông lượng (Throughput)** | **63,66** req/s | **290,28** req/s | **329,40** req/s | Tăng trưởng theo mức tải |
| **Tỷ lệ thành công (Checks)** | **100,00%** | **100,00%** | **99,11%** | Đạt yêu cầu nghiệp vụ |
| **Tỷ lệ lỗi (Error Rate)** | **0,00%** (0/1.929) | **0,00%** (0/8.860) | **0,89%** (91/10.191) | **< 5,00% (ĐẠT)** |
| **Thời gian phản hồi Trung bình (Avg)** | **12,22 ms** | **36,72 ms** | **598,39 ms** | Rất nhanh ở mức 1 & 2 |
| **Thời gian Trung vị (Median)** | **10,05 ms** | **25,81 ms** | **567,02 ms** | Ổn định |
| **Thời gian p(90)** | **14,59 ms** | **71,70 ms** | **797,10 ms** | 90% dưới 800ms |
| **Thời gian p(95)** | **18,59 ms** | **93,40 ms** | **848,80 ms** | **< 1.000 ms (ĐẠT)** |
| **Lưu lượng mạng nhận (Data Received)**| 14,9 MB (492 kB/s)| 68,5 MB (2,24 MB/s)| 78,1 MB (2,52 MB/s)| Băng thông lớn |

---

### 2.2. Tác vụ GHI: `POST /api/orders` (Thời gian: 30s/mức)
*(Mỗi request thực thi đầy đủ Transaction CSDL: Khóa dòng `SELECT FOR UPDATE`, trừ kho nguyên tử, ghi nhận đơn hàng và bảng chi tiết).*

| Chỉ số đo đạc | Mức 1 (20 VUs) | Mức 2 (100 VUs) | Mức 3 (300 VUs) | Tiêu chí đánh giá (Threshold) |
| :--- | :---: | :---: | :---: | :---: |
| **Tổng số Đơn đặt (Orders Created)** | **1.928** đơn | **8.683** đơn | **10.419** đơn | Ghi nhận CSDL liên tục |
| **Tổng số Request (HTTP Req)** | **1.928** req | **8.683** req | **10.508** req | Chống quá tải tốt |
| **Thông lượng (Throughput)** | **63,36** req/s | **285,01** req/s | **340,88** req/s | Năng lực xử lý ghi cao |
| **Tỷ lệ thành công (Checks)** | **100,00%** | **100,00%** | **99,00%** | Giao dịch ACID chuẩn xác |
| **Tỷ lệ lỗi (Error Rate)** | **0,00%** (0/1.928) | **0,00%** (0/8.683) | **0,84%** (89/10.508) | **< 5,00% (ĐẠT)** |
| **Thời gian phản hồi Trung bình (Avg)** | **13,09 ms** | **46,10 ms** | **570,09 ms** | Rất nhanh ở mức 1 & 2 |
| **Thời gian Trung vị (Median)** | **11,43 ms** | **28,44 ms** | **541,12 ms** | Độ trễ thấp |
| **Thời gian p(90)** | **17,29 ms** | **100,84 ms** | **761,55 ms** | Phản hồi mượt mà |
| **Thời gian p(95)** | **21,78 ms** | **133,11 ms** | **809,05 ms** | **< 1.500 ms (ĐẠT)** |
| **Lưu lượng dữ liệu nhận (Received)** | 2,92 MB (96 kB/s) | 13,1 MB (432 kB/s)| 15,8 MB (512 kB/s)| Tối ưu JSON payload |

---

### 2.3. Kịch bản tổng hợp TMĐT Flash Sale (`ecommerce.js` - 80% Đọc, 20% Ghi)
- **Thời lượng:** 100 giây (Ramp-up 20 VUs $\rightarrow$ 100 VUs $\rightarrow$ 300 VUs $\rightarrow$ Ramp-down).
- **Tổng số Request xử lý:** **21.055 requests** (Bao gồm 16.974 lượt Đọc và 4.081 lượt Đặt hàng).
- **Thông lượng trung bình:** **210,16 requests/giây**.
- **Tỷ lệ lỗi:** **0,00%** (0 lỗi trên 21.055 requests).
- **Tỷ lệ kiểm tra thành công (Checks Passed):** **100,00%** (21.055 / 21.055 checks).
- **Thời gian phản hồi trung bình (Avg Duration):** **301,80 ms**.
- **Thời gian phản hồi trung vị (Median):** **80,04 ms**.
- **Thời gian phản hồi p(90):** **880,21 ms**.
- **Thời gian phản hồi p(95):** **973,01 ms** (Thỏa mãn ngưỡng `< 1500ms`).
- **Tổng dung lượng mạng:** **138 MB** dữ liệu nhận (1,4 MB/s).

---

### 2.4. Mức tiêu thụ tài nguyên phần cứng (Resource Utilization qua `docker stats`)

| Container / Dịch vụ | Giai đoạn Nhàn rỗi (Idle) | Mức 1: 20 VUs (CPU / RAM) | Mức 2: 100 VUs (CPU / RAM) | Mức 3: 300 VUs (CPU / RAM) |
| :--- | :---: | :---: | :---: | :---: |
| **`ecommerce_nginx`** *(Web Tier)* | 0,00% / 28,5 MB | **3,97% - 5,07%** / 29,3 MB | **17,89% - 20,61%** / 29,5 MB | **19,70% - 23,96%** / 34,1 MB |
| **`ecommerce-backend-1`** *(App Tier)* | 0,01% / 26,8 MB | **27,56% - 29,66%** / 55,9 MB | **88,10% - 103,42%** / 79,8 MB | **105,18% - 106,29%** / 106,7 MB |
| **`ecommerce_database`** *(Data Tier)* | 0,01% / 40,0 MB | **18,14% - 22,88%** / 58,1 MB | **81,09% - 85,00%** / 62,6 MB | **100,18% - 113,93%** / 66,8 MB |

---

## 3. PHÂN TÍCH VÀ ĐÁNH GIÁ CHUYÊN SÂU HIỆU NĂNG HẠ TẦNG

### 3.1. Đánh giá Tầng 1: Web Tier (Nginx Reverse Proxy)
- **Tiêu thụ tài nguyên rất thấp:** Nginx chỉ chiếm từ 3% đến tối đa 24% CPU và khoảng 34 MB RAM ngay cả khi chịu tải 300 VUs.
- **Vai trò tối ưu hóa:** 
  - Đóng vai trò làm đệm kết nối (Reverse proxy buffer), nén `gzip` phản hồi JSON giúp tiết kiệm băng thông mạng.
  - Phục vụ tĩnh giao diện web SPA cực nhanh mà không làm phiền tài nguyên backend.
  - Cơ chế Connection Keep-Alive hoạt động hiệu quả, tái sử dụng kết nối liên tục với backend.

### 3.2. Đánh giá Tầng 2: App Tier (Node.js Express API)
- **Hiệu năng xuất sắc ở tải nhẹ và vừa (20 - 100 VUs):** Thời gian phản hồi chỉ từ **12ms đến 46ms**, thông lượng đạt gần 300 req/s với tỷ lệ lỗi tuyệt đối bằng **0,00%**.
- **Điểm nghẽn tài nguyên (Bottleneck) ở tải đột biến (300 VUs):**
  - Khi tải tăng lên 300 VUs, CPU của container `ecommerce-backend-1` chạm ngưỡng 105% (bão hòa 1 CPU core của Node.js Event Loop).
  - Thời gian xử lý p(95) tăng lên khoảng 809ms - 848ms, xuất hiện ~0,8% timeout do hàng đợi kết nối phải chờ Event Loop giải phóng.
  - Bộ nhớ RAM tiêu thụ của Node.js giữ ở mức rất an toàn (~106 MB), không xảy ra hiện tượng Memory Leak.

### 3.3. Đánh giá Tầng 3: Data Tier (PostgreSQL 15)
- **Tính toàn vẹn dữ liệu (ACID):**
  - Trong suốt quá trình kiểm thử tải ghi với hơn 20.000 đơn hàng được tạo liên tục, CSDL duy trì 100% tính toàn vẹn dữ liệu, không có bất kỳ đơn hàng nào bị ghi đè hoặc bán âm kho hàng (nhờ cơ chế khóa dòng nguyên tử `stock = stock - 1 WHERE stock >= 1`).
  - Connection Pool của backend (mặc định max 10 kết nối) giúp PostgreSQL không bị cạn kiệt `max_connections` (mặc định 100 của PostgreSQL).
  - CPU của PostgreSQL tăng tương ứng từ 20% (mức 1) lên ~85% (mức 2) và chạm 113% (mức 3) khi phải xử lý liên tục các Transaction ghi đĩa (WAL Logs).

---

## 4. GIẢI PHÁP MỞ RỘNG QUY MÔ HẠ TẦNG (SCALE-OUT)

Dựa trên kết quả đo đạc thực tế, điểm nghẽn chính khi tải đạt 300 VUs là CPU của bản sao backend duy nhất. Kiến trúc hạ tầng đề tài đã được thiết kế sẵn sàng cho việc mở rộng tải ngang (Horizontal Pod / Container Autoscaling):

1. **Mở rộng backend lên 3 bản sao bằng 1 dòng lệnh:**
   ```bash
   docker compose up -d --scale backend=3
   ```
2. **Cơ chế cân bằng tải tự động của Nginx:**
   - File cấu hình `nginx/nginx.conf` đã sử dụng `upstream backend_nodes` kết hợp cơ chế DNS nội bộ Docker (`resolver 127.0.0.11 valid=10s`) để tự động chia tải Round-Robin giữa 3 container backend.
   - Khi đó, thông lượng hệ thống có thể tăng gấp 2,5 - 3 lần (đạt ~800 - 1.000 req/s), đồng thời hạ CPU của mỗi container backend xuống dưới 40% ở mức 300 VUs.

---

## 5. KẾT LUẬN NGHIỆM THU KIỂM THỬ KT2

| Tiêu chí nghiệm thu | Yêu cầu đề bài | Kết quả thực tế đạt được | Kết luận |
| :--- | :---: | :---: | :---: |
| **Số mức tải kiểm thử** | Ít nhất 3 mức | **3 mức đầy đủ:** 20 VUs, 100 VUs, 300 VUs | **ĐẠT CHUẨN** |
| **Tác vụ kiểm thử** | 1 Đọc + 1 Ghi | **1 Đọc (`GET`) + 1 Ghi (`POST`) + 1 Tổng hợp (80/20)** | **ĐẠT CHUẨN** |
| **Tỷ lệ lỗi (Error Rate)** | `< 5%` | **0,00% - 0,89%** | **VƯỢT CHỈ TIÊU** |
| **Thời gian phản hồi p(95) Đọc** | `< 1.000 ms` | **18,59 ms - 848,80 ms** | **ĐẠT CHUẨN** |
| **Thời gian phản hồi p(95) Ghi** | `< 1.500 ms` | **21,78 ms - 809,05 ms** | **ĐẠT CHUẨN** |
| **Ghi nhận tài nguyên** | CPU, RAM máy chủ | **Có đầy đủ số liệu `docker stats` từng giai đoạn** | **ĐẠT CHUẨN** |
| **Lưu trữ kết quả kiểm thử** | Lưu báo cáo & log | **Đầy đủ 12 tệp JSON/TXT trong `docs/test-results/`** | **HOÀN THÀNH** |

> **Toàn bộ hệ thống hạ tầng TMĐT AuraMall đáp ứng đầy đủ và xuất sắc các yêu cầu kỹ thuật của bài Kiểm thử KT2 (Yêu cầu 3).**
