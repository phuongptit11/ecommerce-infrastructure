# HỆ THỐNG HẠ TẦNG THƯƠNG MẠI ĐIỆN TỬ AURAMALL
## ĐỀ TÀI 07: THIẾT KẾ & TRIỂN KHAI HẠ TẦNG CNTT CHO HỆ THỐNG TMĐT

### DANH SÁCH THÀNH VIÊN NHÓM THỰC HIỆN

| STT | Họ và tên | Mã sinh viên | Vai trò |
| :---: | :--- | :---: | :--- |
| 1 | Nguyễn Minh Phương | B24DCCC231 | Thiết kế các tầng và kịch bản tải. |
| 2 | Nguyễn Duy Tư | B24DCCC275 | Triển khai Web/ứng dụng. |
| 3 | Mạc Đức Dương | B24DCCC087 | Cấu hình kho dữ liệu và sao lưu. |
| 4 | Nguyễn Đức Dũng | B24DCCC081 | Đo tải, cải tiến và so sánh. |

---

Hệ thống mô phỏng kiến trúc hạ tầng TMĐT phân vùng mạng 3 tầng chuyên nghiệp, đáp ứng các tiêu chuẩn bảo mật, phân quyền nghiêm ngặt (3 Roles RBAC), cân bằng tải tự động, đa dạng phương thức triển khai (Local Docker, Cloudflare Tunnel, Render Cloud) và đã sẵn sàng kịch bản kiểm thử tải (k6 load testing) cùng quy trình sao lưu - phục hồi dữ liệu:

* **Tầng 1 (Web Tier):** Nginx Reverse Proxy 1.28 & Static Web SPA (Public Subnet - Cổng 80)
* **Tầng 2 (App Tier):** Node.js 22 Express 5 API Cluster (Private Subnet - Cổng 5000 nội bộ)
* **Tầng 3 (Data Tier):** PostgreSQL 15 Database (Private Subnet - Cổng 5432 nội bộ)

---

## 1. PHIÊN BẢN PHẦN MỀM & CÔNG NGHỆ SỬ DỤNG

| Thành phần | Công nghệ / Nền tảng | Phiên bản | Vai trò & Mô tả kỹ thuật |
| :--- | :--- | :---: | :--- |
| **Web Server / Gateway** | Nginx | `1.28-alpine` | Reverse proxy, cân bằng tải round-robin, serving Web SPA tĩnh, chặn truy cập trái phép cổng nội bộ. |
| **Môi trường Runtime** | Node.js | `22-alpine` (LTS) | Môi trường thực thi JavaScript bất đồng bộ hiệu năng cao cho ứng dụng Backend. |
| **Web Framework** | Express.js | `^5.3.0` | Xây dựng RESTful API, quản lý routing và middleware phân quyền RBAC. |
| **Hệ quản trị CSDL** | PostgreSQL | `15-alpine` | CSDL quan hệ lưu trữ dữ liệu ACID, quan hệ 8 bảng, transaction xử lý đặt hàng chống race condition. |
| **Database Driver** | `pg` (node-postgres) | `^8.23.1` | Quản lý Connection Pool kết nối CSDL hiệu năng cao với `DB_POOL_MAX=10`. |
| **Bảo mật & Mã hóa** | `helmet`, `bcryptjs`, `crypto` | Mới nhất | Bảo vệ HTTP headers, băm mật khẩu chuẩn Salted BCrypt, xác thực JWT & Google OAuth. |
| **Dịch vụ Email** | `nodemailer` | `10.3.1` | Gửi email khôi phục mật khẩu qua Gmail API / SMTP / Brevo API. |
| **Tài liệu API** | Swagger UI Express | `^5.0.1` | Tự động sinh giao diện tài liệu OpenAPI tương tác tại `/api/docs/`. |
| **Ảo hóa & Đóng gói** | Docker Engine & Docker Compose | `Docker 24+` / `Compose v2` | Cô lập mạng (`public_net`, `private_net`), quản lý volume, scale-out service. |
| **Kiểm thử hiệu năng** | Grafana k6 | `v0.50+` | Đo tải 3 mức (20 VUs, 100 VUs, 200 VUs) với tác vụ Đọc danh mục và Ghi đơn hàng. |
| **Hạ tầng Mạng Cloud** | Cloudflare Tunnel (`cloudflared`) | `2025.11.1` | Kết nối tunnel bảo mật ra Internet qua tên miền riêng kèm SSL/TLS 1.3 miễn phí. |
| **Nền tảng Cloud 24/7** | Render Cloud | Singapore Region | Web Service và Managed PostgreSQL Cloud phục vụ website hoạt động liên tục 24/7. |

---

## 2. HƯỚNG DẪN KHỞI CHẠY VÀ TRIỂN KHAI HỆ THỐNG

Hệ thống hỗ trợ 2 phương án triển khai linh hoạt:

### Phương án 1: Chạy Local 3 Tầng bằng Docker Compose (Khuyên dùng cho học tập & bảo vệ đồ án)

Đảm bảo **Docker Desktop** đang chạy, mở Terminal / PowerShell tại thư mục dự án và gõ:

```bash
docker compose up -d --build
```
> **Lưu ý:** Luôn thêm cờ `--build` để Docker đóng gói mã nguồn backend mới nhất (bao gồm xác thực Google OAuth, gửi email Nodemailer, upload ảnh CSDL và phân quyền 3 vai trò).

* **Trang web người dùng:** [http://localhost](http://localhost) (hoặc `http://localhost:8080` nếu đổi cổng)
* **Tài liệu API tương tác (Swagger UI):** [http://localhost/api/docs/](http://localhost/api/docs/)
* **Kiểm tra trạng thái các container:**
  ```bash
  docker compose ps
  ```
  *(Cần thấy `ecommerce_nginx`, `ecommerce-backend-1`, `ecommerce_database` đều ở trạng thái `Up / healthy`)*
* **Xem log ứng dụng theo thời gian thực:**
  ```bash
  docker compose logs -f backend
  ```
* **Mở rộng quy mô backend (Horizontal Scaling - Cân bằng tải qua Nginx):**
  ```bash
  docker compose up -d --scale backend=3
  ```
* **Dừng hệ thống:**
  ```bash
  docker compose down
  ```
  *(Thêm cờ `-v` nếu muốn xóa sạch volume cũ để CSDL tự động nạp lại bảng dữ liệu mẫu: `docker compose down -v`)*

---

### Phương án 2: Đưa web ra Internet bằng Tên miền riêng qua Cloudflare Tunnel kết hợp Render chạy 24/7

Phương án này giúp website hoạt động trực tuyến 24/7 với **HTTPS có chứng chỉ SSL chính thức**, **không cần bật máy tính cá nhân**, không cần IP tĩnh hay mở cổng modem/router:

> 🌐 **Truy cập trực tiếp bản triển khai hoàn chỉnh của nhóm:**  
> Hiện tại nhóm chỉ cần truy cập vào bản triển khai hoàn chỉnh qua website sau là có thể thao tác và kiểm thử đầy đủ mọi tính năng 24/7:  
> **👉 [https://duytu205.id.vn](https://duytu205.id.vn)** *(Tên miền riêng chính thức của dự án)*

**Cơ chế hoạt động:**
1. **Cloudflare Tunnel & DNS Edge:** Tên miền `duytu205.id.vn` được ủy quyền qua Cloudflare DNS, thiết lập SSL/TLS Full/Strict và kết nối bảo mật Edge CDN giúp tăng tốc truy cập toàn cầu.
2. **Hạ tầng Cloud 24/7:**
   - Dịch vụ Web Service và Database PostgreSQL được vận hành trên hạ tầng đám mây (Render Cloud - Region Singapore) thông qua cấu hình [render.yaml](render.yaml).
   - Tệp [scripts/init-cloud-db.js](scripts/init-cloud-db.js) tự động khởi tạo cấu trúc 8 bảng (`schema.sql`) và dữ liệu mẫu (`seed.sql`).
3. **Khi cần chạy Tunnel trực tiếp từ máy cục bộ (Tùy chọn):**
   - Lấy token tại Cloudflare Dashboard $\rightarrow$ **Networks** $\rightarrow$ **Tunnels** $\rightarrow$ Dán vào `.env`:
     ```env
     CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
     ```
   - Khởi chạy tunnel bằng Docker Compose:
     ```bash
     docker compose --profile tunnel up -d
     ```
   - Container `cloudflared` sẽ tự động thiết lập đường hầm mã hóa và định tuyến yêu cầu từ `https://duytu205.id.vn` vào cổng 80 của `ecommerce_nginx`.

---

## 3. CẤU HÌNH DỊCH VỤ MỞ RỘNG (TÙY CHỌN)

### 1. Đăng nhập bằng Google (Google Identity Services)
1. Truy cập [Google Cloud Console](https://console.cloud.google.com/auth/clients) $\rightarrow$ **Google Auth Platform** $\rightarrow$ **Clients** $\rightarrow$ **Create client** (Loại: Web application).
2. **Authorized JavaScript origins**: Thêm `http://localhost`, `http://localhost:8080` và tên miền `https://duytu205.id.vn`.
3. Sao chép Client ID vào file `.env`:
   ```env
   GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
   ```
4. Để tài khoản Google bất kỳ đăng nhập được: Tab **Audience** $\rightarrow$ Bấm **Publish app** (kèm link chính sách `https://<domain>/privacy.html`).

*(Nếu chưa cấu hình `GOOGLE_CLIENT_ID`, bạn cứ để trống trong `.env`. Hệ thống sẽ tắt nút Google và dùng đăng nhập truyền thống, không ảnh hưởng các chức năng khác).*

### 2. Gửi Email Quên Mật Khẩu (Gmail API / SMTP / Brevo API)
Chức năng Quên mật khẩu gửi liên kết đặt lại qua email, có hiệu lực 30 phút và chỉ sử dụng được 1 lần.
Kiểm tra cấu hình: mở `/health` xem trường `email` (`gmail` / `brevo` / `smtp` / `log` = chưa cấu hình), hoặc đăng nhập admin → **Quản trị → Tổng quan → Gửi email thử**.

- **Gmail API (khuyên dùng, chạy được cả trên Render gói Free):** gửi bằng chính hộp thư Gmail qua HTTPS.
  1. [Google Cloud Console](https://console.cloud.google.com/apis/library/gmail.googleapis.com) → chọn đúng project → **Gmail API** → **Enable**.
  2. **Google Auth Platform → Audience**: ứng dụng phải ở trạng thái **In production** (ở chế độ Testing, refresh token hết hạn sau 7 ngày).
  3. **Google Auth Platform → Clients → Create client** → Application type **Desktop app** → **Create** → **Download JSON**.
  4. Trong thư mục dự án chạy `node scripts/gmail-auth.js <file client_secret_xxx.json>` → trình duyệt mở ra → đăng nhập Gmail dùng để gửi → nếu Google báo chưa xác minh: **Advanced → Go to ...** → **Allow**. Script tự ghi `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `MAIL_FROM` vào `.env` và gửi thử 1 email.
  5. Docker: `docker compose up -d`. Render: service → **Environment** → thêm 4 biến trên (lấy giá trị trong `.env`) → **Save**.
- **Chạy Local (Gmail SMTP):** Khai báo vào file `.env`:
  ```env
  APP_URL=http://localhost
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USER=your_email@gmail.com
  SMTP_PASS=xxxx_xxxx_xxxx_xxxx   # Mật khẩu ứng dụng 16 ký tự của Google
  MAIL_FROM="AuraMall Support <your_email@gmail.com>"
  ```
- **Chạy trên Cloud Render (Brevo API):** Vì các dịch vụ Cloud miễn phí chặn cổng SMTP 587, cấu hình dùng Brevo API Key:
  ```env
  BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  MAIL_FROM="AuraMall <your_email@gmail.com>"
  ```
*(Nếu chưa cấu hình email, hệ thống sẽ tự động in liên kết đặt lại mật khẩu ra log backend: `docker compose logs backend | grep reset-password`).*

---

## 4. MA TRẬN PHÂN QUYỀN VÀ CÁC MÀN HÌNH NGHIỆP VỤ (3 ROLES RBAC)

Hệ thống được thiết kế theo phong cách Lexus sang trọng (tông đen titan, vàng đồng kim loại, hiệu ứng thẻ cắt vát, animation mượt mà) và phân chia quyền hạn chặt chẽ ở cả **Giao diện (Frontend)** lẫn **API Backend (Middleware `requireRole`)**:

### Bảng Ma Trận Phân Quyền (RBAC)

| Chức năng nghiệp vụ | Khách vãng lai | Người mua (`user`) | Người bán (`seller`) | Quản trị viên (`admin`) |
| :--- | :---: | :---: | :---: | :---: |
| **Xem Trang chủ, Danh mục, Tìm kiếm** | ✓ | ✓ | ✓ | ✓ |
| **Xem Chi tiết sản phẩm** | Yêu cầu đăng nhập | ✓ | ✓ | ✓ |
| **Giỏ hàng riêng từng tài khoản** | ✓ *(giỏ tạm)* | ✓ *(lưu riêng `u<id>`)* | — *(ẩn giỏ hàng)* | — *(ẩn giỏ hàng)* |
| **Đặt hàng, Thanh toán, Sổ địa chỉ** | — | ✓ | — *(bị chặn 403)* | — *(bị chặn 403)* |
| **Xem Đơn mua cá nhân** | — | ✓ | — | — |
| **Hồ sơ, Ảnh đại diện, Đổi mật khẩu** | — | ✓ | ✓ | ✓ |
| **Kênh Người Bán (Đăng/Sửa/Xóa sản phẩm)** | — | — | ✓ *(chỉ sản phẩm của mình)* | ✓ *(quản lý mọi sản phẩm)* |
| **Tải ảnh sản phẩm từ máy tính (Upload)** | — | — | ✓ *(tối đa 8 ảnh/SP)* | ✓ |
| **Xem Báo cáo Doanh thu Shop** | — | — | ✓ *(sản phẩm của shop)* | ✓ *(doanh thu toàn sàn)* |
| **Quản lý Đơn hàng của Shop** | — | — | ✓ *(đơn chứa SP shop)* | ✓ *(toàn bộ đơn hàng)* |
| **Cập nhật trạng thái đơn (Hoàn kho khi hủy)**| — | — | — | ✓ |
| **Quản trị người dùng & Thay đổi quyền hạn** | — | — | — | ✓ |

> **Nguyên tắc nghiệp vụ quan trọng:**
> 1. Người bán và Quản trị viên **không mua hàng**: Backend sẽ trả về `403 Forbidden` nếu tài khoản seller/admin gọi `POST /api/orders` hoặc truy cập sổ địa chỉ/đơn mua.
> 2. Giỏ hàng được lưu theo từng tài khoản riêng biệt (`auramall_cart:u<id>`), không bị lẫn giỏ hàng giữa các phiên đăng nhập. Khách thêm giỏ tạm rồi đăng nhập thì giỏ tạm sẽ được tự động gộp vào tài khoản.
> 3. Hủy đơn hàng sẽ **tự động hoàn lại số lượng tồn kho** trong CSDL (`stock = stock + quantity`).

---

## 5. TÀI KHOẢN MẪU VÀ KẾT NỐI CƠ SỞ DỮ LIỆU

### Tài khoản thử nghiệm mặc định
Tất cả 3 tài khoản đều có mật khẩu mặc định là: **`Password123`** (đáp ứng tiêu chuẩn: tối thiểu 8 ký tự, có chữ hoa, chữ thường và chữ số):

| Vai trò (Role) | Tên đăng nhập | Email | Số điện thoại | Quyền hạn chính |
| :--- | :--- | :--- | :--- | :--- |
| **Người mua (`user`)** | `auramall_user` | `user@auramall.vn` | `0969795794` | Mua sắm, giỏ hàng, thanh toán, quản lý đơn mua, địa chỉ |
| **Người bán (`seller`)** | `auramall_seller` | `seller@auramall.vn` | `0912345678` | Kênh người bán, đăng sản phẩm, xem doanh thu shop |
| **Quản trị viên (`admin`)** | `auramall_admin` | `admin@auramall.vn` | `0987654321` | Quản trị toàn sàn, duyệt đơn, đổi quyền người dùng |

### Thông tin kết nối DBeaver / TablePlus (Xem CSDL trực tiếp)
* **Host:** `localhost`
* **Port:** `5432` *(hoặc `5433` nếu đổi `DB_HOST_PORT`)*
* **Database:** `ecommerce_db`
* **Username:** `ecommerce_user`
* **Password:** `ecommerce_secret`

---

## 6. HƯỚNG DẪN KIỂM THỬ HIỆU NĂNG VÀ ĐO TẢI CHỊU TẢI (GRAFANA K6)

Hệ thống được thiết kế và thực thi kiểm thử hiệu năng toàn diện trên địa chỉ triển khai thực tế (**`https://duytu205.id.vn`**) hoặc môi trường Docker local bằng công cụ **Grafana k6**. Bộ kịch bản gồm **7 kịch bản chuyên sâu** nằm trong thư mục [loadtest/](loadtest/), tách biệt rõ rệt từng mức tải (VU), tác vụ Đọc/Ghi, khả năng chịu sốc Flash Sale, tìm điểm sập và độ bền dài hạn.

### 6.1. Ma trận 7 kịch bản kiểm thử tải

| STT | Tên kịch bản | Loại hình kiểm thử | Cấu hình tải (Scenarios) | Mục tiêu kỹ thuật |
| :---: | :--- | :--- | :--- | :--- |
| **1** | [loadtest/ecommerce.js](loadtest/ecommerce.js) | **Luồng tổng hợp (Mix Load)** | 3 mức: 20 VU $\rightarrow$ 100 VU $\rightarrow$ 300 VU (100s) | Mô phỏng người dùng thật: 80% Đọc danh mục, 20% Ghi đặt hàng. |
| **2** | [loadtest/test-read.js](loadtest/test-read.js) | **Tốc độ Đọc (Read Throughput)** | 3 mức: 20 VU $\rightarrow$ 100 VU $\rightarrow$ 300 VU (100s) | Đo thông lượng (RPS) và băng thông API `GET /api/products`. |
| **3** | [loadtest/test-write.js](loadtest/test-write.js) | **Tốc độ Ghi (Write Concurrency)**| 3 mức: 20 VU $\rightarrow$ 100 VU $\rightarrow$ 300 VU (100s) | Đo tốc độ giao dịch `POST /api/orders`, kiểm tra khóa chống bán âm. |
| **4** | [loadtest/spike-test.js](loadtest/spike-test.js) | **Đột biến Flash Sale (Spike)** | 10 VU $\rightarrow$ vọt **400 VU trong 3s** $\rightarrow$ rút về 10 VU | Mô phỏng giờ mở bán 00:00 và đo khả năng tự hồi phục (Self-healing). |
| **5** | [loadtest/stress-breakpoint.js](loadtest/stress-breakpoint.js) | **Tìm điểm sập (Breakpoint)** | Bậc thang liên tục: 100 $\rightarrow$ 200 $\rightarrow$ 400 $\rightarrow$ 600 VU (65s) | Tìm ngưỡng sập tối đa và điểm bão hòa thông lượng (Saturation Point). |
| **6** | [loadtest/soak-endurance.js](loadtest/soak-endurance.js) | **Sức bền dài hạn (Soak Test)** | Duy trì ổn định 80 VU liên tục trong **5 phút** (300s) | Phát hiện rò rỉ bộ nhớ (Memory Leak) hoặc tràn Connection Pool. |
| **7** | [loadtest/auth-stress.js](loadtest/auth-stress.js) | **Tải xác thực (Auth Stress)** | 2 mức tải đăng nhập: 20 VU $\rightarrow$ 100 VU (40s) | Kiểm tra lớp lọc đầu vào (Input Validation) và tải băm mật khẩu `bcrypt`. |

---

### 6.2. Yêu cầu cài đặt công cụ k6 (Prerequisites)

Trước khi thực thi, máy tính cần cài đặt công cụ Grafana k6:
* **Trên Windows:**
  ```powershell
  winget install grafana.k6
  # Hoặc dùng Chocolatey: choco install k6
  ```
* **Trên Linux (Ubuntu/Debian):**
  ```bash
  sudo gpg -k
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
  sudo apt-get update && sudo apt-get install k6
  ```
* **Trên macOS:** `brew install k6`
* **Kiểm tra cài đặt:**
  ```bash
  k6 version
  ```

---

### 6.3. Cách 1: Chạy tự động chuỗi 7 kịch bản bằng PowerShell (Khuyên dùng)

Mở PowerShell tại thư mục gốc của dự án (`d:\ecommerce-infrastructure`), dán khối lệnh tự động dưới đây để chạy tuần tự 7 bài test, tự khởi tạo thư mục kết quả, ghi log sạch mã ANSI (`--no-color`) và chèn thời gian nghỉ 15 giây giữa các bài test để máy chủ giải phóng tài nguyên:

```powershell
# 1. Tạo thư mục lưu kết quả (tự động bỏ qua nếu đã tồn tại)
$ResultDir = "loadtest/test-result"
New-Item -ItemType Directory -Force -Path $ResultDir | Out-Null

# 2. Danh sách 7 file kịch bản cần chạy theo thứ tự
$Scripts = @(
    "ecommerce.js",
    "test-read.js",
    "test-write.js",
    "spike-test.js",
    "stress-breakpoint.js",
    "auth-stress.js",
    "soak-endurance.js"
)

# 3. Chạy lần lượt từng file, xuất ra .txt và nghỉ 15 giây giữa các bài test
foreach ($Script in $Scripts) {
    $BaseName = [System.IO.Path]::GetFileNameWithoutExtension($Script)
    $OutputFile = "$ResultDir/ket-qua-$BaseName.txt"
    Write-Host ">>> Dang chay kich ban: $Script..." -ForegroundColor Cyan
    k6 run --no-color -e BASE_URL=https://duytu205.id.vn "loadtest/$Script" | Tee-Object -FilePath $OutputFile
    Write-Host ">>> Da luu tai: $OutputFile. Nghi 15 giay de server hoi phuc..." -ForegroundColor Green
    Start-Sleep -Seconds 15
}
Write-Host ">>> HOAN TAT TOAN BO 7 KICH BAN KIEM THU!" -ForegroundColor Yellow
```
*(Nếu muốn kiểm thử trên môi trường Docker cục bộ, đổi tham số thành `-e BASE_URL=http://localhost`).*

---

### 6.4. Cách 2: Chạy kiểm thử đơn lẻ từng kịch bản (Dành cho quay demo & gỡ lỗi)

Bạn có thể chạy riêng từng kịch bản trọng tâm để quan sát tiến trình trực tiếp trên màn hình:

1. **Đo thông lượng Đọc tối đa (`GET /api/products`):**
   ```powershell
   k6 run -e BASE_URL=https://duytu205.id.vn loadtest/test-read.js
   ```
2. **Đo tốc độ Ghi và kiểm tra khóa giao dịch (`POST /api/orders`):**
   ```powershell
   k6 run -e BASE_URL=https://duytu205.id.vn loadtest/test-write.js
   ```
3. **Tìm Điểm bão hòa và Điểm sập hệ thống (100 $\rightarrow$ 600 VU):**
   ```powershell
   k6 run -e BASE_URL=https://duytu205.id.vn loadtest/stress-breakpoint.js
   ```
4. **Đo cú sốc Flash Sale đột biến (10 VU $\rightarrow$ 400 VU):**
   ```powershell
   k6 run -e BASE_URL=https://duytu205.id.vn loadtest/spike-test.js
   ```




## 7. HƯỚNG DẪN KIỂM THỬ 3: PHỤC HỒI KHO DỮ LIỆU MẪU & KIỂM TRA ĐƠN HÀNG ĐÃ SAO LƯU

*(Chi tiết xem thêm tại tài liệu chuyên sâu: [docs/backup.md](docs/backup.md))*

Mục tiêu của bài kiểm thử là chứng minh tính an toàn dữ liệu, khả năng khôi phục sau thảm họa (Disaster Recovery), bảo toàn **100% dữ liệu đơn hàng đã đặt** với thời gian phục hồi **RTO < 30 giây** (thực tế $\approx 1.15$ giây) và mức độ tổn thất **RPO = 0 giây** theo chuẩn SRE/DevOps.

### Cách 1: Chạy tự động 1 câu lệnh (Khuyên dùng khi báo cáo & kiểm tra nhanh)

Hệ thống đã xây dựng sẵn script kiểm thử tự động độc lập (Shadow Testing). Script sẽ tự động: sao lưu CSDL hiện tại $\rightarrow$ tạo CSDL thử nghiệm cô lập `ecommerce_verify_test` $\rightarrow$ khôi phục bản sao lưu $\rightarrow$ đo thời gian RTO $\rightarrow$ đối soát 100% số lượng bản ghi của cả 8 bảng (đặc biệt là bảng `orders` và `order_items`) $\rightarrow$ dọn dẹp và in bảng kết luận nghiệm thu.

* **Trên Windows PowerShell:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup.ps1
  ```
* **Trên Linux / macOS / Git Bash:**
  ```bash
  chmod +x ./scripts/verify-backup.sh
  ./scripts/verify-backup.sh
  ```

---

### Cách 2: Quy trình thực hiện thủ công từng bước

#### Bước 1: Kiểm tra các đơn hàng hiện có trong CSDL
Kiểm tra danh sách đơn hàng đã được người mua đặt trên hệ thống:
```bash
docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "
SELECT id, user_id, total_amount, status, created_at FROM orders ORDER BY id DESC LIMIT 5;"
```
*(Ghi nhận số lượng đơn hàng hiện tại: `SELECT COUNT(*) FROM orders;`)*

#### Bước 2: Kích hoạt sao lưu toàn phần (Backup Snapshot)
Thực thi lệnh sao lưu logic qua `pg_dump` nén `gzip`:
* **Bằng Shell Script:**
  ```bash
  bash scripts/backup.sh
  ```
* **Bằng PowerShell (nếu không có Bash):**
  ```powershell
  $backupFile = ".\database\backups\auramall_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
  docker exec ecommerce_database pg_dump -U ecommerce_user -d ecommerce_db --clean --if-exists -f /tmp/backup.sql
  docker cp ecommerce_database:/tmp/backup.sql $backupFile
  docker exec ecommerce_database rm -f /tmp/backup.sql
  ```
*Tệp sao lưu sẽ được lưu tại thư mục `./database/backups/auramall_backup_*.sql.gz`.*

#### Bước 3: Giả lập sự cố mất mát dữ liệu hoặc xóa đơn hàng
Giả định hệ thống gặp sự cố mất dữ liệu đơn hàng:
```bash
docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "
DELETE FROM order_items;
DELETE FROM orders;
"
```
*(Kiểm tra lại: `SELECT COUNT(*) FROM orders;` $\rightarrow$ Trả về `0` bản ghi - Dữ liệu đã bị xóa).*

#### Bước 4: Thực hiện phục hồi từ bản sao lưu (Restore)
Chạy script phục hồi từ tệp sao lưu đã tạo ở Bước 2:
```bash
bash scripts/restore.sh ./database/backups/<TEN_TEP_BACKUP>.sql.gz
```
*(Hoặc dùng PowerShell: `docker cp <file> ecommerce_database:/tmp/restore.sql` và `docker exec ecommerce_database psql -U ecommerce_user -d ecommerce_db -f /tmp/restore.sql`)*

#### Bước 5: Kiểm tra và nghiệm thu đơn hàng sau phục hồi
Truy vấn lại cơ sở dữ liệu để xác nhận đơn hàng đã được khôi phục nguyên vẹn 100%:
```bash
docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "
SELECT COUNT(*) AS total_orders FROM orders;
SELECT COUNT(*) AS total_order_items FROM order_items;
SELECT id, user_id, total_amount, status FROM orders ORDER BY id DESC LIMIT 5;
"
```
* **Tiêu chuẩn nghiệm thu:**
  - Toàn bộ số lượng đơn hàng và chi tiết đơn hàng khớp 100% so với trước khi xóa.
  - Ứng dụng Web truy cập bình thường, người mua xem lại được đơn hàng trên màn hình "Đơn mua".
  - Kiểm tra trạng thái hệ thống: `curl http://localhost/health` $\rightarrow$ `{"status":"ok"}`.

---

## 8. BẢNG XỬ LÝ SỰ CỐ THƯỜNG GẶP (TROUBLESHOOTING)

| Hiện tượng / Thông báo lỗi | Nguyên nhân | Cách khắc phục |
| :--- | :--- | :--- |
| **Lỗi máy chủ nội bộ (500)** | Backend chưa kết nối được CSDL hoặc volume CSDL cũ bị lỗi bảng | Chạy: `docker compose down -v` rồi chạy lại `docker compose up -d --build` |
| **Trùng cổng 80 (Nginx không start)** | Dịch vụ IIS / Skype trên Windows đang chiếm cổng 80 | Sửa trong `.env`: `NGINX_PORT=8080`, chạy lại `docker compose up -d` rồi mở `http://localhost:8080` |
| **Trùng cổng 5432 (Postgres không start)**| Máy đã cài sẵn PostgreSQL local từ trước | Sửa trong `.env`: `DB_HOST_PORT=5433` rồi chạy lại `docker compose up -d` |
| **`FATAL: role "postgres" does not exist`**| Dùng nhầm tài khoản mặc định `postgres` khi chạy `psql` | Đổi thành: `docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "..."` |

---

## 9. TÀI LIỆU KỸ THUẬT & HỢP ĐỒNG API LIÊN QUAN

* **Tài liệu Tổng hợp Chi tiết Xây dựng Dự án (.md):** [docs/TONG_HOP_CHI_TIET_XAY_DUNG_DU_AN_TMDT.md](docs/TONG_HOP_CHI_TIET_XAY_DUNG_DU_AN_TMDT.md)
* **Tài liệu Hướng dẫn Sao lưu, Phục hồi & Kiểm toán CSDL (.md):** [docs/backup.md](docs/backup.md)
* **Tài liệu Đặc tả Nghiệp vụ & Thiết kế Chức năng (.docx):** [docs/TAI_LIEU_THIET_KE_NGHIEP_VU_AURAMALL.docx](docs/TAI_LIEU_THIET_KE_NGHIEP_VU_AURAMALL.docx) *(Bản xem nhanh: [docs/TAI_LIEU_THIET_KE_NGHIEP_VU_AURAMALL.md](docs/TAI_LIEU_THIET_KE_NGHIEP_VU_AURAMALL.md))*
* **Hợp đồng API chi tiết (API Contract):** [docs/api-contract.md](docs/api-contract.md)
* **Swagger UI trực tiếp:** [http://localhost/api/docs/](http://localhost/api/docs/) (Đặc tả OpenAPI trong [backend/openapi.js](backend/openapi.js))
* **Sơ đồ kiến trúc hạ tầng Draw.io:** [docs/architecture.drawio](docs/architecture.drawio)
* **Kịch bản kiểm thử API REST Client:** [docs/api-test.http](docs/api-test.http)
* **Thư mục Postman Collection:** [postman/](postman/)
* **Kịch bản Sao lưu & Phục hồi CSDL:** `bash scripts/backup.sh` và `bash scripts/restore.sh <file_backup>`
* **Bản quyền hình ảnh sản phẩm:** [frontend/images/products/CREDITS.md](frontend/images/products/CREDITS.md)
