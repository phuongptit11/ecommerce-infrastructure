# HỆ THỐNG HẠ TẦNG THƯƠNG MẠI ĐIỆN TỬ AURAMALL
## ĐỀ TÀI 07: THIẾT KẾ HẠ TẦNG CNTT CHO HỆ THỐNG TMĐT

Hệ thống mô phỏng kiến trúc hạ tầng TMĐT phân vùng mạng 3 tầng chuyên nghiệp, đáp ứng các tiêu chuẩn bảo mật, cân bằng tải và khả năng chịu tải Flash Sale (k6 load testing):
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
5. **Live Server (`ritwickdey.liveserver`)**:
   - Khởi chạy nhanh và xem trước giao diện frontend nếu chạy độc lập mà không dùng Docker.
6. **Prettier - Code formatter (`esbenp.prettier-vscode`)**:
   - Tự động định dạng mã nguồn HTML, CSS, JavaScript, JSON và Markdown chuẩn chỉ.

> **Mẹo cài nhanh bằng dòng lệnh Terminal:**
> ```bash
> code --install-extension hediet.vscode-drawio
> code --install-extension humao.rest-client
> code --install-extension ms-azuretools.vscode-docker
> code --install-extension mtxr.sqltools
> ```

---

## 2. KHỞI ĐỘNG HỆ THỐNG (BẰNG 1 DÒNG LỆNH)

Đảm bảo Docker Desktop đang chạy, sau đó mở Terminal / PowerShell tại thư mục dự án và gõ:

```bash
docker compose up -d --build
```

Sau khi khởi động:
* **Trang web:** [http://localhost](http://localhost)
* **Tài liệu API (Swagger UI):** [http://localhost/api/docs/](http://localhost/api/docs/), bấm **Authorize** và dán token lấy từ `POST /api/auth/login` để thử các API cần đăng nhập.

> CSDL tạo từ bản cũ vẫn dùng được: khi khởi động, backend tự thêm cột mới (`products.seller_id`, `users.role`, `users.google_sub`), tạo 2 tài khoản mẫu người bán/quản trị và đổi ảnh mẫu cũ (link Unsplash, một số đã hỏng) sang ảnh lưu tại `frontend/images/products/`.

### Bật đăng nhập bằng Google (tùy chọn)
1. Vào [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create credentials** → **OAuth client ID** → loại **Web application**.
2. Mục **Authorized JavaScript origins** thêm `http://localhost` (thêm cả cổng nếu đổi `NGINX_PORT`, ví dụ `http://localhost:8080`).
3. Chép Client ID vào file `.env`: `GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com`, rồi chạy lại `docker compose up -d`.

Chưa đặt `GOOGLE_CLIENT_ID` thì nút Google vẫn hiện nhưng báo chưa cấu hình; các chức năng khác không bị ảnh hưởng.

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
*(Thêm cờ `-v` nếu muốn xóa volume để khởi tạo lại CSDL từ đầu: `docker compose down -v`)*

---

## 3. CÁC MÀN HÌNH & NGHIỆP VỤ HỆ THỐNG (THEO BẢN THIẾT KẾ AURAMALL)

Giao diện lấy cảm hứng từ phong cách trang Lexus: tông đen / than / trắng với điểm nhấn vàng đồng, chữ hoa giãn rộng (font Montserrat + Be Vietnam Pro, hỗ trợ tiếng Việt), khung ảnh cắt chéo, banner trình diễn sản phẩm, menu "Sản phẩm" dạng mega menu theo danh mục (giống menu "Mẫu xe"), hiệu ứng màn chắn nghiêng khi chuyển trang, nội dung hiện dần khi cuộn và vệt sáng lướt qua nút khi rê chuột.

* Ứng dụng một trang (`frontend/index.html`, `app.js`, `styles.css`), định tuyến bằng hash: `#/`, `#/products`, `#/product/:id`, `#/cart`, `#/checkout`, `#/login`, `#/register`, `#/account/:tab`, `#/sell`, `#/admin/:tab` nên nút Back/F5 hoạt động bình thường.
* **Phân quyền 3 vai trò** (kiểm tra ở cả backend lẫn giao diện):

  | Vai trò | Được làm |
  |---------|----------|
  | Khách | Xem trang chủ, danh sách sản phẩm, giỏ hàng; phải đăng nhập mới xem chi tiết sản phẩm và thanh toán |
  | Người mua (`user`) | Xem chi tiết, mua hàng, hồ sơ, đổi mật khẩu, sổ địa chỉ, đơn mua |
  | Người bán (`seller`) | Như người mua + kênh người bán: đăng/sửa/xóa sản phẩm của mình, xem đơn hàng của shop |
  | Quản trị (`admin`) | Mọi quyền + trang quản trị: thống kê, phân quyền người dùng, quản lý mọi sản phẩm và đơn hàng |

  Menu và liên kết tự ẩn/hiện theo vai trò; vào trang không đủ quyền sẽ hiện thông báo "Không có quyền truy cập".
* Hiển thị tốt trên điện thoại (menu và bộ lọc dạng ngăn kéo), tôn trọng chế độ giảm chuyển động của hệ điều hành.

Hệ thống gồm 8 phân hệ màn hình chuẩn TMĐT:

### 1. Phân hệ Xác thực (Auth: Đăng ký & Đăng nhập)
* **Bố cục 2 cột**: Cột trái là banner giới thiệu Flash Sale và các ưu đãi đặc quyền; cột phải là Form thao tác.
* **Màn hình Đăng ký**:
  * Chọn loại tài khoản **Người mua / Người bán**, nhập Tên đăng nhập, Email, Số điện thoại, Mật khẩu, Nhập lại mật khẩu; hoặc đăng ký nhanh bằng Google.
  * **Realtime Validation**: Kiểm tra mật khẩu đạt chuẩn tối thiểu 8 ký tự, gồm ít nhất 1 chữ hoa, 1 chữ thường và 1 số; kiểm tra khớp mật khẩu ngay khi gõ.
  * Checkbox đồng ý Điều khoản dịch vụ; chuyển đổi nhanh sang màn Đăng nhập.
* **Màn hình Đăng nhập**:
  * Đăng nhập linh hoạt bằng Tên đăng nhập / Email / Số điện thoại.
  * Ghi nhớ đăng nhập (Remember me), Quên mật khẩu (liên hệ quản trị viên).
  * **Đăng nhập với Google**: nút chính thức của Google; backend kiểm tra chữ ký ID token, email đã có tài khoản thì liên kết, chưa có thì tạo tài khoản mới.
  * Tự động lưu JWT Token và điều hướng quay lại trang người dùng đang duyệt dở (ví dụ trang chi tiết sản phẩm vừa bấm).

### 2. Trang Chủ & Danh Mục Sản Phẩm (Luồng Nghiệp vụ 1: `GET /api/products`)
* **Header**:
  * Logo thương hiệu `auramall`.
  * Menu "Sản phẩm": mỗi danh mục là một tab, hiển thị sản phẩm kèm "Giá từ" và ô ảnh cắt chéo dẫn tới danh mục.
  * Tìm kiếm: bảng tìm kiếm với gợi ý từ khóa hot và kết quả hiện ngay khi gõ.
  * Icon giỏ hàng với Badge số lượng; hover hiển thị Popover xem nhanh 3 sản phẩm gần nhất kèm nút "Xem giỏ hàng".
  * Khu vực tài khoản: Hover hiển thị menu Đăng nhập/Đăng ký khi chưa login; hiển thị Tên, Avatar và menu điều hướng khi đã login.
* **Cột bên trái (Bộ lọc)**:
  * Cây danh mục 10 chủ đề: Điện thoại, Thời trang, Laptop, Âm thanh, Màn hình, Bàn ghế, Lưu trữ, Cáp sạc, Nhà thông minh, Gaming.
  * Lọc theo khoảng giá từ - đến và nút Áp dụng.
  * Lọc theo đánh giá sao (5 sao, 4 sao trở lên, 3 sao trở lên...).
* **Khu vực nội dung chính**:
  * Thanh sắp xếp: Phổ biến, Mới nhất, Bán chạy và một tab **Giá** duy nhất (bấm lần đầu: thấp đến cao, bấm tiếp: cao đến thấp, mũi tên chỉ chiều đang sắp).
  * Thẻ sản phẩm: Tỉ lệ ảnh 1:1 có hiệu ứng zoom nhẹ khi hover, tag giảm giá, tag Flash Sale, tên sản phẩm tự động cắt bằng `...` sau 2 dòng, giá thực tế màu đỏ nổi bật, sao đánh giá và tổng lượt bán.
  * Phân trang: Chia cụm 20 sản phẩm/1 trang (LIMIT 20 trong truy vấn backend).

### 3. Chi Tiết Sản Phẩm (Product Detail)
* **Cần đăng nhập** mới xem được; khách bấm vào sản phẩm sẽ được chuyển tới trang đăng nhập rồi quay lại đúng sản phẩm.
* Khung ảnh đại diện lớn bên trái + dải thumbnail nhỏ bên dưới (hover/click chuyển đổi ảnh).
* Tên sản phẩm to rõ, số sao trung bình, lượt đánh giá và lượt bán.
* Khung giá bán nổi bật kèm giá gốc gạch ngang.
* Trạng thái kho hàng: Còn hàng (x sản phẩm có sẵn) hoặc nhãn màu xám "Hết hàng".
* Bộ chọn số lượng: Giới hạn tối thiểu 1 và tối đa tồn kho thực tế. Vô hiệu hóa (disabled) khi hết hàng.
* Nút "Thêm vào giỏ hàng" kèm **hiệu ứng bay sản phẩm vào giỏ hàng ở header** và Toast thông báo; nút "Mua ngay" điều hướng thẳng tới giỏ hàng/thanh toán.

### 4. Chi Tiết Giỏ Hàng (Cart Page)
* Bảng danh sách: Checkbox chọn tất cả, checkbox từng mặt hàng, ảnh thu nhỏ, đơn giá, cụm tăng/giảm số lượng tự động tính lại tổng tiền, nút xóa có Popup xác nhận.
* Thanh tổng kết cố định đáy màn hình (Sticky Bar): Hiển thị tổng thanh toán cho N sản phẩm được tích chọn.
* Nút "Mua hàng": Nếu chưa chọn sản phẩm nào sẽ bật popup nhắc nhở; nếu đã chọn sẽ chuyển sang màn hình Thanh toán.

### 5. Màn Hình Thanh Toán (Luồng Nghiệp vụ 2: `POST /api/orders`)
* Khối địa chỉ nhận hàng: Hiển thị địa chỉ mặc định, kèm modal thêm/sửa địa chỉ.
* Khối sản phẩm thanh toán: Tóm tắt các sản phẩm đã tích chọn (read-only).
* Khối ghi chú cho người bán và khối phương thức thanh toán (COD / Chuyển khoản VietQR).
* Nút "Đặt hàng": Gửi request tạo đơn hàng với giao dịch Database trừ kho nguyên tử (Atomic deduction with row lock).
  * Thành công (201): Bật popup "Đặt hàng thành công!" hiển thị mã đơn, nút Về trang chủ và Xem chi tiết đơn hàng.
  * Hết hàng (409): Hiển thị thông báo: *"rất tiếc, sản phẩm vừa hết hàng do số lượng có hạn!"*.

### 6. Trung Tâm Người Dùng (Account Center)
* **Tab Hồ sơ cá nhân**:
  * Tên đăng nhập cố định (readonly).
  * Email, Số điện thoại (validate 10-11 số), Giới tính (3 lựa chọn), Ngày sinh (DatePicker không vượt quá hiện tại).
  * Upload Avatar: Khung tròn hiển thị ảnh hiện tại, nút chọn ảnh từ máy tính, validate chỉ nhận `.png/.jpg/.jpeg` tối đa 2MB, **xem trước (preview) ảnh ngay lập tức trên khung tròn**.
  * Lưu cập nhật qua `PUT /api/user/profile` kèm Toast thông báo *"cập nhật hồ sơ thành công"*.
* **Tab Đổi mật khẩu**: nhập mật khẩu hiện tại và mật khẩu mới (kiểm tra độ mạnh ngay khi gõ); tài khoản tạo bằng Google chưa có mật khẩu thì đặt mật khẩu mới.
* **Tab Sổ địa chỉ**:
  * Danh sách địa chỉ nhận hàng, nhãn "Mặc định".
  * Thêm/Sửa địa chỉ.
  * Xóa địa chỉ: Bật dialog xác nhận; nếu chỉ còn 1 địa chỉ duy nhất sẽ khóa nút xóa kèm thông báo *"Cần ít nhất 1 địa chỉ nhận hàng"*.
  * Tự động đồng bộ với màn hình Thanh toán.
* **Tab Đơn mua**:
  * Tra cứu danh sách tất cả các đơn hàng đã đặt thành công.

### 7. Kênh Người Bán (chỉ tài khoản người bán và quản trị)
* Trang `#/sell`: đăng bán sản phẩm mới với tên, danh mục, giá bán, giá gốc (tự tính % giảm), tồn kho, link ảnh chính, ảnh phụ và mô tả; **xem trước thẻ sản phẩm** ngay khi nhập.
* Tab "Sản phẩm của tôi": danh sách sản phẩm đã đăng, sửa, xóa (sản phẩm đã có đơn hàng thì không xóa được, chỉ đặt tồn kho về 0).
* Tab "Đơn hàng của shop": các đơn có sản phẩm của shop (người nhận, địa chỉ giao, trạng thái) kèm số đơn, số sản phẩm đã bán và doanh thu.
* API: `POST/PUT/DELETE /api/products`, `GET /api/user/products`, `GET /api/seller/orders`; người mua gọi sẽ bị từ chối (403), người bán chỉ sửa/xóa được sản phẩm của mình.

### 8. Quản Trị Hệ Thống (chỉ quản trị viên, `#/admin`)
* **Tổng quan**: doanh thu (không tính đơn hủy), số đơn theo trạng thái, số sản phẩm/hết hàng, số người dùng theo quyền, đơn hàng mới nhất.
* **Người dùng & phân quyền**: lọc theo quyền, tìm theo tên/email/SĐT, đổi quyền Người mua / Người bán / Quản trị viên ngay trên bảng (không tự đổi quyền của mình được).
* **Sản phẩm**: toàn bộ sản phẩm trên sàn kèm người bán, sửa/xóa bất kỳ sản phẩm nào.
* **Đơn hàng**: lọc theo trạng thái, cập nhật trạng thái Chờ xác nhận → Đã xác nhận → Đang giao → Hoàn thành; **hủy đơn sẽ hoàn lại tồn kho**.

---

## 4. TÀI LIỆU KỸ THUẬT & HỢP ĐỒNG API

* **Hợp đồng API chi tiết:** [docs/api-contract.md](docs/api-contract.md)
* **Swagger UI:** [http://localhost/api/docs/](http://localhost/api/docs/) (đặc tả OpenAPI 3.0 trong [backend/openapi.js](backend/openapi.js))
* **Ảnh sản phẩm & nguồn ảnh:** [frontend/images/products/CREDITS.md](frontend/images/products/CREDITS.md)
* **Kịch bản kiểm thử API tự động (REST Client):** [docs/api-test.http](docs/api-test.http)
* **Sơ đồ kiến trúc hạ tầng Draw.io:** [docs/architecture.drawio](docs/architecture.drawio)
* **Kịch bản sao lưu CSDL:** `bash scripts/backup.sh`
* **Kịch bản phục hồi CSDL:** `bash scripts/restore.sh <file_backup>`

---

## 5. THÔNG TIN KẾT NỐI CƠ SỞ DỮ LIỆU (DBEAVER)

Mở DBeaver $\rightarrow$ New Database Connection $\rightarrow$ PostgreSQL:
* **Host:** `localhost`
* **Port:** `5432`
* **Database:** `ecommerce_db`
* **Username:** `ecommerce_user`
* **Password:** `ecommerce_secret`

**Tài khoản mẫu đã tạo sẵn (mật khẩu đều là `Password123`):**

| Vai trò | Tên đăng nhập | Email |
|---------|---------------|-------|
| Người mua | `auramall_user` | `user@auramall.vn` |
| Người bán | `auramall_seller` | `seller@auramall.vn` |
| Quản trị viên | `auramall_admin` | `admin@auramall.vn` |

Có thể đăng nhập bằng tên đăng nhập, email hoặc số điện thoại. Nên đổi mật khẩu các tài khoản này khi triển khai thật.
