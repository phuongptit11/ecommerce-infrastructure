# HỆ THỐNG HẠ TẦNG THƯƠNG MẠI ĐIỆN TỬ AURAMALL
## ĐỀ TÀI 07: THIẾT KẾ & TRIỂN KHAI HẠ TẦNG CNTT CHO HỆ THỐNG TMĐT

Hệ thống mô phỏng kiến trúc hạ tầng TMĐT phân vùng mạng 3 tầng chuyên nghiệp, đáp ứng các tiêu chuẩn bảo mật, phân quyền nghiêm ngặt (3 Roles RBAC), cân bằng tải tự động, đa dạng phương thức triển khai (Local Docker, Cloudflare Tunnel, Render Cloud, Vercel Serverless) và đã sẵn sàng kịch bản kiểm thử tải (k6 load testing):

* **Tầng 1 (Web Tier):** Nginx Reverse Proxy 1.28 & Static Web SPA (Public Subnet - Cổng 80)
* **Tầng 2 (App Tier):** Node.js 22 Express 5 API Cluster (Private Subnet - Cổng 5000 nội bộ)
* **Tầng 3 (Data Tier):** PostgreSQL 15 Database (Private Subnet - Cổng 5432 nội bộ)

---

## 1. CÁC EXTENSION KHUYẾN NGHỊ TRONG VISUAL STUDIO CODE

Để mở và làm việc hiệu quả với toàn bộ các định dạng file trong dự án bằng Visual Studio Code, bạn nên cài đặt các extension sau trong tab Extensions (`Ctrl + Shift + X`):

1. **Draw.io Integration (`hediet.vscode-drawio`)**:
   - Dùng để xem và chỉnh sửa sơ đồ kiến trúc hạ tầng [docs/architecture.drawio](docs/architecture.drawio) trực tiếp ngay trong VS Code với giao diện đồ họa kéo thả.
2. **REST Client (`humao.rest-client`)** hoặc **Thunder Client (`rangav.vscode-thunder-client`)**:
   - Dùng để gửi trực tiếp các Request API kiểm thử có sẵn trong [docs/api-test.http](docs/api-test.http) chỉ bằng 1 cú click ("Send Request").
3. **Docker (`ms-azuretools.vscode-docker`)**:
   - Quản lý các container, volume, network và kiểm tra log của [docker-compose.yml](docker-compose.yml).
4. **PostgreSQL Client / SQLTools (`mtxr.sqltools` + `mtxr.sqltools-driver-pg`)**:
   - Quản lý, chạy câu lệnh truy vấn trực tiếp vào CSDL PostgreSQL từ file [database/schema.sql](database/schema.sql) và [database/seed.sql](database/seed.sql).
5. **Prettier - Code formatter (`esbenp.prettier-vscode`)**:
   - Tự động định dạng mã nguồn HTML, CSS, JavaScript, JSON và Markdown chuẩn chỉ.

> **Mẹo cài nhanh bằng dòng lệnh Terminal:**
> ```bash
> code --install-extension hediet.vscode-drawio
> code --install-extension humao.rest-client
> code --install-extension ms-azuretools.vscode-docker
> code --install-extension mtxr.sqltools
> ```

---

## 2. HƯỚNG DẪN KHỞI CHẠY VÀ TRIỂN KHAI (4 PHƯƠNG ÁN)

Hệ thống hỗ trợ 4 phương thức chạy từ máy cục bộ (Local) đến đẩy lên môi trường Internet (Cloud / Serverless):

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

### Phương án 2: Đưa web ra Internet bằng Tên miền riêng qua Cloudflare Tunnel

Cho phép truy cập website từ bất kỳ đâu qua Internet với **HTTPS có chứng chỉ SSL chính thức**, **không cần IP tĩnh hay mở cổng modem/router**:
Container `cloudflared` tạo tunnel bảo mật kết nối ra Cloudflare Edge và chuyển luồng truy cập vào `http://nginx:80` (vẫn đi qua trọn vẹn 3 tầng hạ tầng).

1. Thêm tên miền vào Cloudflare (gói Free), trỏ Nameserver ở nhà đăng ký tên miền về Cloudflare.
2. Cloudflare Dashboard $\rightarrow$ **Networks** $\rightarrow$ **Tunnels** $\rightarrow$ **Create Tunnel** $\rightarrow$ Chọn Docker $\rightarrow$ Sao chép token vào file `.env`:
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
   ```
3. Trong Tunnel $\rightarrow$ **Routes** $\rightarrow$ **Published application**: Nhập tên miền của bạn, Service URL chọn: `http://nginx:80`.
4. Khởi chạy hệ thống kèm profile tunnel:
   ```bash
   docker compose --profile tunnel up -d
   ```
5. Bật tùy chọn SSL: **SSL/TLS** $\rightarrow$ **Edge Certificates** $\rightarrow$ **Always Use HTTPS**.

> **Bản triển khai thực tế của nhóm:** Website chính thức hoạt động tại **[https://duytu205.id.vn](https://duytu205.id.vn)** (Tunnel `auramall`).

---

### Phương án 3: Deploy 24/7 lên Render Cloud (Full Cloud Blueprint)

Web hoạt động 24/7 trực tuyến mà **không cần bật máy tính cá nhân**, sử dụng file cấu hình [render.yaml](render.yaml):
- **`auramall-db`**: PostgreSQL 15 quản trị trên Render (Singapore region).
- **`auramall`**: Web Service Node.js phục vụ cả giao diện SPA và API (`SERVE_FRONTEND=true`). File [scripts/init-cloud-db.js](scripts/init-cloud-db.js) tự động nạp `schema.sql` và `seed.sql` ngay khi deploy.

1. Đẩy mã nguồn dự án lên GitHub cá nhân.
2. Truy cập [render.com](https://render.com) $\rightarrow$ **New** $\rightarrow$ **Blueprint** $\rightarrow$ Chọn repository `ecommerce-infrastructure` và chọn nhánh.
3. Điền các biến môi trường khi Render hỏi (`APP_URL=https://<domain>`, `GOOGLE_CLIENT_ID`, `BREVO_API_KEY`) $\rightarrow$ Bấm **Apply**.
4. Gắn tên miền riêng: Service **auramall** $\rightarrow$ **Settings** $\rightarrow$ **Custom Domains** $\rightarrow$ Thêm tên miền $\rightarrow$ Thêm bản ghi CNAME trên Cloudflare DNS trỏ về `<service-name>.onrender.com`.

---

### Phương án 4: Deploy Serverless lên Vercel + Neon PostgreSQL

Dành cho kiến trúc Serverless siêu nhẹ với chi phí 0đ:
- Giao diện Frontend phục vụ tĩnh toàn cầu qua Edge CDN của Vercel.
- Toàn bộ API Express được chuyển đổi thành Serverless Function qua [api/index.js](api/index.js) và [vercel.json](vercel.json).
- CSDL PostgreSQL đặt trên mây qua [Neon.tech](https://neon.tech) (gói Free có sẵn SSL).

1. Tạo database trên Neon.tech, sao chép chuỗi kết nối `DATABASE_URL="postgres://...?sslmode=require"`.
2. Khởi tạo bảng và dữ liệu mẫu từ máy (chạy 1 lần):
   ```bash
   cd backend && npm ci && cd ..
   DATABASE_URL="postgres://...?sslmode=require" node scripts/init-cloud-db.js
   ```
3. Deploy lên Vercel:
   ```bash
   npx vercel --prod
   ```

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
- **Chạy trên Cloud Render / Vercel (Brevo API):** Vì các dịch vụ Cloud miễn phí chặn cổng SMTP 587, cấu hình dùng Brevo API Key:
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

## 6. KỊCH BẢN KIỂM THỬ TẢI (K6 LOAD TESTING)

Dự án đã chuẩn bị sẵn các kịch bản kiểm thử tải bằng công cụ **Grafana k6** trong thư mục [loadtest/](loadtest/):
* **Tác vụ Đọc danh mục:** [loadtest/test-read.js](loadtest/test-read.js) (`GET /api/products`)
* **Tác vụ Ghi đặt hàng:** [loadtest/test-write.js](loadtest/test-write.js) (`POST /api/orders`)
* **Kịch bản tổng hợp Flash Sale:** [loadtest/ecommerce.js](loadtest/ecommerce.js) (80% Đọc, 20% Ghi)

Nhóm sẽ thực hiện chạy đo tải các mức và cập nhật số liệu chính thức sau khi hoàn tất môi trường.

---

## 7. BẢNG XỬ LÝ SỰ CỐ THƯỜNG GẶP (TROUBLESHOOTING)

| Hiện tượng / Thông báo lỗi | Nguyên nhân | Cách khắc phục |
| :--- | :--- | :--- |
| **Lỗi máy chủ nội bộ (500)** | Backend chưa kết nối được CSDL hoặc volume CSDL cũ bị lỗi bảng | Chạy: `docker compose down -v` rồi chạy lại `docker compose up -d --build` |
| **Trùng cổng 80 (Nginx không start)** | Dịch vụ IIS / Skype trên Windows đang chiếm cổng 80 | Sửa trong `.env`: `NGINX_PORT=8080`, chạy lại `docker compose up -d` rồi mở `http://localhost:8080` |
| **Trùng cổng 5432 (Postgres không start)**| Máy đã cài sẵn PostgreSQL local từ trước | Sửa trong `.env`: `DB_HOST_PORT=5433` rồi chạy lại `docker compose up -d` |
| **`FATAL: role "postgres" does not exist`**| Dùng nhầm tài khoản mặc định `postgres` khi chạy `psql` | Đổi thành: `docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "..."` |

---

## 8. TÀI LIỆU KỸ THUẬT & HỢP ĐỒNG API LIÊN QUAN

* **Hợp đồng API chi tiết (API Contract):** [docs/api-contract.md](docs/api-contract.md)
* **Swagger UI trực tiếp:** [http://localhost/api/docs/](http://localhost/api/docs/) (Đặc tả OpenAPI trong [backend/openapi.js](backend/openapi.js))
* **Sơ đồ kiến trúc hạ tầng Draw.io:** [docs/architecture.drawio](docs/architecture.drawio)
* **Kịch bản kiểm thử API REST Client:** [docs/api-test.http](docs/api-test.http)
* **Thư mục Postman Collection:** [postman/](postman/)
* **Kịch bản Sao lưu & Phục hồi CSDL:** `bash scripts/backup.sh` và `bash scripts/restore.sh <file_backup>`
* **Bản quyền hình ảnh sản phẩm:** [frontend/images/products/CREDITS.md](frontend/images/products/CREDITS.md)
