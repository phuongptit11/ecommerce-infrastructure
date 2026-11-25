# TÀI LIỆU ĐẶC TẢ NGHIỆP VỤ & THIẾT KẾ CHỨC NĂNG HỆ THỐNG
## HỆ THỐNG THƯƠNG MẠI ĐIỆN TỬ PHÂN TẦNG CHỊU TẢI CAO AURAMALL
**Học phần:** Thiết kế & Triển khai Hạ tầng Công nghệ Thông tin  
**Đề tài 07:** Hạ Tầng TMĐT 3 Tầng Bảo Mật, Chịu Tải Cao & Mở Rộng Linh Hoạt  
**Địa chỉ triển khai thực tế:** [https://duytu205.id.vn](https://duytu205.id.vn) *(Tên miền riêng chính thức)*  
**Phiên bản:** 3.0 (Cập nhật Kiến trúc Thực tế, Tên miền riêng, Gmail API, Đo tải 7 mức k6 & Phục hồi CSDL Shadow Recovery) — Tháng 11/2026  

### DANH SÁCH THÀNH VIÊN NHÓM THỰC HIỆN (NHÓM 9 - ĐỀ TÀI 07)

| STT | Họ và tên | Mã sinh viên | Vai trò và Phân công kỹ thuật |
| :---: | :--- | :---: | :--- |
| 1 | Nguyễn Minh Phương | B24DCCC231 | Thiết kế các tầng mạng, Reverse Proxy Nginx và bộ kịch bản tải k6. |
| 2 | Nguyễn Duy Tư | B24DCCC275 | Triển khai Web SPA, API Backend Node.js, Cloudflare Tunnel & Domain. |
| 3 | Mạc Đức Dương | B24DCCC087 | Cấu hình kho dữ liệu PostgreSQL, kịch bản Sao lưu/Phục hồi CSDL & KT3. |
| 4 | Nguyễn Đức Dũng | B24DCCC081 | Đo tải thực nghiệm 7 kịch bản, xác định điểm suy giảm và so sánh SLA. |

---

## MỤC LỤC TỔNG QUAN

1. **Chương 1: Tổng Quan Hệ Thống & Mục Tiêu Dự Án**
   - 1.1. Bối cảnh bài toán và mục tiêu kỹ thuật cốt lõi
   - 1.2. Triết lý thiết kế giao diện (UI/UX Concept: Lexus Luxury)
   - 1.3. Các nhóm tác tử tham gia hệ thống (Actors)
2. **Chương 2: Kiến Trúc Hạ Tầng Phân Vùng Mạng 3 Tầng & Đa Nền Tảng Triển Khai**
   - 2.1. Phân vùng mạng và vai trò từng tầng (Web - App - Data)
   - 2.2. Các phương án triển khai linh hoạt (Docker Compose, Cloudflare Tunnel, Render Cloud)
   - 2.3. Nguyên tắc bảo mật và cô lập tài nguyên mạng
3. **Chương 3: Mô Hình Phân Quyền Truy Cập (Role-Based Access Control - RBAC)**
   - 3.1. Bảng Ma trận Phân quyền chi tiết (4 nhóm tác tử x 16 chức năng)
   - 3.2. Các quy tắc nghiệp vụ đặc thù về phân quyền
   - 3.3. Tài khoản thử nghiệm mặc định
4. **Chương 4: Đặc Tả Chi Tiết 8 Phân Hệ Màn Hình & Luồng Nghiệp Vụ**
   - 4.1. Phân hệ 1: Xác thực & Quản lý Định danh (Auth Portal)
   - 4.2. Phân hệ 2: Trang Chủ & Duyệt Danh Mục Sản Phẩm (Catalog & Discovery)
   - 4.3. Phân hệ 3: Chi Tiết Sản Phẩm (Product Details)
   - 4.4. Phân hệ 4: Quản Lý Giỏ Hàng (Cart Management)
   - 4.5. Phân hệ 5: Quy Trình Đặt Hàng & Thanh Toán (Checkout Workflow)
   - 4.6. Phân hệ 6: Trung Tâm Tài Khoản Người Dùng (Account Center)
   - 4.7. Phân hệ 7: Kênh Người Bán Hàng (Seller Portal)
   - 4.8. Phân hệ 8: Quản Trị Hệ Thống Toàn Diện (Admin Portal)
5. **Chương 5: Thiết Kế Cơ Sở Dữ Liệu & Chiến Lược Đánh Chỉ Mục**
   - 5.1. Cấu trúc 8 bảng quan hệ thực thể (ERD)
   - 5.2. Chiến lược 13 chỉ mục B-Tree hiệu năng cao
   - 5.3. Lưu trữ ảnh nhị phân BYTEA trực tiếp trong CSDL
6. **Chương 6: Kết Luận & Hướng Phát Triển**

---

## CHƯƠNG 1: TỔNG QUAN HỆ THỐNG & MỤC TIÊU DỰ ÁN

Hệ thống Thương mại Điện tử **AuraMall** là đề tài thực nghiệm chuyên sâu thuộc học phần Thiết kế & Triển khai Hạ tầng CNTT. Dự án tập trung giải quyết bài toán kiến trúc cho hệ thống thương mại trực tuyến hiện đại: phục vụ trải nghiệm người dùng mượt mà, phân quyền bảo mật chặt chẽ, đảm bảo tính toàn vẹn dữ liệu trong các đợt mua hàng đồng thời (Flash Sale) và xây dựng quy trình tự động hóa sao lưu phục hồi chuẩn DevOps/SRE.

### 1.1. Bối cảnh bài toán và mục tiêu kỹ thuật cốt lõi
- **Kiến trúc an toàn 3 tầng:** Tách biệt rạch ròi giữa Tầng Web (Nginx), Tầng Ứng dụng (Node.js) và Tầng Dữ liệu (PostgreSQL) qua 2 phân vùng mạng Docker (`public_net` và `private_net`). Ngăn chặn 100% nguy cơ truy cập trái phép từ Internet vào cơ sở dữ liệu.
- **Khả năng chịu tải cao & Tự hồi phục (Resilience):** Hệ thống có khả năng đáp ứng hàng trăm người dùng ảo đồng thời (VU) với thời gian phản hồi $p(95) < 1.5$ giây, chống chịu được cú sốc tăng tải gấp 40 lần trong 3 giây và tự giải phóng tài nguyên ngay khi hết sốc tải.
- **Toàn vẹn giao dịch nguyên tử (ACID):** Ứng dụng cơ chế khóa dòng (`SELECT ... FOR UPDATE`) trong PostgreSQL khi đặt hàng, triệt tiêu hoàn toàn rủi ro bán vượt tồn kho (Overselling) hoặc xung đột race condition.
- **Triển khai thực tế 24/7:** Vận hành thực tế trên tên miền riêng chính thức **`https://duytu205.id.vn`** với chứng chỉ bảo mật SSL/TLS 1.3 thông qua Cloudflare Tunnel kết hợp dịch vụ đám mây Render Cloud (Singapore Region).

### 1.2. Triết lý thiết kế giao diện (UI/UX Concept: Lexus Luxury)
Giao diện AuraMall được xây dựng bằng công nghệ Web SPA hiện đại (HTML5, CSS3, Vanilla JavaScript), lấy cảm hứng từ ngôn ngữ thiết kế sang trọng của thương hiệu ô tô Lexus:
- **Tông màu chủ đạo:** Đen Titan (`#0F1115`), Than chì (`#181B20`), Trắng ngọc trai kết hợp điểm nhấn Vàng đồng kim loại cao cấp (`#C5A880`).
- **Bố cục thị giác:** Thẻ sản phẩm cắt vát kim cương (Chiseled Card), mega menu đa tầng theo từng danh mục, hiệu ứng màn chắn trượt nghiêng khi chuyển trang và hiệu ứng ánh kim lướt qua nút bấm khi hover.
- **Phông chữ:** Kết hợp phông chữ Montserrat và Be Vietnam Pro hỗ trợ chuẩn Unicode tiếng Việt có dấu.

### 1.3. Các nhóm tác tử tham gia hệ thống (Actors)
1. **Khách vãng lai (Guest):** Chưa đăng nhập. Được xem trang chủ, duyệt danh mục, xem danh sách sản phẩm, tìm kiếm và có giỏ hàng tạm thời.
2. **Người mua (`user`):** Khách hàng đã đăng nhập. Có giỏ hàng riêng, đặt hàng, quản lý đơn mua cá nhân, sổ địa chỉ nhận hàng và hồ sơ tài khoản.
3. **Người bán (`seller`):** Chủ shop kinh doanh. Có quyền đăng bán sản phẩm, tải ảnh từ máy tính (lưu nhị phân vào CSDL), quản lý kho hàng, theo dõi đơn hàng của shop và xem báo cáo doanh thu.
4. **Quản trị viên (`admin`):** Ban quản trị sàn. Kiểm soát người dùng, phân quyền tài khoản, quản trị toàn bộ sản phẩm/đơn hàng, duyệt trạng thái và xem doanh thu toàn sàn.

---

## CHƯƠNG 2: KIẾN TRÚC HẠ TẦNG PHÂN VÙNG MẠNG 3 TẦNG & ĐA NỀN TẢNG TRIỂN KHAI

### 2.1. Phân vùng mạng và vai trò từng tầng (Web - App - Data)

Hệ thống được thiết kế theo mô hình 3 tầng vật lý/logic chặt chẽ:

```
[ Internet / Khách hàng / k6 Test ]
              │ (HTTPS: 443 / HTTP: 80)
              ▼
┌────────────────────────────────────────────────────────┐
│ CLOUDFLARE EDGE & TUNNEL (https://duytu205.id.vn)      │
│ • SSL/TLS 1.3 Strict • Anycast DNS • DDoS Mitigation   │
└──────────────────────────┬─────────────────────────────┘
                           │ (cloudflared encrypted tunnel)
                           ▼
┌────────────────────────────────────────────────────────┐
│ TẦNG 1: WEB TIER (public_net - Cổng 80)                │
│ • Nginx 1.28-alpine Gateway & Reverse Proxy            │
│ • Phục vụ Static Web SPA (HTML5/CSS3/JS Lexus UI)      │
│ • Nén Gzip tốc độ cao • Round-Robin Load Balancing     │
│ • Dynamic DNS Resolver (127.0.0.11) • Rate Limiting    │
└──────────────────────────┬─────────────────────────────┘
                           │ (Upstream: backend_nodes:5000)
                           ▼
┌────────────────────────────────────────────────────────┐
│ TẦNG 2: APP TIER (public_net & private_net - Cổng 5000)│
│ • Cụm Node.js 22 (LTS) + Express 5 Backend Cluster     │
│ • Xác thực JWT Native & Băm mật khẩu Salted BCrypt     │
│ • Quản lý 3 vai trò RBAC (requireRole Middleware)      │
│ • Connection Pool pg (DB_POOL_MAX=10)                  │
│ • Giao dịch ACID & Khóa dòng SELECT FOR UPDATE         │
│ • Tích hợp Google Identity (RS256) & Gmail API (OAuth2)│
└──────────────────────────┬─────────────────────────────┘
                           │ (PostgreSQL TCP: 5432 nội bộ)
                           ▼
┌────────────────────────────────────────────────────────┐
│ TẦNG 3: DATA TIER (private_net - Cổng 5432 nội bộ)     │
│ • Cơ sở dữ liệu PostgreSQL 15-alpine                   │
│ • Lưu trữ 8 bảng nghiệp vụ • 13 chỉ mục B-Tree         │
│ • Lưu ảnh nhị phân BYTEA (bảng uploaded_images)        │
│ • Volume bền vững pg_data • Cô lập khỏi Internet       │
└──────────────────────────┬─────────────────────────────┘
                           ▲
                           │ (Docker Exec Stream Pipe)
┌──────────────────────────┴─────────────────────────────┐
│ HẠ TẦNG SAO LƯU, PHỤC HỒI & KIỂM THỬ SRE (scripts/)    │
│ • scripts/backup.sh (pg_dump logic stream, gzip -t)    │
│ • scripts/restore.sh (gunzip, psql, auto restart BE)   │
│ • verify-backup.ps1 / .sh (Shadow Recovery CSDL test)  │
└────────────────────────────────────────────────────────┘
```

| Tầng hạ tầng | Công nghệ chính | Phân vùng mạng | Vai trò & Nhiệm vụ kỹ thuật |
| :--- | :--- | :--- | :--- |
| **Tầng 1: Web Tier** | Nginx `1.28-alpine` | `public_net` (Cổng 80) | Cổng tiếp nhận duy nhất; phục vụ Web SPA; cân bằng tải round-robin tới các bản sao backend; nén gzip; đệm kết nối. |
| **Tầng 2: App Tier** | Node.js `22-alpine` (Express `^5.3`) | `public_net` & `private_net` (Cổng 5000 nội bộ) | Cụm máy chủ xử lý logic nghiệp vụ không lưu trạng thái (Stateless); xác thực JWT; phân quyền RBAC; quản lý transaction CSDL; gửi email qua Gmail API. |
| **Tầng 3: Data Tier** | PostgreSQL `15-alpine` | `private_net` (Cổng 5432 nội bộ) | Lưu trữ dữ liệu có cấu trúc ACID; quản lý 8 bảng; thực thi khóa dòng `FOR UPDATE`; lưu ảnh nhị phân BYTEA; cách ly hoàn toàn khỏi Internet. |

### 2.2. Các phương án triển khai linh hoạt
1. **Phương án 1: Triển khai Cục bộ bằng Docker Compose (Khuyên dùng cho học tập & bảo vệ đồ án):**
   - Đóng gói toàn bộ 3 dịch vụ qua tệp [docker-compose.yml](docker-compose.yml). Khởi chạy chỉ với 1 câu lệnh: `docker compose up -d --build`.
   - Hỗ trợ mở rộng quy mô ngang (Horizontal Scaling) tức thì: `docker compose up -d --scale backend=3`. Nginx tự động cân bằng tải Round-Robin qua cơ chế dynamic DNS resolver `127.0.0.11`.
2. **Phương án 2: Đưa Web ra Internet qua Tên miền riêng bằng Cloudflare Tunnel:**
   - Tên miền chính thức: **`https://duytu205.id.vn`**.
   - Container `cloudflared` tạo đường hầm mã hóa hai chiều từ máy chủ tới Cloudflare Edge. Không cần mở cổng modem (Port Forwarding), không cần IP tĩnh, tự động kích hoạt chứng chỉ SSL/TLS 1.3 và chống tấn công DDoS tại tầng biên.
3. **Phương án 3: Vận hành 24/7 trên Đám mây (Render Cloud Singapore Region):**
   - Dịch vụ Web Service (Node.js) và Managed PostgreSQL Cloud được cấu hình tự động thông qua tệp [render.yaml](render.yaml).
   - Tệp [scripts/init-cloud-db.js](scripts/init-cloud-db.js) tự động khởi tạo cấu trúc 8 bảng (`schema.sql`) và dữ liệu mẫu (`seed.sql`).

### 2.3. Nguyên tắc bảo mật và cô lập tài nguyên mạng
- **Nguyên tắc cô lập tầng Dữ liệu:** Container PostgreSQL chỉ mở cổng 5432 trong mạng nội bộ `private_net`. Nginx và người dùng Internet không thể kết nối trực tiếp vào CSDL. Chỉ container Backend thuộc cả 2 mạng mới có quyền truy vấn dữ liệu.
- **Bảo vệ biến môi trường:** Toàn bộ thông tin nhạy cảm (`DB_PASSWORD`, `JWT_SECRET`, `GMAIL_REFRESH_TOKEN`) được nạp động từ tệp `.env`, không hardcode vào mã nguồn.
- **Bảo mật cổng quản trị:** Cổng 5432 chỉ bind vào `127.0.0.1:5432` cho công cụ quản trị nội bộ (DBeaver) của kỹ sư hạ tầng.

---

## CHƯƠNG 3: MÔ HÌNH PHÂN QUYỀN TRUY CẬP (ROLE-BASED ACCESS CONTROL - RBAC)

Hệ thống áp dụng mô hình phân quyền nghiêm ngặt dựa trên vai trò (RBAC) được kiểm soát đa lớp: tại giao diện Frontend (ẩn/hiện chức năng theo vai trò, chuyển hướng an toàn) và tại Backend qua các middleware `requireAuth` và `requireRole`.

### 3.1. Bảng Ma Trận Phân Quyền Chi Tiết (4 Nhóm Tác Tử x 16 Chức Năng)

| STT | Chức năng nghiệp vụ | Khách (Guest) | Người mua (`user`) | Người bán (`seller`) | Quản trị viên (`admin`) |
| :---: | :--- | :---: | :---: | :---: | :---: |
| 1 | **Xem trang chủ, danh mục, tìm kiếm** | Cho phép | Cho phép | Cho phép | Cho phép |
| 2 | **Xem chi tiết sản phẩm** | Yêu cầu đăng nhập | Cho phép | Cho phép | Cho phép |
| 3 | **Giỏ hàng** | Giỏ tạm (`guest`) | Giỏ riêng (`u<id>`) | Ẩn giỏ hàng | Ẩn giỏ hàng |
| 4 | **Đặt hàng & Thanh toán** | Không | Cho phép | Chặn (HTTP 403) | Chặn (HTTP 403) |
| 5 | **Xem đơn mua cá nhân** | Không | Cho phép | Chặn (HTTP 403) | Chặn (HTTP 403) |
| 6 | **Quản lý sổ địa chỉ giao hàng** | Không | Cho phép | Chặn (HTTP 403) | Chặn (HTTP 403) |
| 7 | **Hồ sơ, đổi mật khẩu, cập nhật avatar** | Không | Cho phép | Cho phép | Cho phép |
| 8 | **Đăng bán sản phẩm mới** | Không | Không | Cho phép | Cho phép |
| 9 | **Tải ảnh sản phẩm từ máy tính (BYTEA)**| Không | Không | Cho phép (tối đa 8 ảnh)| Cho phép |
| 10| **Chỉnh sửa / Xóa sản phẩm** | Không | Không | Chỉ SP của shop mình | Mọi sản phẩm |
| 11| **Xem báo cáo doanh thu** | Không | Không | Doanh thu shop mình | Doanh thu toàn sàn |
| 12| **Quản lý đơn hàng** | Không | Xem đơn mua | Đơn chứa SP shop | Mọi đơn hàng |
| 13| **Duyệt / Chuyển trạng thái đơn** | Không | Không | Không | Cho phép |
| 14| **Tự động hoàn kho khi hủy đơn** | Không | Không | Không | Tự động hoàn kho |
| 15| **Quản trị tài khoản & Đổi vai trò** | Không | Không | Không | Cho phép (trừ mình) |
| 16| **Xem tài liệu API OpenAPI tương tác**| Không | Cho phép (/api/docs/)| Cho phép (/api/docs/)| Cho phép (/api/docs/)|

### 3.2. Các quy tắc nghiệp vụ đặc thù về phân quyền
1. **Nguyên tắc không chéo quyền (Role Isolation):** Người bán và Quản trị viên **không tham gia mua hàng**. Backend trả về `HTTP 403 Forbidden` nếu gửi token seller/admin vào API đặt hàng (`POST /api/orders`). Giao diện tự động ẩn nút "Thêm vào giỏ", "Mua ngay" và biểu tượng giỏ hàng khi đăng nhập bằng tài khoản seller/admin.
2. **Giỏ hàng lưu trữ độc lập:** Giỏ hàng được lưu theo khóa tài khoản riêng biệt (`auramall_cart:u<id>`), không bị lẫn lộn giữa các phiên đăng nhập. Khi khách vãng lai thêm sản phẩm vào giỏ tạm rồi đăng nhập tài khoản người mua, giỏ tạm sẽ được tự động gộp vào tài khoản.
3. **Quyền sở hữu sản phẩm (Resource Ownership):** Người bán chỉ có quyền chỉnh sửa hoặc xóa các sản phẩm do chính mình đăng bán (`seller_id = req.user.userId`). Sản phẩm đã phát sinh đơn hàng sẽ bị khóa không cho xóa để bảo đảm lịch sử báo cáo doanh thu.
4. **Cơ chế tự bảo vệ Quản trị viên:** Quản trị viên không thể tự hạ quyền hoặc thay đổi vai trò của chính tài khoản mình để tránh tình trạng hệ thống bị mất quyền quản trị tối cao.

### 3.3. Tài khoản thử nghiệm mặc định
Tất cả các tài khoản mẫu đều được thiết lập mật khẩu mặc định là: **`Password123`** (đáp ứng tiêu chuẩn: tối thiểu 8 ký tự, có chữ hoa, chữ thường và chữ số):

| Vai trò (Role) | Tên đăng nhập | Email | Số điện thoại | Quyền hạn chính |
| :--- | :--- | :--- | :--- | :--- |
| **Người mua (`user`)** | `auramall_user` | `user@auramall.vn` | `0969795794` | Mua sắm, giỏ hàng, thanh toán, quản lý đơn mua, địa chỉ |
| **Người bán (`seller`)** | `auramall_seller` | `seller@auramall.vn` | `0912345678` | Kênh người bán, đăng sản phẩm, upload ảnh, xem doanh thu shop |
| **Quản trị viên (`admin`)** | `auramall_admin` | `admin@auramall.vn` | `0987654321` | Quản trị toàn sàn, duyệt đơn, hoàn kho, đổi quyền người dùng |

---

## CHƯƠNG 4: ĐẶC TẢ CHI TIẾT 8 PHÂN HỆ MÀN HÌNH & NGHIỆP VỤ

### 4.1. Phân hệ 1: Xác thực & Quản lý Định danh (Auth Portal)
- **Đăng ký:** Cho phép lựa chọn vai trò (Người mua / Người bán). Kiểm tra thời gian thực (Realtime Validation) mật khẩu tối thiểu 8 ký tự (chữ hoa, chữ thường, số), kiểm tra trùng lặp email và số điện thoại.
- **Đăng nhập linh hoạt:** Đăng nhập bằng Tên đăng nhập, Email hoặc Số điện thoại. Hỗ trợ ghi nhớ phiên đăng nhập và tự động chuyển hướng người dùng quay lại đúng sản phẩm đang xem dở trước khi đăng nhập.
- **Đăng nhập Google (GSI):** Tích hợp Google Identity Services; Backend tự động xác thực chữ ký RS256 của ID Token dựa trên khóa công khai trực tiếp từ Google OAuth2. Tự động liên kết tài khoản nếu email đã tồn tại hoặc tạo mới tài khoản an toàn.
- **Quên mật khẩu bằng Gmail API:** Nhập email $
ightarrow$ Hệ thống tạo Token 32-byte ngẫu nhiên, lưu mã băm SHA-256 vào bảng `password_resets` (hiệu lực 30 phút, giới hạn 3 lần/giờ chống brute-force) $
ightarrow$ Gửi email chứa liên kết an toàn trực tiếp qua **Gmail API (OAuth2 Desktop App Refresh Token)** chạy mượt mà trên Render Cloud gói Free (không bị chặn cổng SMTP 587 như trước).
- **Bảo mật giao diện:** Đã gỡ bỏ nút liên kết "Tài liệu API" công khai trên giao diện người dùng để đảm bảo an toàn thông tin, chỉ mở cho quản trị viên và kỹ sư phát triển qua đường dẫn `/api/docs/`.

### 4.2. Phân hệ 2: Trang Chủ & Duyệt Danh Mục Sản Phẩm (Catalog & Discovery)
- **Mega Menu Sản phẩm:** Thiết kế theo phong cách Lexus, phân chia trực quan theo từng tab danh mục với hình ảnh cắt vát nghệ thuật.
- **Bộ lọc đa tiêu chí (Sidebar):** 10 danh mục chủ đề (Điện thoại, Thời trang, Laptop, Âm thanh, Màn hình, Bàn ghế, Lưu trữ, Cáp sạc, Nhà thông minh, Gaming); lọc theo khoảng giá tùy chỉnh; lọc theo số sao đánh giá.
- **Công cụ Tìm kiếm thông minh:** Bảng tìm kiếm nổi bật với từ khóa gợi ý và trả kết quả tức thì.
- **Thanh sắp xếp sản phẩm:** Sắp xếp theo Phổ biến, Mới nhất, Bán chạy và một tab Giá duy nhất (chuyển đổi qua lại giữa tăng dần và giảm dần kèm mũi tên trực quan).
- **Phân trang (Pagination):** Chia trang 20 sản phẩm/trang, hỗ trợ chuyển trang mượt mà không reload trang.

### 4.3. Phân hệ 3: Chi Tiết Sản Phẩm (Product Details)
- **Bảo vệ thông tin:** Yêu cầu đăng nhập để xem thông tin chi tiết; khách chưa đăng nhập bấm vào sản phẩm sẽ được chuyển hướng tới trang đăng nhập rồi tự quay lại.
- **Bộ sưu tập ảnh đa góc độ:** Khung ảnh đại diện lớn bên trái kết hợp dải ảnh thu nhỏ (thumbnails) bên dưới; hỗ trợ rê chuột hoặc bấm để chuyển đổi ảnh mượt mà.
- **Quản lý tồn kho thực tế:** Hiển thị số lượng khả dụng thực tế. Nếu tồn kho bằng 0, hiển thị nhãn màu xám "Hết hàng" và tự động vô hiệu hóa bộ chọn số lượng cùng nút đặt hàng.
- **Hoạt ảnh giỏ hàng:** Nút "Thêm vào giỏ" kèm hiệu ứng hoạt ảnh sản phẩm bay vào icon giỏ hàng ở thanh tiêu đề và thông báo Toast; nút "Mua ngay" chuyển hướng thẳng tới quy trình thanh toán.

### 4.4. Phân hệ 4: Chi Tiết Giỏ Hàng (Cart Page)
- **Quản lý mục chọn:** Checkbox chọn tất cả, checkbox từng mặt hàng, hiển thị ảnh thu nhỏ, đơn giá, cụm nút tăng/giảm số lượng tự động cập nhật tổng tiền, nút xóa có Popup xác nhận.
- **Thanh tổng kết dính chân trang (Sticky Checkout Bar):** Cố định ở đáy màn hình, hiển thị tổng tiền thanh toán chỉ tính cho các sản phẩm đang được tích chọn, kèm nút "Mua hàng".

### 4.5. Phân hệ 5: Quy Trình Đặt Hàng & Thanh Toán (Checkout Workflow)
- **Địa chỉ giao hàng:** Tự động hiển thị địa chỉ nhận hàng mặc định của người mua; hỗ trợ Modal thêm mới hoặc chọn địa chỉ khác ngay tại màn hình thanh toán.
- **Thanh toán:** Hỗ trợ thanh toán khi nhận hàng (COD) và Chuyển khoản ngân hàng (VietQR chuẩn liên ngân hàng).
- **Giao dịch chống âm kho:** Backend thực thi `BEGIN TRANSACTION` $
ightarrow$ Khóa dòng sản phẩm `SELECT ... FOR UPDATE` $
ightarrow$ Kiểm tra `stock >= quantity` $
ightarrow$ Trừ kho `stock = stock - quantity` $
ightarrow$ Tạo bản ghi `orders` và `order_items` $
ightarrow$ `COMMIT`. Nếu hết hàng, lập tức `ROLLBACK` và trả về mã HTTP `409 Conflict`.

### 4.6. Phân hệ 6: Trung Tâm Tài Khoản Người Dùng (Account Center)
- **Hồ sơ & Avatar:** Cập nhật họ tên, email, số điện thoại, giới tính, ngày sinh. Tải lên và xem trước (Preview) ảnh đại diện ngay trên khung tròn.
- **Sổ địa chỉ:** Thêm, sửa, xóa và đặt địa chỉ mặc định. Có cơ chế bảo vệ: luôn giữ lại ít nhất 1 địa chỉ giao hàng, không cho xóa địa chỉ duy nhất.
- **Đổi mật khẩu:** Nhập mật khẩu hiện tại và mật khẩu mới (kiểm tra độ mạnh). Tài khoản đăng nhập qua Google chưa có mật khẩu được hỗ trợ đặt mật khẩu mới lần đầu.
- **Lịch sử mua hàng:** Tra cứu danh sách lịch sử tất cả các đơn hàng đã đặt kèm mã đơn, thời gian, sản phẩm và trạng thái vận chuyển.

### 4.7. Phân hệ 7: Kênh Người Bán Hàng (Seller Portal - `#/sell`)
- **Đăng bán:** Nhập tên, danh mục, giá bán, giá gốc (tự tính % giảm), số lượng tồn kho ban đầu, mô tả sản phẩm; hỗ trợ Xem trước thẻ sản phẩm (Live Card Preview) ngay khi nhập liệu.
- **Upload ảnh nhị phân CSDL:** Cho phép tải lên tối đa 8 ảnh/sản phẩm qua kéo thả thư mục, chọn file hoặc dán ảnh chụp màn hình (Ctrl+V). Ảnh được lưu trực tiếp vào CSDL PostgreSQL (bảng `uploaded_images`) dưới dạng nhị phân `BYTEA`, giúp các bản sao backend khi scale-out đều đọc được ngay mà không lo đồng bộ ổ đĩa.
- **Kho hàng shop:** Danh sách các sản phẩm do shop đăng bán, hỗ trợ sửa đổi thông tin hoặc xóa (sản phẩm đã phát sinh đơn mua sẽ bị khóa không cho xóa để bảo vệ dữ liệu doanh thu).
- **Doanh thu shop:** Thống kê doanh thu, đơn hoàn thành, đơn đang xử lý, số sản phẩm đã bán theo mốc 7/30/90 ngày. Tự động loại bỏ các đơn đã bị hủy. Bảng chi tiết từng sản phẩm kèm tỷ trọng đóng góp doanh thu.

### 4.8. Phân hệ 8: Quản Trị Hệ Thống Toàn Diện (Admin Portal - `#/admin`)
- **Tổng quan sàn:** Theo dõi các chỉ số sống còn của sàn: Tổng doanh thu toàn sàn, số lượng đơn theo từng trạng thái, số sản phẩm cảnh báo hết hàng, số người dùng theo từng vai trò.
- **Quản trị người dùng:** Tra cứu danh sách tài khoản, tìm kiếm theo tên/email/SĐT, thay đổi vai trò Người mua / Người bán / Quản trị viên trực tiếp trên bảng (có cơ chế chặn admin tự hạ quyền chính mình).
- **Quản trị sản phẩm:** Xem, chỉnh sửa hoặc xóa bất kỳ sản phẩm nào trên sàn để kiểm duyệt nội dung.
- **Quản trị đơn hàng & Tự động hoàn kho:** Lọc đơn theo trạng thái (Chờ xác nhận $\rightarrow$ Đã xác nhận $\rightarrow$ Đang giao $\rightarrow$ Hoàn thành). **ĐẶC BIỆT:** Khi quản trị viên chuyển trạng thái đơn sang "ĐÃ HỦY" (`CANCELLED`), hệ thống tự động cộng hoàn trả lại số lượng tồn kho vào sản phẩm tương ứng (`stock = stock + quantity`).
- **Doanh thu toàn sàn:** Báo cáo phân tích doanh thu chi tiết theo từng người bán và từng mặt hàng trên toàn bộ hệ thống.

---

## CHƯƠNG 5: THIẾT KẾ CƠ SỞ DỮ LIỆU & CHIẾN LƯỢC ĐÁNH CHỈ MỤC

### 5.1. Cấu trúc 8 bảng quan hệ thực thể (ERD)

| Tên bảng (Table) | Khóa chính (PK) | Khóa ngoại (FK) | Mục đích lưu trữ & Ghi chú kỹ thuật |
| :--- | :--- | :--- | :--- |
| **`categories`** | `id (SERIAL)` | Không | Lưu 10 danh mục chủ đề sản phẩm; icon; thứ tự hiển thị display_order. |
| **`users`** | `id (SERIAL)` | Không | Lưu tài khoản; email; phone; password_hash; role ('admin','seller','user'); google_sub. |
| **`user_addresses`** | `id (SERIAL)` | `user_id -> users(id)` | Sổ địa chỉ nhận hàng của người mua; đánh dấu địa chỉ mặc định is_default. |
| **`products`** | `id (SERIAL)` | `category_id`, `seller_id` | Thông tin sản phẩm; giá bán; tồn kho stock; đánh giá rating; ảnh image_url; seller_id. |
| **`orders`** | `id (SERIAL)` | `user_id`, `product_id` | Đơn hàng; mã đơn order_code; tổng tiền; trạng thái status; hình thức thanh toán COD/Bank. |
| **`order_items`** | `id (SERIAL)` | `order_id`, `product_id` | Chi tiết các mặt hàng trong đơn; số lượng quantity; đơn giá unit_price; thành tiền subtotal. |
| **`uploaded_images`** | `id (CHAR 32)` | `owner_id -> users(id)` | Ảnh sản phẩm người bán tải lên; lưu nhị phân BYTEA; phục vụ qua `GET /api/uploads/:id`. |
| **`password_resets`** | `id (SERIAL)` | `user_id -> users(id)` | Mã băm token_hash đặt lại mật khẩu; thời hạn expires_at (30 phút); used_at. |

### 5.2. Chiến lược 13 chỉ mục B-Tree hiệu năng cao
Hệ thống đã thiết lập sẵn 13 chỉ mục B-Tree tối ưu hóa truy vấn:
1. `idx_products_id`: Tối ưu hóa truy vấn chi tiết sản phẩm theo khóa chính.
2. `idx_products_category_id`: Tăng tốc lọc sản phẩm theo cây danh mục.
3. `idx_products_price`: Tối ưu hóa lọc theo khoảng giá và sắp xếp tăng/giảm.
4. `idx_products_rating`: Tăng tốc lọc sản phẩm theo số sao đánh giá.
5. `idx_products_sold_count`: Tối ưu hóa sắp xếp sản phẩm bán chạy nhất.
6. `idx_products_flash_sale`: Tăng tốc truy vấn các mặt hàng đang mở bán Flash Sale.
7. `idx_products_seller_id`: Tối ưu hóa truy vấn kho hàng của từng người bán.
8. `idx_orders_user_id`: Tăng tốc tra cứu lịch sử đơn hàng của người mua.
9. `idx_orders_product_id`: Tối ưu hóa truy vấn đơn hàng phục vụ tính doanh thu sản phẩm.
10. `idx_orders_created_at`: Tối ưu hóa báo cáo thống kê doanh thu theo mốc thời gian (7/30/90 ngày).
11. `idx_order_items_order_id`: Tăng tốc truy vấn danh sách mặt hàng thuộc về một đơn hàng.
12. `idx_user_addresses_user_id`: Tối ưu hóa truy vấn sổ địa chỉ người mua.
13. `idx_uploaded_images_owner` & `idx_password_resets_user`: Tối ưu hóa truy vấn ảnh và mã token đặt lại mật khẩu.

### 5.3. Lưu trữ ảnh nhị phân BYTEA trực tiếp trong CSDL
Thay vì lưu ảnh trên hệ thống tệp cục bộ (Local Filesystem) khiến các instance Backend khi mở rộng ngang (`scale backend=3`) không thể nhìn thấy ảnh của nhau, AuraMall áp dụng giải pháp lưu trữ ảnh nhị phân `BYTEA` trực tiếp vào bảng `uploaded_images` trong PostgreSQL. Khi người dùng truy cập ảnh qua URL `/api/uploads/:id`, Backend sẽ đọc luồng nhị phân từ PostgreSQL và trả về HTTP với header `Content-Type: image/jpeg` hoặc `image/png` kèm cache `Cache-Control: public, max-age=86400`.

---

## CHƯƠNG 6: KẾT LUẬN & HƯỚNG PHÁT TRIỂN

Qua quá trình khảo sát, phân tích nghiệp vụ và thiết kế chi tiết các chức năng, hệ thống **Thương mại Điện tử AuraMall (Đề tài 07)** đã hoàn thành xuất sắc các mục tiêu đề ra:
1. **Kiến trúc hạ tầng vững chắc:** Xây dựng thành công kiến trúc phân vùng mạng 3 tầng bảo mật, tích hợp Cloudflare Tunnel và đưa hệ thống vận hành thực tế tại tên miền **`https://duytu205.id.vn`**.
2. **Nghiệp vụ thương mại điện tử hoàn chỉnh:** Hiện thực hóa giao diện sang trọng phong cách Lexus, phân chia 3 vai trò RBAC chặt chẽ, hỗ trợ upload ảnh nhị phân BYTEA trực tiếp vào CSDL và tích hợp dịch vụ gửi email qua Gmail API mượt mà.
3. **Toàn vẹn dữ liệu và giao dịch:** Đảm bảo tính toàn vẹn giao dịch đặt hàng không bán âm kho trong môi trường giao dịch đồng thời với khóa dòng PostgreSQL `SELECT ... FOR UPDATE`.
4. **Hỗ trợ đa nền tảng linh hoạt:** Vận hành ổn định từ môi trường Docker Compose cục bộ, Cloudflare Tunnel bảo vệ tên miền đến Cloud Render và Vercel Serverless.

Tài liệu này là căn cứ kỹ thuật chính thức phục vụ công tác nghiệm thu, báo cáo bảo vệ đồ án trước hội đồng chấm thi chuyên ngành.
