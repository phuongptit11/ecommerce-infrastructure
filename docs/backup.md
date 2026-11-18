# HƯỚNG DẪN SAO LƯU, PHỤC HỒI & KIỂM THỬ DỮ LIỆU CSDL AURAMALL
**Dự án:** Hệ thống Thương mại Điện tử Đa tầng AuraMall (Đề tài 07)  
**Công nghệ lưu trữ:** PostgreSQL 15 trong Docker Container (`ecommerce_database`)  
**Nguyên tắc vận hành:** Độc lập tuyệt đối, không can thiệp hay sửa đổi mã nguồn dự án  

---

## 1. TỔNG QUAN KIẾN TRÚC & CHIẾN LƯỢC SAO LƯU

Hệ thống AuraMall được thiết kế theo kiến trúc 3 tầng bảo mật:
* **Tầng 1 (Web Tier):** Nginx đóng vai trò Reverse Proxy & Cân bằng tải.
* **Tầng 2 (App Tier):** Cụm Node.js Express xử lý nghiệp vụ & kết nối CSDL qua Connection Pool.
* **Tầng 3 (Data Tier):** CSDL PostgreSQL 15 phân vùng trong mạng riêng (`private_net`), chỉ mở cổng nội bộ 5432 cho Backend và `127.0.0.1:5432` cho máy chủ quản trị nội bộ.

```
[ Internet / Khách hàng ]
           │
           ▼
┌──────────────────────────────────────────────┐
│ TẦNG 1: Nginx Web Server (ecommerce_nginx)   │
└──────────────────────┬───────────────────────┘
                       │ (public_net)
                       ▼
┌──────────────────────────────────────────────┐
│ TẦNG 2: Ứng dụng Backend Node.js             │
└──────────────────────┬───────────────────────┘
                       │ (private_net)
                       ▼
┌──────────────────────────────────────────────┐
│ TẦNG 3: PostgreSQL Database (ecommerce_db)   │
│         Lưu trữ 8 bảng nghiệp vụ             │
└──────────────────────────────────────────────┘
                       ▲
                       │ (Docker Exec Pipe)
┌──────────────────────────────────────────────┐
│ HẠ TẦNG SAO LƯU & PHỤC HỒI (scripts/)        │
│ • backup.sh / restore.sh                     │
│ • verify-backup.ps1 / verify-backup.sh       │
└──────────────────────────────────────────────┘
```

### 1.1. Phạm vi dữ liệu cần bảo vệ (8 Bảng ERD Cốt lõi)
1. **`categories`**: Danh mục sản phẩm, biểu tượng và thứ tự hiển thị.
2. **`users`**: Tài khoản khách hàng, người bán, quản trị viên, thông tin xác thực.
3. **`user_addresses`**: Sổ địa chỉ giao hàng của người mua.
4. **`products`**: Danh mục sản phẩm, giá bán, tồn kho, ảnh, đánh giá.
5. **`orders`**: Thông tin đơn đặt hàng, trạng thái thanh toán, tổng tiền.
6. **`order_items`**: Chi tiết từng món hàng trong đơn đặt hàng.
7. **`uploaded_images`**: Dữ liệu nhị phân (BYTEA) ảnh tải lên máy chủ.
8. **`password_resets`**: Mã băm token khôi phục mật khẩu.

### 1.2. Chiến lược sao lưu
* **Phương thức:** Sao lưu logic toàn phần (Full Logical Backup) sử dụng tiện ích `pg_dump` với tùy chọn `--clean --if-exists`.
* **Định dạng:** Tệp nén định dạng `gzip` (`.sql.gz`), giúp tiết kiệm đến 80-90% dung lượng lưu trữ so với tệp `.sql` thuần.
* **Chính sách lưu trữ (Retention Policy):** Tự động dọn dẹp các bản sao lưu cũ hơn **7 ngày** để tối ưu hóa không gian đĩa cứng máy chủ.

---

## 2. CÁC CHỈ SỐ NGHIỆM THU KỸ THUẬT (SRE / DEVOPS METRICS)

Trong quản trị hạ tầng và an toàn thông tin, kiểm thử sao lưu bắt buộc phải nghiệm thu 4 chỉ số cốt lõi:

| Chỉ số | Tên đầy đủ | Ý nghĩa kỹ thuật | Tiêu chuẩn nghiệm thu AuraMall |
| :--- | :--- | :--- | :--- |
| **RTO** | *Recovery Time Objective* | Thời gian tối đa để khôi phục hoàn toàn CSDL kể từ lúc xảy ra sự cố. | $< 30$ giây (Thực tế: $\approx 1 - 2$ giây) |
| **RPO** | *Recovery Point Objective* | Mức độ tổn thất dữ liệu tối đa chấp nhận được tính theo thời gian. | $0$ giây tại thời điểm snapshot |
| **Data Integrity** | *Tính toàn vẹn dữ liệu* | Tính chính xác của khóa chính, khóa ngoại và số lượng bản ghi của 8 bảng. | Khớp $100\%$ số lượng bản ghi giữa CSDL gốc và phục hồi |
| **App Availability** | *Tính sẵn sàng ứng dụng* | Khả năng tự phục hồi kết nối của Backend mà không cần khởi động lại. | HTTP 200 OK trên các API sau khi Restore |

---

## 3. HƯỚNG DẪN SAO LƯU CƠ SỞ DỮ LIỆU (BACKUP)

### 3.1. Chạy bằng kịch bản Shell Script (Git Bash / Linux / macOS)
Sử dụng kịch bản có sẵn tại [scripts/backup.sh](file:///d:/ecommerce-infrastructure/scripts/backup.sh):

```bash
bash scripts/backup.sh
```

**Cơ chế hoạt động của script:**
1. Kiểm tra container `ecommerce_database` có đang chạy hay không.
2. Tự động tạo thư mục `./database/backups` nếu chưa tồn tại.
3. Kích hoạt `pg_dump` bên trong container với người dùng `ecommerce_user` và cơ sở dữ liệu `ecommerce_db`.
4. Nén luồng dữ liệu theo thời gian thực qua `gzip` thành tệp:  
   `./database/backups/auramall_backup_YYYYMMDD_HHMMSS.sql.gz`.
5. Tự động quét và xóa các bản sao lưu có tuổi thọ trên 7 ngày (`find -mtime +7 -exec rm`).

### 3.2. Chạy trực tiếp bằng Windows PowerShell
Nếu đang sử dụng Windows PowerShell mà không cài Git Bash:

```powershell
# Tạo thư mục lưu trữ nếu chưa có
if (-not (Test-Path ".\database\backups")) { New-Item -ItemType Directory -Path ".\database\backups" }

# Đặt tên tệp theo mốc thời gian hiện tại
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = ".\database\backups\auramall_backup_$timestamp.sql"

# Thực thi pg_dump trong container và lưu về máy host
docker exec ecommerce_database pg_dump -U ecommerce_user -d ecommerce_db --clean --if-exists -f /tmp/backup.sql
docker cp ecommerce_database:/tmp/backup.sql $backupFile
docker exec ecommerce_database rm -f /tmp/backup.sql

Write-Host "Sao lưu thành công: $backupFile" -ForegroundColor Green
```

### 3.3. Kiểm tra tính hợp lệ của tệp sao lưu vừa tạo
Trước khi lưu trữ hoặc chuyển sang bước phục hồi, kiểm tra tệp sao lưu:
* Đảm bảo kích thước tệp lớn hơn 0 byte: `ls -lh ./database/backups/`
* Nếu là tệp `.gz`, chạy lệnh kiểm tra cấu trúc nén:
  ```bash
  gzip -t ./database/backups/auramall_backup_*.sql.gz
  echo $? # Trả về 0 nghĩa là tệp toàn vẹn, không bị hỏng byte
  ```

---

## 4. HƯỚNG DẪN PHỤC HỒI CƠ SỞ DỮ LIỆU (RESTORE)

> [!WARNING]
> Thao tác phục hồi sẽ ghi đè toàn bộ dữ liệu hiện có trong cơ sở dữ liệu đích bằng dữ liệu từ bản sao lưu. Hãy đảm bảo bạn đã chọn đúng tệp sao lưu trước khi xác nhận.

### 4.1. Chạy bằng kịch bản Shell Script (Git Bash / Linux / macOS)
Sử dụng kịch bản có sẵn tại [scripts/restore.sh](file:///d:/ecommerce-infrastructure/scripts/restore.sh):

```bash
bash scripts/restore.sh ./database/backups/auramall_backup_20261116_233000.sql.gz
```
Hệ thống sẽ hiển thị cảnh báo và yêu cầu xác nhận `(y/N)`. Nhập `y` để tiến hành.

### 4.2. Chạy trực tiếp bằng Windows PowerShell
```powershell
$backupFile = ".\database\backups\<TEN_TEP_BACKUP>.sql"

# Copy tệp vào container và nạp vào PostgreSQL
docker cp $backupFile ecommerce_database:/tmp/restore.sql
docker exec ecommerce_database psql -U ecommerce_user -d ecommerce_db -f /tmp/restore.sql
docker exec ecommerce_database rm -f /tmp/restore.sql

Write-Host "Phục hồi CSDL thành công hoàn tất!" -ForegroundColor Green
```

---

## 5. QUY TRÌNH KIỂM THỬ SAO LƯU & PHỤC HỒI DỮ LIỆU

### KỊCH BẢN A: KIỂM THỬ ĐỘC LẬP AN TOÀN (SHADOW RECOVERY - KHUYẾN NGHỊ CAO NHẤT)

Đây là giải pháp kiểm thử chuẩn DevOps/SRE: Khôi phục bản sao lưu sang một CSDL thử nghiệm độc lập (`ecommerce_verify_test`) ngay trên container hiện có.  
**Lợi ích:** CSDL sản xuất `ecommerce_db` vẫn hoạt động liên tục 100%, không bị gián đoạn hay mất dữ liệu.

```
┌────────────────────────────────────────────────────────┐
│               PostgreSQL Container                     │
│                                                        │
│   ┌────────────────────┐      ┌────────────────────┐   │
│   │    CSDL CHÍNH      │      │   CSDL KIỂM THỬ    │   │
│   │  (ecommerce_db)    │      │(ecommerce_verify_  │   │
│   │                    │      │       test)        │   │
│   └─────────┬──────────┘      └─────────▲──────────┘   │
│             │                           │              │
│       [1. pg_dump]                [3. Restore]         │
│             │                           │              │
└─────────────┼───────────────────────────┼──────────────┘
              ▼                           │
     Tệp Backup (.sql.gz) ────────────────┘
              │
              ▼
   [4. Đối soát số dòng 8 bảng] (CSDL Chính == CSDL Kiểm thử?)
```

#### Quy trình 6 bước thực hiện thủ công:

1. **Bước 1: Thu thập số lượng bản ghi của 8 bảng từ CSDL gốc:**
   ```bash
   docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "
   SELECT 'categories' AS tbl, COUNT(*) FROM categories
   UNION ALL SELECT 'users', COUNT(*) FROM users
   UNION ALL SELECT 'user_addresses', COUNT(*) FROM user_addresses
   UNION ALL SELECT 'products', COUNT(*) FROM products
   UNION ALL SELECT 'orders', COUNT(*) FROM orders
   UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
   UNION ALL SELECT 'uploaded_images', COUNT(*) FROM uploaded_images
   UNION ALL SELECT 'password_resets', COUNT(*) FROM password_resets
   ORDER BY 1;"
   ```

2. **Bước 2: Tạo bản sao lưu mới:**
   ```bash
   bash scripts/backup.sh
   ```

3. **Bước 3: Tạo CSDL thử nghiệm độc lập:**
   ```bash
   docker exec -i ecommerce_database psql -U ecommerce_user -d postgres -c "DROP DATABASE IF EXISTS ecommerce_verify_test;"
   docker exec -i ecommerce_database psql -U ecommerce_user -d postgres -c "CREATE DATABASE ecommerce_verify_test OWNER ecommerce_user;"
   ```

4. **Bước 4: Nạp tệp sao lưu vào CSDL thử nghiệm (Bấm giờ đo RTO):**
   ```bash
   gunzip -c ./database/backups/<TEN_TEP_BACKUP>.sql.gz | docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_verify_test
   ```

5. **Bước 5: Thống kê số lượng bản ghi trên CSDL thử nghiệm để đối chiếu:**
   ```bash
   docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_verify_test -c "
   SELECT 'categories' AS tbl, COUNT(*) FROM categories
   UNION ALL SELECT 'users', COUNT(*) FROM users
   UNION ALL SELECT 'user_addresses', COUNT(*) FROM user_addresses
   UNION ALL SELECT 'products', COUNT(*) FROM products
   UNION ALL SELECT 'orders', COUNT(*) FROM orders
   UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
   UNION ALL SELECT 'uploaded_images', COUNT(*) FROM uploaded_images
   UNION ALL SELECT 'password_resets', COUNT(*) FROM password_resets
   ORDER BY 1;"
   ```
   *So khớp kết quả giữa Bước 1 và Bước 5: Số lượng bản ghi của tất cả 8 bảng phải trùng khớp 100%.*

6. **Bước 6: Dọn dẹp CSDL thử nghiệm:**
   ```bash
   docker exec -i ecommerce_database psql -U ecommerce_user -d postgres -c "DROP DATABASE IF EXISTS ecommerce_verify_test;"
   ```

---

### KỊCH BẢN B: MÔ PHỎNG THẢM HỌA THỰC TẾ (DISASTER SIMULATION)

Kịch bản này sử dụng để trình chiếu demo hoặc kiểm thử tính năng phục hồi khi hệ thống thực sự gặp sự cố mất dữ liệu.

1. **Bước 1: Tạo bản ghi đối chứng (Canary Record):**
   ```bash
   docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "
   INSERT INTO categories (name, slug, icon, display_order) 
   VALUES ('CANARY_TEST_DANH_MUC', 'canary-test', '🧪', 999);"
   ```

2. **Bước 2: Kích hoạt sao lưu snapshot:**
   ```bash
   bash scripts/backup.sh
   # Tệp tạo ra ví dụ: auramall_backup_20261117_001500.sql.gz
   ```

3. **Bước 3: Giả lập sự cố mất dữ liệu nghiêm trọng:**
   ```bash
   docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "
   DELETE FROM categories WHERE slug = 'canary-test';
   TRUNCATE TABLE password_resets CASCADE;
   "
   ```
   Kiểm tra lại: Bản ghi `canary-test` đã biến mất hoàn toàn (`COUNT = 0`).

4. **Bước 4: Phục hồi lại từ bản sao lưu:**
   ```bash
   bash scripts/restore.sh ./database/backups/auramall_backup_20261117_001500.sql.gz
   ```

5. **Bước 5: Nghiệm thu kết quả:**
   ```bash
   docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "
   SELECT id, name, slug FROM categories WHERE slug = 'canary-test';"
   ```
   *Kết quả: Bản ghi đối chứng xuất hiện trở lại đầy đủ.*

6. **Bước 6: Kiểm tra tính sẵn sàng của ứng dụng Web & Backend:**
   Truy cập trình duyệt hoặc gọi API:
   * `curl http://localhost/api/products` $\rightarrow$ Trả về JSON danh sách sản phẩm HTTP 200.
   * `curl http://localhost/health` $\rightarrow$ Trả về `{"status":"ok"}`.

7. **Bước 7: Dọn dẹp bản ghi kiểm chứng sau khi hoàn tất:**
   ```bash
   docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "
   DELETE FROM categories WHERE slug = 'canary-test';"
   ```

---

## 6. SỬ DỤNG BỘ SCRIPT TỰ ĐỘNG HÓA KIỂM THỬ (AUTOMATED SCRIPTS)

Để tự động hóa hoàn toàn quy trình kiểm thử cách ly (Shadow Testing) trên chỉ với **1 câu lệnh duy nhất**, hai kịch bản tự động đã được lập trình sẵn trong thư mục `scripts/`:

### 6.1. Dành cho Windows PowerShell: [scripts/verify-backup.ps1](file:///d:/ecommerce-infrastructure/scripts/verify-backup.ps1)
Mở cửa sổ PowerShell tại thư mục dự án và chạy:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup.ps1
```

### 6.2. Dành cho Git Bash / Linux: [scripts/verify-backup.sh](file:///d:/ecommerce-infrastructure/scripts/verify-backup.sh)
Mở Git Bash tại thư mục dự án và chạy:
```bash
chmod +x ./scripts/verify-backup.sh
./scripts/verify-backup.sh
```

### 6.3. Bảng đầu ra kết quả kiểm thử mẫu từ script
```text
================================================================================
   AURAMALL - BẮT ĐẦU QUY TRÌNH KIỂM THỬ SAO LƯU & PHỤC HỒI CSDL
================================================================================
Thời gian bắt đầu: Tue Nov 17 00:20:00 +07 2026
Container mục tiêu: ecommerce_database
Database gốc:       ecommerce_db
Database kiểm thử:  ecommerce_verify_test (Môi trường cách ly an toàn)
--------------------------------------------------------------------------------
[OK] Container database đang hoạt động bình thường.

>> [BƯỚC 1/6] Đang thu thập số lượng bản ghi của 8 bảng trong CSDL gốc...
   - Bảng categories        :     10 bản ghi
   - Bảng order_items       :     15 bản ghi
   - Bảng orders            :      8 bản ghi
   - Bảng password_resets   :      0 bản ghi
   - Bảng products          :     40 bản ghi
   - Bảng uploaded_images   :      0 bản ghi
   - Bảng user_addresses    :      5 bản ghi
   - Bảng users             :      6 bản ghi

>> [BƯỚC 2/6] Đang thực hiện sao lưu (pg_dump + gzip)...
[OK] Sao lưu hoàn tất trong 1 giây.
     Tệp tạo thành: ./database/backups/auramall_test_backup_20261117_002001.sql.gz (Dung lượng: 12K)

>> [BƯỚC 3/6] Kiểm tra tính toàn vẹn của tệp nén gzip...
[OK] Tệp sao lưu nén nguyên vẹn, không bị lỗi cấu trúc byte.

>> [BƯỚC 4/6] Chuẩn bị môi trường CSDL độc lập (ecommerce_verify_test)...
[OK] Đã tạo CSDL thử nghiệm: ecommerce_verify_test

>> [BƯỚC 5/6] Đang phục hồi dữ liệu vào CSDL kiểm thử (Đo RTO)...
[OK] Phục hồi hoàn tất! Chỉ số RTO (Thời gian phục hồi): 1.15 giây.

>> [BƯỚC 6/6] Đối soát tính nhất quán dữ liệu giữa CSDL gốc và CSDL phục hồi...
--------------------------------------------------------------------------------
Tên Bảng             | CSDL Gốc        | CSDL Phục Hồi   | Kết Quả   
--------------------------------------------------------------------------------
categories           | 10              | 10              | PASS      
order_items          | 15              | 15              | PASS      
orders               | 8               | 8               | PASS      
password_resets      | 0               | 0               | PASS      
products             | 40              | 40              | PASS      
uploaded_images      | 0               | 0               | PASS      
user_addresses       | 5               | 5               | PASS      
users                | 6               | 6               | PASS      
--------------------------------------------------------------------------------

>> Đang dọn dẹp cơ sở dữ liệu kiểm thử...
[OK] Đã xóa ecommerce_verify_test, giữ nguyên trạng 100% CSDL sản xuất.

================================================================================
  KẾT LUẬN KIỂM THỬ: >> ĐẠT YÊU CẦU (PASSED) <<
  - Toàn bộ 8 bảng nghiệp vụ khớp 100% dữ liệu.
  - Thời gian sao lưu: 1.00s
  - Thời gian phục hồi (RTO): 1.15s
  - Kích thước bản sao lưu: 12K
  - Mức độ mất mát dữ liệu (RPO): 0% tại thời điểm sao lưu.
================================================================================
```

---

## 7. BẢNG BÁO CÁO NGHIỆM THU KIỂM THỬ (TEST REPORT TEMPLATE)

Bạn có thể sử dụng bảng tổng kết này để đưa vào báo cáo nghiệm thu kỹ thuật hoặc slide bảo vệ đề tài:

| Hạng mục kiểm thử | Giá trị mục tiêu (Target) | Kết quả đo đạc thực tế | Trạng thái |
| :--- | :--- | :--- | :---: |
| **Tính hợp lệ của tệp sao lưu** | Tệp tồn tại, kích thước $> 0$, gzip hợp lệ | Tệp `.sql.gz` nguyên vẹn (`gzip -t` mã `0`) | **ĐẠT (PASS)** |
| **Thời gian tạo bản sao lưu** | $< 10$ giây | $1.00$ giây | **ĐẠT (PASS)** |
| **Thời gian phục hồi CSDL (RTO)** | $< 30$ giây | $1.15$ giây | **ĐẠT (PASS)** |
| **Tổn thất dữ liệu khi sự cố (RPO)** | $0$ bản ghi tại thời điểm snapshot | $0$ bản ghi ($RPO = 0s$) | **ĐẠT (PASS)** |
| **Toàn vẹn bảng `categories`** | Khớp $100\%$ | $10 / 10$ bản ghi | **ĐẠT (PASS)** |
| **Toàn vẹn bảng `users`** | Khớp $100\%$ | $6 / 6$ bản ghi | **ĐẠT (PASS)** |
| **Toàn vẹn bảng `products`** | Khớp $100\%$ | $40 / 40$ bản ghi | **ĐẠT (PASS)** |
| **Toàn vẹn bảng `orders`** | Khớp $100\%$ | $8 / 8$ bản ghi | **ĐẠT (PASS)** |
| **Toàn vẹn bảng `order_items`** | Khớp $100\%$ | $15 / 15$ bản ghi | **ĐẠT (PASS)** |
| **Toàn vẹn các bảng phụ (`addresses`, `resets`, `images`)** | Khớp $100\%$ | Khớp hoàn toàn với CSDL gốc | **ĐẠT (PASS)** |
| **Tính sẵn sàng ứng dụng sau Restore** | Backend & Web chạy bình thường | API `/api/products` và `/health` HTTP 200 | **ĐẠT (PASS)** |
| **Nguyên tắc can thiệp mã nguồn** | Không sửa code hệ thống | $0$ tệp mã nguồn bị thay đổi | **ĐẠT (PASS)** |

---

## 8. XỬ LÝ SỰ CỐ THƯỜNG GẶP (TROUBLESHOOTING)

| Lỗi phát sinh | Nguyên nhân | Cách khắc phục |
| :--- | :--- | :--- |
| `Container ecommerce_database không hoạt động` | Dịch vụ database trong Docker chưa được bật | Chạy: `docker compose up -d database` rồi thử lại. |
| `FATAL: role "postgres" does not exist` | Chạy lệnh `psql` với cờ mặc định của postgres | Luôn chỉ định rõ `-U ecommerce_user` trong mọi câu lệnh `psql`. |
| `database "ecommerce_verify_test" is being accessed by other users` | Còn session đang kết nối vào DB kiểm thử | Chạy lệnh ngắt kết nối: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'ecommerce_verify_test';` rồi xóa DB. |
| `gzip: stdin: unexpected end of file` | Luồng ghi file bị gián đoạn do thiếu bộ nhớ hoặc tắt terminal sớm | Xóa file lỗi trong `./database/backups` và chạy lại lệnh backup. |
