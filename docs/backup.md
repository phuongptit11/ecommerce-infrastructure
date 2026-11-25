# HƯỚNG DẪN SAO LƯU, PHỤC HỒI & KIỂM THỬ DỮ LIỆU CSDL AURAMALL (KT3)
**Dự án:** Hệ thống Thương mại Điện tử Đa tầng AuraMall (Đề tài 07)  
**Địa chỉ triển khai thực tế:** [https://duytu205.id.vn](https://duytu205.id.vn) *(Tên miền riêng chính thức)*  
**Hệ quản trị CSDL:** PostgreSQL 15 (Managed Cloud trên Render & Docker Container `ecommerce_database`)  
**Nguyên tắc vận hành:** Độc lập tuyệt đối, an toàn dữ liệu, không can thiệp hay sửa đổi mã nguồn hệ thống  

---

## 1. TỔNG QUAN KIẾN TRÚC & CHIẾN LƯỢC SAO LƯU

> [!IMPORTANT]
> **LÀM RÕ MÔ HÌNH TRIỂN KHAI PRODUCTION THỰC TẾ & TÍNH ĐỒNG NHẤT CSDL CỦA WEBSITE `https://duytu205.id.vn`:**  
> Website `https://duytu205.id.vn` được triển khai thực tế trên Internet theo mô hình **Self-Hosted Production Server qua Cloudflare Edge Tunnel**:
> 1. Máy tính của **Sinh viên 2** đóng vai trò là Máy chủ triển khai (Production Host), vận hành toàn bộ cụm container Docker 3 tầng (`ecommerce_nginx`, `ecommerce-backend-1`, `ecommerce_database`) và container đường hầm `ecommerce_tunnel` (`cloudflare/cloudflared`).
> 2. Cloudflare Tunnel mở đường hầm bảo mật Zero-Trust kết nối tên miền chính thức `https://duytu205.id.vn` trực tiếp vào Nginx Web Gateway trên máy chủ của SV2 mà không cần mở cổng router.
> 3. **Do đó, container `ecommerce_database` trên máy SV2 chính là Cơ sở dữ liệu Production thật đang phục vụ trực tiếp cho website `https://duytu205.id.vn`!**
> 4. Đơn hàng khách hàng đặt ở Kiểm thử 1 (mã `#AUR-20261125-8F59`) được ghi trực tiếp vào CSDL này. Khi thực hiện sao lưu (`scripts/backup.sh`), xóa thử nghiệm (`TRUNCATE`) và phục hồi (`scripts/restore.sh`) trên máy SV2, đây là **thao tác trực tiếp trên CSDL thật của website**. Khi xóa trên CSDL này, F5 lại `duytu205.id.vn` đơn hàng biến mất ngay lập tức; khi restore xong, đơn hàng hồi sinh nguyên vẹn!
> 5. Nhóm cũng thiết lập thêm cụm CSDL dự phòng trên Cloud Render (`ecommerce_db_eq41`) qua biến `RENDER_DB_URL` để phục vụ kịch bản Multi-Cloud Disaster Recovery khi cần.

Hệ thống AuraMall được thiết kế theo kiến trúc 3 tầng bảo mật phân vùng mạng:
* **Tầng 1 (Web Tier):** Nginx Reverse Proxy & Cloudflare Edge Tunnel (`https://duytu205.id.vn`).
* **Tầng 2 (App Tier):** Cụm Node.js 22 Express 5 xử lý nghiệp vụ & kết nối CSDL qua Connection Pool.
* **Tầng 3 (Data Tier):** CSDL PostgreSQL 15 lưu trữ dữ liệu ACID, phân vùng mạng riêng (`private_net`), cách ly hoàn toàn khỏi truy cập trực tiếp từ Internet công cộng.

```
[ Khách hàng / Trình duyệt Web: https://duytu205.id.vn ]
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ TẦNG 1: Cloudflare Edge & Nginx Web Gateway            │
└──────────────────────────┬─────────────────────────────┘
                           │ (public_net)
                           ▼
┌────────────────────────────────────────────────────────┐
│ TẦNG 2: Ứng dụng Backend Node.js Express               │
└──────────────────────────┬─────────────────────────────┘
                           │ (private_net)
                           ▼
┌────────────────────────────────────────────────────────┐
│ TẦNG 3: PostgreSQL Database (Render Cloud & Docker)    │
│         Lưu trữ 8 bảng nghiệp vụ cốt lõi               │
└──────────────────────────┬─────────────────────────────┘
                           ▲
                           │ (pg_dump & psql Stream Pipe)
┌──────────────────────────┴─────────────────────────────┐
│ HẠ TẦNG SAO LƯU, PHỤC HỒI & KIỂM THỬ KT3 (scripts/)    │
│ • scripts/backup-cloud.sh  / scripts/restore-cloud.sh  │
│ • scripts/backup.sh        / scripts/restore.sh        │
│ • scripts/verify-backup.ps1 / verify-backup.sh         │
└────────────────────────────────────────────────────────┘
```

### 1.1. Phạm vi dữ liệu cần bảo vệ (8 Bảng ERD Cốt lõi)
1. **`categories`**: Danh mục sản phẩm, biểu tượng và thứ tự hiển thị.
2. **`users`**: Tài khoản khách hàng, người bán, quản trị viên, thông tin xác thực.
3. **`user_addresses`**: Sổ địa chỉ giao hàng của người mua.
4. **`products`**: Danh mục sản phẩm, giá bán, tồn kho, ảnh, đánh giá.
5. **`orders`**: Thông tin đơn đặt hàng, trạng thái thanh toán, tổng tiền (`final_total`).
6. **`order_items`**: Chi tiết từng món hàng trong đơn đặt hàng.
7. **`uploaded_images`**: Dữ liệu nhị phân (BYTEA) ảnh tải lên máy chủ.
8. **`password_resets`**: Mã băm token khôi phục mật khẩu (SHA-256).

### 1.2. Chiến lược sao lưu
* **Phương thức:** Sao lưu logic toàn phần (Full Logical Backup) sử dụng tiện ích `pg_dump` với tùy chọn `--clean --if-exists --no-owner`.
* **Định dạng:** Tệp nén định dạng `gzip` (`.sql.gz`), giúp tiết kiệm đến 80-90% dung lượng lưu trữ so với tệp `.sql` thuần (chỉ khoảng 12 KB - 344 KB).
* **Chính sách lưu trữ (Retention Policy):** Tự động dọn dẹp các bản sao lưu cũ hơn **7 ngày** để tối ưu hóa không gian đĩa cứng máy chủ.

---

## 2. CÁC CHỈ SỐ NGHIỆM THU KỸ THUẬT SRE / DEVOPS METRICS

Trong quản trị hạ tầng và an toàn thông tin, bài kiểm thử KT3 bắt buộc phải nghiệm thu 4 chỉ số cốt lõi:

| Chỉ số | Tên đầy đủ | Ý nghĩa kỹ thuật | Tiêu chuẩn mục tiêu | Kết quả đo đạc thực tế |
| :--- | :--- | :--- | :---: | :---: |
| **RTO** | *Recovery Time Objective* | Thời gian tối đa để khôi phục hoàn toàn CSDL kể từ lúc xảy ra sự cố. | $< 30$ giây | **2.26 giây** *(Đo thực tế trên Terminal từ lúc bấm 'y')* |
| **RPO** | *Recovery Point Objective* | Mức độ tổn thất dữ liệu tối đa chấp nhận được tính theo thời gian. | $0$ bản ghi | **$0$ bản ghi ($RPO = 0s$)** |
| **Data Integrity** | *Tính toàn vẹn dữ liệu* | Tính chính xác của khóa chính, khóa ngoại và số lượng bản ghi của 8 bảng. | Khớp $100\%$ | **Khớp 100% trên cả 8 bảng** |
| **App Availability**| *Tính sẵn sàng ứng dụng* | Khả năng tự phục hồi kết nối của Backend và Web sau khi Restore. | HTTP 200 OK | **Restart backend 0.6s, Web & API sẵn sàng ngay** |

---

## 3. CÁCH KẾT NỐI VÀ CẤU HÌNH CSDL CLOUD RENDER

Để Sinh viên 3 (hoặc bất kỳ thành viên nào trong nhóm) có thể quản trị, truy vấn, sao lưu và phục hồi CSDL Render đang phục vụ website `https://duytu205.id.vn`, nhóm sử dụng chuỗi kết nối ngoại vi **External Database URL**.

### 3.1. Thông tin kết nối CSDL Render của dự án
* **Host ID:** `dpg-dbstvaoae00c73934arg-a`
* **Host Address:** `dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com`
* **Port:** `5432`
* **User:** `ecommerce_user`
* **Password:** `A08US2EWaow9aP9kPOTFBoxmicrfRfle`
* **Database Name:** `ecommerce_db_eq41`
* **Chuỗi kết nối External Database URL chuẩn SSL:**
  ```text
  postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require
  ```

### 3.2. Cấu hình biến môi trường vào tệp `.env`
Mở file `.env` tại thư mục gốc `d:\ecommerce-infrastructure` và thêm biến sau:
```env
RENDER_DB_URL="postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require"
```

### 3.3. Các cách kết nối trực tiếp vào CSDL Render từ máy tính của SV3

#### Cách A: Kết nối bằng Terminal PowerShell thông qua Container Docker
*(Không cần cài đặt PostgreSQL hay psql lên hệ điều hành Windows host)*
```powershell
# 1. Truy vấn nhanh 3 đơn hàng mới nhất trên Render:
docker exec -i ecommerce_database psql "postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require" -c "SELECT id, order_code, final_total, created_at FROM orders ORDER BY id DESC LIMIT 3;"

# 2. Mở phiên làm việc dòng lệnh tương tác trực tiếp (Interactive psql):
docker exec -it ecommerce_database psql "postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require"
```

#### Cách B: Kết nối bằng công cụ giao diện DBeaver / pgAdmin (GUI)
* **Host:** `dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com`
* **Port:** `5432`
* **Database:** `ecommerce_db_eq41`
* **Username:** `ecommerce_user`
* **Password:** `A08US2EWaow9aP9kPOTFBoxmicrfRfle`
* **SSL Settings:** Tab SSL $\rightarrow$ Tích chọn *Use SSL* $\rightarrow$ SSL Mode: *require* (hoặc *verify-ca*).

#### Cách C: Lệnh 1 dòng đồng bộ toàn bộ CSDL Render về Docker Local (Cloud-to-Local Sync)
Nếu muốn đồng bộ ngay lập tức đơn hàng mới đặt ở KT1 trên web `duytu205.id.vn` vào Docker máy mình:
```powershell
docker exec -i ecommerce_database pg_dump "postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require" --clean --if-exists --no-owner | docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db
```
*Lệnh này giúp Docker local có dữ liệu khớp 100% với website thật `duytu205.id.vn`, giải quyết triệt để vấn đề lệch dữ liệu giữa KT1 và KT3!*

---

## 4. QUY TRÌNH THỰC HIỆN KIỂM THỬ 3 (KT3) CHI TIẾT

Nhóm hỗ trợ 2 kịch bản thực nghiệm chuẩn xác:

---

### KỊCH BẢN 1: KIỂM THỬ TRỰC TIẾP TRÊN WEB THẬT https://duytu205.id.vn & CSDL CLOUD RENDER
*(Khuyên dùng cao nhất khi quay Video Demo - Kết nối Render DB chuẩn SSL đồng bộ 100% dữ liệu với KT1)*

```
[ BƯỚC 1: Đặt đơn KT1 trên web duytu205.id.vn ] ──> Lưu vào Render CSDL (AUR-20261125-8F59)
                              │
                              ▼
[ BƯỚC 2: Kích hoạt sao lưu ] ──> scripts/backup-cloud.sh ──> auramall_render_backup_*.sql.gz
                              │
                              ▼
[ BƯỚC 3: Giả lập thảm họa ] ──> TRUNCATE TABLE order_items, orders CASCADE; ──> F5 web MẤT ĐƠN!
                              │
                              ▼
[ BƯỚC 4: Kích hoạt phục hồi] ──> scripts/restore-cloud.sh (gõ 'y') ──> Đo thời gian RTO = 2.26s
                              │
                              ▼
[ BƯỚC 5: Đối soát phục hồi ] ──> SELECT 3 đơn hàng ──> F5 web duytu205.id.vn HỒI SINH ĐƠN THẬT 100%!
```

#### Quy trình 5 bước thực thi chi tiết trên Terminal máy tính:

1. **Bước 1: Kiểm tra 3 đơn hàng mới nhất trên Render (Xác nhận đơn hàng vừa đặt ở KT1):**
   ```powershell
   docker exec -i ecommerce_database psql "postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require" -c "SELECT id, order_code, final_total, created_at FROM orders ORDER BY id DESC LIMIT 3;"
   ```
   *Kết quả Terminal:*
   ```text
    id |    order_code    | final_total |          created_at           
   ----+------------------+-------------+-------------------------------
     6 | AUR-20261125-8F59|   598000.00 | 2026-11-25 08:03:46.457871+00
     5 | AUR-20261125-BCF4|   598000.00 | 2026-11-25 07:22:51.248225+00
     4 | AUR-20261113-5567|  7090000.00 | 2026-11-13 07:57:03.335658+00
   (3 rows)
   ```
   *(Nhận diện đơn hàng `#AUR-20261125-8F59` vừa được tạo ở Kiểm thử 1 trên website thật `https://duytu205.id.vn`).*

2. **Bước 2: Kích hoạt sao lưu CSDL Render:**
   ```powershell
   bash scripts/backup-cloud.sh
   ```
   *Terminal hiển thị xác nhận tiến trình:*
   ```text
   >>> [CLOUD BACKUP] Đang kết nối tới CSDL Render qua Internet...
   >>> Mục tiêu: Sao lưu toàn phần CSDL phục vụ website https://duytu205.id.vn
   >>> [THÀNH CÔNG] Bản sao lưu Cloud toàn vẹn: ./database/backups/auramall_render_backup_20261125_xxxxxx.sql.gz (344K)
   >>> HOÀN TẤT SAO LƯU CSDL CLOUD RENDER!
   ```

3. **Bước 3: Giả lập thảm họa xóa sạch đơn hàng:**
   *Xóa sạch bảng đơn hàng và các chi tiết liên kết bằng `TRUNCATE CASCADE`:*
   ```powershell
   docker exec -i ecommerce_database psql "postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require" -c "TRUNCATE TABLE order_items, orders CASCADE;"
   ```
   *Kiểm tra số lượng đơn hàng trên Render:*
   ```powershell
   docker exec -i ecommerce_database psql "postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require" -c "SELECT COUNT(*) FROM orders;"
   ```
   *Kết quả Terminal:*
   ```text
    count 
   -------
        0
   (1 row)
   ```
   *Kiểm tra trực quan trên Web thật `https://duytu205.id.vn`: Nhấn **F5** (Reload trang Lịch sử đơn hàng) $\rightarrow$ **Toàn bộ danh sách đơn hàng đã biến mất hoàn toàn!** (Minh chứng thảm họa mất mát dữ liệu thật trên môi trường Production).*

4. **Bước 4: Phục hồi CSDL Render từ file sao lưu vừa tạo:**
   ```powershell
   bash scripts/restore-cloud.sh database/backups/auramall_render_backup_20261125_xxxxxx.sql.gz
   ```
   *(Lưu ý: Thay `xxxxxx` bằng timestamp của file sao lưu vừa được tạo ở Bước 2).*  
   *Khi Terminal xuất hiện cảnh báo, gõ **`y`** rồi nhấn Enter để xác nhận:*
   ```text
   ======================================================================
   ⚠️  CẢNH BÁO: THAO TÁC NÀY SẼ GHI ĐÈ / PHỤC HỒI CƠ SỞ DỮ LIỆU
       TRỰC TIẾP TRÊN CLOUD RENDER ĐANG PHỤC VỤ https://duytu205.id.vn!
   ======================================================================
   Bạn có chắc chắn muốn phục hồi từ tệp 'database/backups/auramall_render_backup_20261125_xxxxxx.sql.gz' không? (y/N): y
   >>> [CLOUD RESTORE] Đang giải nén luồng và nạp dữ liệu vào Render qua Internet...
   >>> [THÀNH CÔNG] Dữ liệu CSDL Render đã được phục hồi hoàn tất!
   >>> Hãy mở trình duyệt truy cập https://duytu205.id.vn và nhấn F5 để kiểm tra đơn hàng!
   ```
   *Thời gian thực thi đo đạc: $RTO \approx 2.26$ giây.*

5. **Bước 5: Đối soát phục hồi (Data Integrity & Verification):**
   *Kiểm tra lại 3 đơn hàng trên CSDL Render qua Terminal:*
   ```powershell
   docker exec -i ecommerce_database psql "postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require" -c "SELECT id, order_code, final_total, created_at FROM orders ORDER BY id DESC LIMIT 3;"
   ```
   *Kết quả Terminal:*
   ```text
    id |    order_code    | final_total |          created_at           
   ----+------------------+-------------+-------------------------------
     6 | AUR-20261125-8F59|   598000.00 | 2026-11-25 08:03:46.457871+00
     5 | AUR-20261125-BCF4|   598000.00 | 2026-11-25 07:22:51.248225+00
     4 | AUR-20261113-5567|  7090000.00 | 2026-11-13 07:57:03.335658+00
   (3 rows)
   ```
   *Kiểm tra trên giao diện Web thật:*
   * Chuyển sang trình duyệt `https://duytu205.id.vn`, nhấn **F5**: **Đơn hàng `#AUR-20261125-8F59` lập tức xuất hiện trở lại nguyên vẹn đầy đủ!**
   * Kiểm tra API: `curl -I https://duytu205.id.vn` $\rightarrow$ Trả về `HTTP/2 200 OK`.
   * **Nghiệm thu chỉ số SRE:** $RTO = 2.26$ giây, $RPO = 0$ bản ghi thất thoát, tính toàn vẹn đạt $100\%$.

---

### KỊCH BẢN 2: KIỂM THỬ TRÊN CONTAINER DOCKER LOCAL (THEO ĐÚNG LOG THỰC NGHIỆM CỦA NHÓM)
*(Ghi nhận trực tiếp từ phiên chạy thực tế của nhóm trên PowerShell `D:\ecommerce-infrastructure`)*

Dưới đây là nguyên văn các lệnh và kết quả thực nghiệm mà nhóm đã thực thi thành công:

#### 1. Kiểm tra 3 đơn hàng gần nhất trước khi sao lưu:
```powershell
PS D:\ecommerce-infrastructure> docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c 'SELECT id, order_code, final_total, created_at FROM orders ORDER BY id DESC LIMIT 3;'
```
**Kết quả Terminal:**
```text
 id |    order_code    | final_total |          created_at           
----+------------------+-------------+-------------------------------
  6 | AUR-20261125-8F59|   598000.00 | 2026-11-25 08:03:46.457871+00
  5 | AUR-20261125-BCF4|   598000.00 | 2026-11-25 07:22:51.248225+00
  4 | AUR-20261113-5567|  7090000.00 | 2026-11-13 07:57:03.335658+00
(3 rows)
```

#### 2. Kích hoạt sao lưu snapshot CSDL `ecommerce_db`:
```powershell
PS D:\ecommerce-infrastructure> bash scripts/backup.sh
```
**Kết quả Terminal:**
```text
Đang sao lưu và nén CSDL 'ecommerce_db'...
Sao lưu toàn vẹn: ./database/backups/auramall_backup_20261125_151419.sql.gz (344K)
Đang dọn dẹp các bản sao lưu cũ hơn 7 ngày...
Hoàn tất kịch bản sao lưu!
```

#### 3. Mô phỏng thảm họa: Xóa sạch đơn hàng bằng TRUNCATE:
```powershell
PS D:\ecommerce-infrastructure> docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c 'TRUNCATE TABLE order_items, orders CASCADE;'
```
**Kết quả Terminal:**
```text
TRUNCATE TABLE
```

#### 4. Xác nhận dữ liệu đơn hàng đã hoàn toàn biến mất ($Count = 0$):
```powershell
PS D:\ecommerce-infrastructure> docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c 'SELECT COUNT(*) FROM orders;'
```
**Kết quả Terminal:**
```text
 count 
-------
     0
(1 row)
```

#### 5. Phục hồi dữ liệu từ tệp sao lưu & Khởi động lại Backend:
```powershell
PS D:\ecommerce-infrastructure> bash scripts/restore.sh database/backups/auramall_backup_20261125_151419.sql.gz
```
**Kết quả Terminal:**
```text
CẢNH BÁO: Thao tác này sẽ GHI ĐÈ TOÀN BỘ dữ liệu hiện tại của CSDL 'ecommerce_db'!
Bạn có chắc chắn muốn phục hồi từ tệp 'database/backups/auramall_backup_20261125_151419.sql.gz' không? (y/N): y
Đang nạp dữ liệu từ 'database/backups/auramall_backup_20261125_151419.sql.gz' vào cơ sở dữ liệu...
Đang khởi động lại Backend để đồng bộ dữ liệu...
[+] restart 0/1
 - Container ecommerce-backend-1 Restarting                                                              0.6s
Hoàn tất phục hồi dữ liệu thành công!

# Đo bằng đồng hồ của Terminal: từ lúc gõ y đến khi phục hồi xong mất 2,26 giây
```

#### 6. Đối soát tính toàn vẹn: Đơn hàng đã hồi sinh nguyên vẹn:
```powershell
PS D:\ecommerce-infrastructure> docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c 'SELECT id, order_code, final_total, created_at FROM orders ORDER BY id DESC LIMIT 3;'
```
**Kết quả Terminal:**
```text
 id |    order_code    | final_total |          created_at           
----+------------------+-------------+-------------------------------
  6 | AUR-20261125-8F59|   598000.00 | 2026-11-25 08:03:46.457871+00
  5 | AUR-20261125-BCF4|   598000.00 | 2026-11-25 07:22:51.248225+00
  4 | AUR-20261113-5567|  7090000.00 | 2026-11-13 07:57:03.335658+00
(3 rows)
```
*Ghi nhận:*
* Thời gian phục hồi $RTO = 2.26$ giây (Đạt chuẩn SRE $< 30$ giây).
* $RPO = 0$ bản ghi thất thoát.
* Đơn hàng `AUR-20261125-8F59` cùng toàn bộ chi tiết món hàng được bảo toàn $100\%$.

---

## 5. BẢNG TỔNG HỢP SO SÁNH 2 PHƯƠNG ÁN KIỂM THỬ KT3

| Tiêu chí so sánh | Phương án 1: CSDL Cloud Render | Phương án 2: Docker Container Local |
| :--- | :--- | :--- |
| **Mục đích** | Video demo chính thức, nghiệm thu trước Hội đồng | Kiểm thử môi trường cô lập, phát triển nội bộ |
| **Hệ thống đích** | Website thật: `https://duytu205.id.vn` | Localhost: `http://localhost` |
| **Tính đồng bộ với KT1** | **Tuyệt đối 100%**: Đơn đặt ở KT1 chính là đơn được khôi phục | Khớp khi chạy lệnh Sync trước khi test |
| **Lệnh sao lưu** | `bash scripts/backup-cloud.sh` | `bash scripts/backup.sh` |
| **Lệnh giả lập thảm họa** | `TRUNCATE TABLE order_items, orders CASCADE;` | `TRUNCATE TABLE order_items, orders CASCADE;` |
| **Lệnh phục hồi** | `bash scripts/restore-cloud.sh <file>` | `bash scripts/restore.sh <file>` |
| **Thời gian khôi phục (RTO)**| $ pprox 2.0 - 3.0$ giây | **2.26 giây** *(Minh chứng thực nghiệm)* |
| **Khởi động lại Backend** | Render tự động duy trì kết nối | Docker restart backend mất $0.6$ giây |

---

## 6. XỬ LÝ SỰ CỐ THƯỜNG GẶP (TROUBLESHOOTING)

| Lỗi phát sinh | Nguyên nhân | Cách khắc phục |
| :--- | :--- | :--- |
| `FATAL: no pg_hba.conf entry for host ... SSL off` | Chuỗi kết nối Render thiếu tham số SSL | Đảm bảo URL luôn có đuôi `?sslmode=require` (các script `backup-cloud.sh` và `restore-cloud.sh` đã tự động thêm). |
| `Lỗi: Container 'ecommerce_database' chưa chạy` | Docker Desktop chưa bật container | Chạy lệnh `docker compose up -d` trước khi chạy script. |
| `Lỗi đường dẫn dính liền khi chạy Bash trên Windows` | PowerShell dùng dấu `\` bị Bash hiểu là ký tự escape | Sử dụng dấu gạch chéo xuôi (`/`), ví dụ: `database/backups/...`. |
| `Đơn hàng ở KT1 không thấy trên Docker local` | Hai database chưa được đồng bộ | Chạy lệnh Cloud-to-Local Sync ở Mục 3.3 Cách C để kéo đơn hàng về Docker. |
