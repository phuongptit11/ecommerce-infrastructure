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
1. [Google Cloud Console](https://console.cloud.google.com/auth/clients) → **Google Auth Platform** → **Clients** → **Create client** → loại **Web application**.
2. Mục **Authorized JavaScript origins** thêm `http://localhost` (thêm cả cổng nếu đổi `NGINX_PORT`, ví dụ `http://localhost:8080`) và `https://<tên miền>` nếu chạy bằng tên miền.
3. Chép Client ID vào file `.env`: `GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com`, rồi chạy lại `docker compose up -d`.
4. Để mọi tài khoản Google đăng nhập được: **Branding** điền trang chủ và chính sách quyền riêng tư (`https://<tên miền>/privacy.html`), rồi **Audience** → **Publish app**. Khi chưa publish, chỉ các email trong **Test users** đăng nhập được.

Chưa đặt `GOOGLE_CLIENT_ID` thì nút Google vẫn hiện nhưng báo chưa cấu hình; các chức năng khác không bị ảnh hưởng.

> Bản triển khai của nhóm: Google Cloud project `auramall-514516`, client "AuraMall Web" (đã publish), origin `http://localhost`, `http://localhost:8080`, `https://duytu205.id.vn`.

### Gửi email quên mật khẩu (tùy chọn)
Chức năng **Quên mật khẩu** gửi liên kết đặt lại qua email SMTP. Khai báo trong `.env` rồi chạy lại `docker compose up -d`:

```env
APP_URL=https://<tên miền>        # địa chỉ ghi trong liên kết; mặc định http://localhost
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<địa chỉ gmail>
SMTP_PASS=<mật khẩu ứng dụng 16 ký tự>
```

Với Gmail: bật Xác minh 2 bước rồi tạo **Mật khẩu ứng dụng** tại myaccount.google.com → Bảo mật (không dùng mật khẩu Gmail thật).
Chưa đặt `SMTP_HOST` thì email không gửi đi mà in ra log, xem liên kết bằng: `docker compose logs backend | grep reset-password`.

### Truy cập bằng tên miền qua Cloudflare Tunnel (tùy chọn)
Đưa web đang chạy trên máy ra Internet với HTTPS, **không cần IP tĩnh hay mở cổng router**: container `cloudflared` kết nối ra Cloudflare, Cloudflare chuyển truy cập của tên miền vào `http://nginx:80` nên vẫn đi qua đủ 3 tầng Nginx → Node.js → PostgreSQL.

1. Thêm tên miền vào Cloudflare (gói Free), đổi nameserver ở nhà đăng ký (Mắt Bão: Quản trị tên miền → Name Server → Sử dụng Name Server tùy chỉnh) sang 2 nameserver Cloudflare cấp. Cập nhật mất từ vài phút tới 24 giờ.
2. Cloudflare → **Networking** → **Tunnels** → **Create Tunnel** → chọn Docker, sao chép token vào `.env`: `CLOUDFLARE_TUNNEL_TOKEN=...`
3. Trong tunnel → **Routes** → **Add route** → **Published application**: tên miền, Service URL `http://nginx:80`.
4. Chạy kèm tunnel:
   ```bash
   docker compose --profile tunnel up -d
   ```
5. (Nên bật) SSL/TLS → Edge Certificates → **Always Use HTTPS**.

Web chỉ truy cập được qua tên miền khi máy đang bật và Docker đang chạy. Bản triển khai của nhóm: **https://duytu205.id.vn** (tunnel `auramall`).

### Deploy lên Render: web chạy 24/7 bằng tên miền, không cần bật máy (khuyên dùng)
Cloudflare Tunnel chỉ hoạt động khi máy đang bật. Muốn chỉ cần vào tên miền là dùng được, đưa web lên Render bằng file `render.yaml` (Blueprint):
- **auramall-db**: PostgreSQL 15 (tầng lưu trữ).
- **auramall**: Node.js phục vụ cả giao diện lẫn API (`SERVE_FRONTEND=true` thay vai trò Nginx). Lần khởi động đầu `scripts/init-cloud-db.js` tự nạp `schema.sql` + `seed.sql`.

1. Đẩy code (có `render.yaml`) lên GitHub.
2. [render.com](https://render.com) → đăng nhập bằng GitHub → **New** → **Blueprint** → chọn repo `ecommerce-infrastructure` và nhánh → điền các biến Render hỏi:
   `GOOGLE_CLIENT_ID`, `APP_URL=https://duytu205.id.vn`, `BREVO_API_KEY` và `MAIL_FROM` (để trống nếu chưa gửi email) → **Apply**.
   Vài phút sau web chạy tại `https://<tên-service>.onrender.com`.
3. Gắn tên miền: service **auramall** → **Settings** → **Custom Domains** → thêm `duytu205.id.vn`.
   Trên Cloudflare: **DNS** → sửa bản ghi `duytu205.id.vn` (đang trỏ tới tunnel `...cfargotunnel.com`) thành **CNAME** tới `<tên-service>.onrender.com`, **Proxy status: DNS only** cho tới khi Render báo chứng chỉ hợp lệ (sau đó có thể bật Proxied). Xóa route của tunnel và dừng tunnel trên máy: `docker compose --profile tunnel stop tunnel`.
4. Email quên mật khẩu: gói Free của Render chặn cổng SMTP, nên dùng [Brevo](https://www.brevo.com) (miễn phí 300 email/ngày): **Senders** → xác minh địa chỉ Gmail → **SMTP & API** → **API keys** → tạo key, điền vào `BREVO_API_KEY`, `MAIL_FROM=AuraMall <gmail-đã-xác-minh>`.

Giới hạn gói Free của Render: web "ngủ" sau 15 phút không có truy cập (lượt mở đầu tiên chờ khoảng 1 phút); CSDL Free hết hạn sau 30 ngày (có 14 ngày để nâng gói trước khi bị xóa). Muốn chạy lâu dài: nâng gói, hoặc dùng CSDL Neon miễn phí và đổi biến `DATABASE_URL` của service.

### Deploy lên Vercel (tùy chọn)
Vercel chỉ chạy web tĩnh + hàm serverless, không chạy Docker/Nginx/PostgreSQL, nên bản Vercel gồm: thư mục `frontend` (tĩnh), toàn bộ API Express chạy thành 1 hàm serverless (`api/index.js`, cấu hình trong `vercel.json`) và **PostgreSQL trên mây** (ví dụ Neon).

1. Tạo CSDL: Vercel → project → **Storage** → **Create Database** → **Neon** (gói Free), hoặc tạo trực tiếp tại neon.tech. Vercel tự thêm biến `DATABASE_URL`.
2. Nạp bảng và dữ liệu mẫu (chạy 1 lần từ máy, cần `cd backend && npm ci` trước):
   ```bash
   DATABASE_URL="postgres://...?sslmode=require" node scripts/init-cloud-db.js
   ```
3. Thêm biến môi trường trên Vercel: `JWT_SECRET` (chuỗi ngẫu nhiên dài), `GOOGLE_CLIENT_ID`, `APP_URL=https://<tên>.vercel.app`, các biến `SMTP_*` nếu dùng quên mật khẩu.
4. Deploy: `npx vercel --prod` (lần đầu `npx vercel login` và `npx vercel link`).
5. Thêm `https://<tên>.vercel.app` vào **Authorized JavaScript origins** của Google OAuth client.

Giới hạn khi chạy trên Vercel: mỗi request tối đa 4,5MB (ảnh lớn đã được giao diện tự thu nhỏ trước khi tải lên), không có Nginx nên không cân bằng tải/scale bằng `docker compose --scale` như bản Docker.

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

  | Chức năng | Khách | Người mua (`user`) | Người bán (`seller`) | Quản trị (`admin`) |
  |-----------|:-----:|:------------------:|:--------------------:|:------------------:|
  | Xem trang chủ, danh sách, tìm kiếm | ✓ | ✓ | ✓ | ✓ |
  | Xem chi tiết sản phẩm | đăng nhập | ✓ | ✓ | ✓ |
  | Giỏ hàng | ✓ (giỏ tạm) | ✓ | – | – |
  | Thanh toán, đơn mua, sổ địa chỉ | – | ✓ | – | – |
  | Hồ sơ, ảnh đại diện, đổi mật khẩu | – | ✓ | ✓ | ✓ |
  | Đăng bán, sửa/xóa sản phẩm | – | – | sản phẩm của mình | mọi sản phẩm |
  | Doanh thu theo sản phẩm | – | – | sản phẩm của mình | toàn sàn (kèm người bán) |
  | Đơn hàng | đơn của mình | – | đơn có sản phẩm của shop | mọi đơn, đổi trạng thái |
  | Người dùng & phân quyền, thống kê | – | – | – | ✓ |

  Người bán và quản trị **không mua hàng** (backend trả `403` khi đặt hàng, xem đơn mua, sổ địa chỉ). Menu, nút "Thêm vào giỏ / Mua ngay" và biểu tượng giỏ hàng tự ẩn/hiện theo vai trò; vào trang không đủ quyền sẽ hiện thông báo "Không có quyền truy cập" kèm đường dẫn tới trang đúng với vai trò.
* **Giỏ hàng lưu riêng từng tài khoản** trên trình duyệt (`auramall_cart:u<id>`, khách: `auramall_cart:guest`): đăng xuất hay tạo tài khoản mới sẽ không thấy giỏ của người trước. Khách thêm hàng rồi mới đăng nhập/đăng ký tài khoản người mua thì giỏ tạm được gộp vào giỏ của tài khoản đó.
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
  * Ghi nhớ đăng nhập (Remember me).
  * **Quên mật khẩu**: nhập email → nhận liên kết đặt lại qua email (hiệu lực 30 phút, dùng 1 lần) → đặt mật khẩu mới và đăng nhập luôn. Không tiết lộ email nào đã đăng ký; mỗi tài khoản tối đa 3 yêu cầu/giờ.
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
* Trang `#/sell`: đăng bán sản phẩm mới với tên, danh mục, giá bán, giá gốc (tự tính % giảm), tồn kho, hình ảnh và mô tả; **xem trước thẻ sản phẩm** ngay khi nhập.
* **Hình ảnh sản phẩm** (tối đa 8, ảnh đầu tiên là ảnh chính): **tải ảnh từ máy** (chọn nhiều ảnh cùng lúc, kéo thả từ thư mục hoặc Ctrl+V ảnh chụp màn hình) hoặc dán link http(s). Ảnh JPG/PNG/WEBP tối đa 5MB, ảnh lớn được trình duyệt tự thu nhỏ còn cạnh dài 1600px trước khi gửi. Đổi thứ tự, đặt ảnh chính, xóa ảnh ngay trên lưới ảnh.
  * Ảnh lưu trong PostgreSQL (bảng `uploaded_images`) nên mọi bản sao backend khi scale đều đọc được và được sao lưu cùng `scripts/backup.sh`; ảnh tải lên mà không sản phẩm nào dùng sẽ tự xóa sau 1 ngày.
* Tab "Sản phẩm của tôi": danh sách sản phẩm đã đăng, sửa, xóa (sản phẩm đã có đơn hàng thì không xóa được, chỉ đặt tồn kho về 0).
* Tab "Doanh thu": doanh thu, đã hoàn thành, đang xử lý, số sản phẩm đã bán (tính trên đơn thật, không tính đơn hủy), lọc 7/30/90 ngày; bảng từng sản phẩm với số lượng bán, số đơn, doanh thu và tỷ trọng. Quản trị viên xem bảng tương tự cho toàn sàn tại `#/admin/revenue`.
* Tab "Đơn hàng của shop": các đơn có sản phẩm của shop (người nhận, địa chỉ giao, trạng thái) kèm số đơn, số sản phẩm đã bán và doanh thu.
* API: `POST/PUT/DELETE /api/products`, `POST /api/uploads/images`, `GET /api/user/products`, `GET /api/seller/revenue`, `GET /api/seller/orders`; người mua gọi sẽ bị từ chối (403), người bán chỉ sửa/xóa được sản phẩm của mình.

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
