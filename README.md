# ecommerce-infrastructure
Kế hoạch triển khai hệ thống hạ tầng TMĐT
# ĐỀ TÀI 07: THIẾT KẾ HẠ TẦNG CNTT CHO HỆ THỐNG TMĐT

Hệ thống mô phỏng kiến trúc 3 tầng phân vùng mạng:
* **Tầng 1 (Web):** Nginx Reverse Proxy & Static Web (Public Subnet - Cổng 80)
* **Tầng 2 (App):** Node.js Express API (Private Subnet - Cổng 5000 nội bộ)
* **Tầng 3 (Data):** PostgreSQL 15 (Private Subnet - Cổng 5432 nội bộ)

---

## 1. KHỞI ĐỘNG HỆ THỐNG (BẰNG 1 DÒNG LỆNH)

Đảm bảo Docker Desktop đang chạy, sau đó mở Terminal / PowerShell tại thư mục dự án và gõ:

```bash
docker compose up -d --build
```

Để kiểm tra trạng thái các container:
```bash
docker compose ps
```

Để xem log của hệ thống:
```bash
docker compose logs -f
```

Để dừng hệ thống:
```bash
docker compose down
```

---

## 2. NGHIỆM THU BÀI KIỂM THỬ KT1

Sau khi hệ thống khởi động:
1. **Truy cập Giao diện Web:** Mở trình duyệt vào địa chỉ [http://localhost](http://localhost)
   * Kiểm tra danh mục 20 sản phẩm hiển thị đầy đủ (Tác vụ Đọc).
   * Bấm nút "Mua" hoặc nhập ID bấm "Tạo đơn hàng" $\rightarrow$ Thấy thông báo thành công và tồn kho giảm đi (Tác vụ Ghi).
2. **Kiểm tra API bằng Thunder Client / Postman / cURL:**
   * Tác vụ Đọc: `GET http://localhost/api/products` (Mã 200)
   * Tác vụ Ghi: `POST http://localhost/api/orders` với body `{"productId": 1, "quantity": 1}` (Mã 201)
   * Kiểm tra sức khỏe: `GET http://localhost/health` (Mã 200)

---

## 3. KẾT NỐI DBEAVER ĐỂ XEM DỮ LIỆU CSDL (Dành cho SV3)

Mở DBeaver $\rightarrow$ New Database Connection $\rightarrow$ PostgreSQL:
* **Host:** `localhost`
* **Port:** `5432`
* **Database:** `ecommerce_db`
* **Username:** `ecommerce_user`
* **Password:** `ecommerce_secret`
* Bấm **Test Connection** $\rightarrow$ **Finish**.