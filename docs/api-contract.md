# HỢP ĐỒNG API (API CONTRACT) - HỆ THỐNG TMĐT AURAMALL

Tài liệu quy định chi tiết cấu trúc Request/Response giữa Frontend và Backend cho hệ thống TMĐT **auramall** (Đề tài 07).

- **Base URL (qua Nginx Reverse Proxy)**: `http://localhost`
- **Định dạng dữ liệu**: `application/json; charset=utf-8`
- **Tiêu chuẩn phản hồi (JSend Specification)**:
  - `status: "success"`: Thao tác thành công (200, 201)
  - `status: "fail"`: Lỗi do dữ liệu người dùng/client gửi lên (400, 401, 404, 409)
  - `status: "error"`: Lỗi hệ thống máy chủ nội bộ (500)
- **Xác thực**: Bearer JWT Token gửi qua Header: `Authorization: Bearer <token>`
- **Swagger UI**: [http://localhost/api/docs/](http://localhost/api/docs/) (thử gọi API trực tiếp, đặc tả JSON tại `/api/docs/openapi.json`, nguồn: `backend/openapi.js`). Khi sửa API phải cập nhật cả file này và `backend/openapi.js`.

---

## 1. MÃ TRẠNG THÁI HTTP & ĐỊNH DẠNG LỖI

### Cấu trúc thông báo lỗi chuẩn:
```json
{
  "status": "fail",
  "message": "rất tiếc, sản phẩm vừa hết hàng do số lượng có hạn!"
}
```

| HTTP Status | Phân loại | Trường hợp áp dụng |
|-------------|-----------|--------------------|
| **200 OK** | `success` | Truy vấn hoặc cập nhật dữ liệu thành công |
| **201 Created** | `success` | Khởi tạo tài nguyên thành công (Đăng ký, Tạo đơn hàng, Thêm địa chỉ) |
| **400 Bad Request** | `fail` | Thiếu trường bắt buộc, sai định dạng (mật khẩu yếu, số điện thoại sai định dạng, hết hàng khi đặt hàng, cố gắng xóa địa chỉ duy nhất) |
| **401 Unauthorized**| `fail` | Sai tài khoản/mật khẩu, chưa đăng nhập hoặc Token hết hạn |
| **403 Forbidden** | `fail` | Sửa/xóa sản phẩm không phải do mình đăng bán |
| **404 Not Found** | `fail` | Không tìm thấy sản phẩm, đơn hàng, người dùng hoặc đường dẫn |
| **409 Conflict** | `fail` | Trùng lặp dữ liệu hoặc xung đột tồn kho |
| **500 Server Error**| `error` | Lỗi cơ sở dữ liệu hoặc máy chủ nội bộ |

---

## 2. KIỂM TRA SỨC KHỎE HẠ TẦNG (HEALTH CHECK)

### `GET /health`
Được Docker Healthcheck và Nginx gọi định kỳ để xác minh trạng thái kết nối tới PostgreSQL.

- **Response `200 OK`**:
```json
{
  "status": "UP",
  "service": "ecommerce-backend",
  "database": "CONNECTED",
  "uptime": 124.5,
  "timestamp": "2026-11-03T18:30:00.000Z"
}
```

- **Response `503 Service Unavailable`**:
```json
{
  "status": "DOWN",
  "database": "DISCONNECTED",
  "timestamp": "2026-11-03T18:30:00.000Z"
}
```

---

## 3. PHÂN HỆ XÁC THỰC (AUTHENTICATION)

### `POST /api/auth/register`
Đăng ký tài khoản người dùng mới.

- **Request Body**:
```json
{
  "username": "auramall_user",
  "email": "user@auramall.vn",
  "phone": "0969795794",
  "password": "Password123",
  "confirmPassword": "Password123"
}
```

- **Ràng buộc kiểm tra (Validation)**:
  - `username`: 3 - 30 ký tự (chữ, số, gạch dưới).
  - `email`: Đúng định dạng email chuẩn RFC 5322.
  - `phone`: 10 đến 11 chữ số (vd: 0969795794).
  - `password`: Tối thiểu 8 ký tự, phải gồm chữ hoa, chữ thường và số.
  - `confirmPassword`: Phải khớp chính xác với `password`.

- **Response `201 Created`**:
```json
{
  "status": "success",
  "message": "Đăng ký tài khoản thành công!",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "auramall_user",
    "email": "user@auramall.vn",
    "phone": "0969795794",
    "gender": "other",
    "birthday": null,
    "avatarUrl": null
  }
}
```

---

### `POST /api/auth/login`
Đăng nhập người dùng bằng Tên đăng nhập, Email hoặc Số điện thoại.

- **Request Body**:
```json
{
  "login": "0969795794",
  "password": "Password123",
  "remember": true
}
```

- **Response `200 OK`**:
```json
{
  "status": "success",
  "message": "Đăng nhập thành công!",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "auramall_user",
    "email": "user@auramall.vn",
    "phone": "0969795794",
    "gender": "nam",
    "birthday": "1998-05-15",
    "avatarUrl": "https://images.unsplash.com/..."
  }
}
```

---

### `GET /api/auth/me`
Lấy thông tin tài khoản người dùng đang đăng nhập qua Header `Authorization: Bearer <token>`.

- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "username": "auramall_user",
    "email": "user@auramall.vn",
    "maskedEmail": "us***@auramall.vn",
    "phone": "0969795794",
    "gender": "nam",
    "birthday": "1998-05-15",
    "avatar_url": "https://images.unsplash.com/..."
  }
}
```

---

## 4. PHÂN HỆ DANH MỤC (CATEGORIES)

### `GET /api/categories`
Lấy danh sách 10 chủ đề danh mục cho cây thư mục / bộ lọc bên trái.

- **Response `200 OK`**:
```json
{
  "status": "success",
  "total": 10,
  "data": [
    {
      "id": 1,
      "name": "Điện thoại & Phụ kiện",
      "slug": "dien-thoai-phu-kien",
      "icon": "📱",
      "display_order": 1,
      "product_count": 3
    },
    {
      "id": 2,
      "name": "Thời trang & Quần áo",
      "slug": "thoi-trang-quan-ao",
      "icon": "👕",
      "display_order": 2,
      "product_count": 3
    }
  ]
}
```

---

## 5. PHÂN HỆ SẢN PHẨM (PRODUCTS) - LUỒNG NGHIỆP VỤ 1

### `GET /api/products`
Truy vấn danh mục sản phẩm có phân trang, bộ lọc và sắp xếp.

- **Query Parameters**:
  - `page`: Số trang (mặc định: `1`).
  - `limit`: Số sản phẩm mỗi trang (mặc định: `20`, tối đa `100`).
  - `category`: Lọc theo ID danh mục hoặc slug (vd: `dien-thoai-phu-kien`).
  - `minPrice`: Giá thấp nhất cần lọc (VND).
  - `maxPrice`: Giá cao nhất cần lọc (VND).
  - `minRating`: Số sao tối thiểu (vd: `5`, `4` để lấy 4 sao trở lên).
  - `flashSale`: Lọc các sản phẩm đang có tag Flash Sale (`true` hoặc `1`).
  - `sort`: Tiêu chí sắp xếp:
    - `popular`: Phổ biến nhất (dựa trên rating & lượt bán).
    - `newest`: Mới nhất theo thời gian tạo.
    - `best_seller`: Bán chạy nhất (`sold_count` giảm dần).
    - `price_asc`: Giá từ thấp đến cao.
    - `price_desc`: Giá từ cao đến thấp.
  - `q`: Từ khóa tìm kiếm theo tên hoặc mô tả.

- **Response `200 OK`**:
```json
{
  "status": "success",
  "total": 20,
  "data": [
    {
      "id": 1,
      "name": "Bàn phím cơ không dây AKKO 3087",
      "slug": "ban-phim-co-khong-day-akko-3087",
      "category_id": 10,
      "category_name": "Gaming & Ngoại vi",
      "price": 1250000,
      "original_price": 1550000,
      "discount_percent": 19,
      "stock": 50,
      "rating": 4.9,
      "review_count": 320,
      "sold_count": 1240,
      "is_flash_sale": false,
      "image_url": "/images/products/akko-3087.jpg",
      "thumbnails": [
        "/images/products/akko-3087.jpg",
        "/images/products/akko-3087-2.jpg"
      ],
      "description": "Bàn phím cơ không dây AKKO 3087 v2 sử dụng switch độc quyền...",
      "created_at": "2026-11-03T18:00:00.000Z",
      "category_slug": "gaming-ngoai-vi",
      "seller_id": null,
      "seller_username": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalItems": 24,
    "totalPages": 2
  }
}
```

- Ảnh của 24 sản phẩm mẫu lưu tại `frontend/images/products/` (Nginx phục vụ trực tiếp), nguồn ảnh ghi trong `CREDITS.md` cùng thư mục.
- `seller_id` / `seller_username`: người đăng bán; `null` là hàng của AuraMall.

---

### `GET /api/products/:id`
Lấy chi tiết một sản phẩm theo ID.

- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "name": "Bàn phím cơ không dây AKKO 3087",
    "price": 1250000,
    "original_price": 1550000,
    "discount_percent": 19,
    "stock": 50,
    "rating": 4.9,
    "review_count": 320,
    "sold_count": 1240,
    "is_flash_sale": false,
    "image_url": "https://images.unsplash.com/...",
    "thumbnails": ["https://...", "https://..."],
    "description": "Bàn phím cơ không dây AKKO 3087 v2...",
    "category_name": "Gaming & Ngoại vi"
  }
}
```

---

## 5b. KÊNH NGƯỜI BÁN (ĐĂNG BÁN SẢN PHẨM)

Các API dưới đây **bắt buộc đăng nhập** (`401` nếu thiếu token). Người dùng chỉ sửa/xóa được sản phẩm do chính mình đăng (`403` nếu không phải).

### `POST /api/products`
Đăng bán sản phẩm mới. Sản phẩm gắn với người đang đăng nhập (`seller_id`), chưa có đánh giá nên `rating = 0`, `review_count = 0`.

- **Request Body**:
```json
{
  "name": "Tai nghe True Wireless AuraBuds Pro",
  "categoryId": 4,
  "price": 1290000,
  "originalPrice": 1590000,
  "stock": 40,
  "imageUrl": "https://example.com/aurabuds.jpg",
  "thumbnails": ["https://example.com/aurabuds-2.jpg"],
  "description": "Chống ồn chủ động, pin 30 giờ, sạc nhanh USB-C."
}
```

- **Ràng buộc kiểm tra (Validation)**:
  - `name`: 3 - 255 ký tự. `slug` được tự sinh từ tên (bỏ dấu tiếng Việt).
  - `categoryId`: phải là danh mục đang có.
  - `price`: số nguyên 1.000 - 9.999.999.999 (VND).
  - `originalPrice` (không bắt buộc): phải lớn hơn hoặc bằng `price`; `discount_percent` tự tính.
  - `stock`: số nguyên 0 - 1.000.000.
  - `imageUrl`, `thumbnails` (không bắt buộc): link `http(s)://` hoặc ảnh có sẵn `/images/...`; tối đa 8 ảnh. Ảnh chính luôn là phần tử đầu của `thumbnails`.
  - `description` (không bắt buộc): tối đa 5000 ký tự.

- **Response `201 Created`**: `{ "status": "success", "message": "Đăng bán sản phẩm thành công!", "data": { ...sản phẩm như GET /api/products/:id } }`

### `PUT /api/products/:id`
Sửa sản phẩm do mình đăng bán. Body và ràng buộc giống `POST /api/products` (gửi đầy đủ các trường).

- **Response `200 OK`**: `{ "status": "success", "message": "Cập nhật sản phẩm thành công.", "data": { ... } }`
- Lỗi: `403` (không phải sản phẩm của bạn), `404` (không có sản phẩm).

### `DELETE /api/products/:id`
Xóa sản phẩm do mình đăng bán.

- **Response `200 OK`**: `{ "status": "success", "message": "Đã xóa sản phẩm." }`
- **Response `409 Conflict`** (sản phẩm đã có đơn hàng, giữ lại để không mất lịch sử đơn):
```json
{
  "status": "fail",
  "message": "Sản phẩm đã có đơn hàng nên không thể xóa. Hãy đặt tồn kho về 0 để ngừng bán."
}
```

### `GET /api/user/products`
Danh sách sản phẩm do người dùng hiện tại đăng bán, mới nhất trước.

- **Response `200 OK`**: `{ "status": "success", "total": 1, "data": [ { ...sản phẩm } ] }`

---

## 6. PHÂN HỆ ĐƠN HÀNG (ORDERS) - LUỒNG NGHIỆP VỤ 2

### `POST /api/orders`
Tạo đơn hàng mới với cơ chế trừ kho nguyên tử (Atomic decrement with row locking) trong Database Transaction, chống Overselling khi chạy kiểm thử chịu tải Flash Sale (k6).

#### Cách 1: Tương thích ngược với bài test tải k6:
```json
{
  "productId": 1,
  "quantity": 2
}
```

#### Cách 2: Đầy đủ theo luồng thanh toán giỏ hàng (Checkout):
```json
{
  "items": [
    { "productId": 1, "quantity": 1 },
    { "productId": 2, "quantity": 2 }
  ],
  "recipientName": "Nguyễn Văn A",
  "recipientPhone": "0969795794",
  "shippingAddress": "Số 12 ngõ 86 Cầu Giấy, Hà Nội",
  "paymentMethod": "COD",
  "note": "Giao hàng vào giờ hành chính"
}
```

- **Response `201 Created` (Thành công)**:
```json
{
  "status": "success",
  "message": "Tạo đơn hàng thành công!",
  "orderId": 15,
  "orderCode": "AUR-20261103-8F4C",
  "product": {
    "id": 1,
    "name": "Bàn phím cơ không dây AKKO 3087",
    "remainingStock": 48
  },
  "items": [
    {
      "productId": 1,
      "name": "Bàn phím cơ không dây AKKO 3087",
      "price": 1250000,
      "quantity": 1,
      "subtotal": 1250000,
      "remainingStock": 49
    }
  ],
  "quantity": 1,
  "totalPrice": 1250000,
  "shippingFee": 0,
  "finalTotal": 1250000,
  "paymentMethod": "COD",
  "createdAt": "2026-11-03T18:35:00.000Z"
}
```

- **Response `400 Bad Request` (Hết hàng - đúng câu thông báo yêu cầu tại Page 3 PDF)**:
```json
{
  "status": "fail",
  "message": "rất tiếc, sản phẩm vừa hết hàng do số lượng có hạn!"
}
```

---

### `GET /api/orders`
Tra cứu danh sách đơn hàng đã mua của người dùng (hoặc đơn hàng gần nhất).

- **Response `200 OK`**:
```json
{
  "status": "success",
  "total": 1,
  "data": [
    {
      "id": 15,
      "order_code": "AUR-20261103-8F4C",
      "quantity": 1,
      "total_price": 1250000,
      "shipping_fee": 0,
      "final_total": 1250000,
      "recipient_name": "Nguyễn Văn A",
      "recipient_phone": "0969795794",
      "shipping_address": "Số 12 ngõ 86 Cầu Giấy, Hà Nội",
      "payment_method": "COD",
      "status": "CREATED",
      "created_at": "2026-11-03T18:35:00.000Z",
      "product_name": "Bàn phím cơ không dây AKKO 3087",
      "items": [
        {
          "productId": 1,
          "name": "Bàn phím cơ không dây AKKO 3087",
          "quantity": 1,
          "unitPrice": 1250000,
          "subtotal": 1250000
        }
      ]
    }
  ]
}
```

---

## 7. PHÂN HỆ HỒ SƠ & SỔ ĐỊA CHỈ NGƯỜI DÙNG

### `GET /api/user/profile`
Lấy thông tin hồ sơ người dùng.

- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "username": "auramall_user",
    "email": "user@auramall.vn",
    "maskedEmail": "us***@auramall.vn",
    "phone": "0969795794",
    "gender": "nam",
    "birthday": "1998-05-15",
    "avatar_url": "https://images.unsplash.com/..."
  }
}
```

---

### `PUT /api/user/profile`
Cập nhật thông tin hồ sơ (Email, Số điện thoại, Giới tính, Ngày sinh).

- **Request Body**:
```json
{
  "email": "user@auramall.vn",
  "phone": "0969795794",
  "gender": "nam",
  "birthday": "1998-05-15"
}
```

- **Ràng buộc kiểm tra**:
  - `email`: Đúng định dạng email.
  - `phone`: Đúng định dạng 10-11 chữ số (vd: 0969795794).
  - `birthday`: Không được lớn hơn ngày hiện tại.

- **Response `200 OK`**:
```json
{
  "status": "success",
  "message": "cập nhật hồ sơ thành công",
  "data": {
    "id": 1,
    "username": "auramall_user",
    "email": "user@auramall.vn",
    "phone": "0969795794",
    "gender": "nam",
    "birthday": "1998-05-15"
  }
}
```

---

### `POST /api/user/avatar`
Tải lên ảnh đại diện cá nhân dạng Base64 Data URL.

- **Ràng buộc**:
  - Định dạng: `.png`, `.jpg`, `.jpeg`.
  - Dung lượng tối đa: `2MB`.

- **Response `200 OK`**:
```json
{
  "status": "success",
  "message": "Cập nhật ảnh đại diện thành công.",
  "avatarUrl": "data:image/jpeg;base64,..."
}
```

---

### `GET /api/user/addresses`
Lấy danh sách địa chỉ nhận hàng của người dùng.

- **Response `200 OK`**:
```json
{
  "status": "success",
  "total": 2,
  "data": [
    {
      "id": 1,
      "recipient_name": "Nguyễn Văn A",
      "phone": "0969795794",
      "detail_address": "Số 12 ngõ 86 đường Cầu Giấy, Hà Nội",
      "is_default": true
    }
  ]
}
```

---

### `POST /api/user/addresses`
Thêm địa chỉ nhận hàng mới.

- **Request Body**:
```json
{
  "recipientName": "Nguyễn Văn A",
  "phone": "0969795794",
  "detailAddress": "Số 88 Phố Huế, Hoàn Kiếm, Hà Nội",
  "isDefault": false
}
```

- **Response `201 Created`**:
```json
{
  "status": "success",
  "message": "Thêm địa chỉ nhận hàng thành công.",
  "data": {
    "id": 3,
    "recipient_name": "Nguyễn Văn A",
    "phone": "0969795794",
    "detail_address": "Số 88 Phố Huế, Hoàn Kiếm, Hà Nội",
    "is_default": false
  }
}
```

---

### `PUT /api/user/addresses/:id`
Chỉnh sửa địa chỉ nhận hàng.

- **Request Body**:
```json
{
  "recipientName": "Nguyễn Văn A",
  "phone": "0969795794",
  "detailAddress": "Số 88 Phố Huế (sửa), Hoàn Kiếm, Hà Nội",
  "isDefault": true
}
```

---

### `DELETE /api/user/addresses/:id`
Xóa địa chỉ nhận hàng.

- **Quy tắc nghiệp vụ (Business Rule)**: Nếu hệ thống chỉ có duy nhất 1 địa chỉ mặc định, từ chối xóa và trả về thông báo lỗi:
```json
{
  "status": "fail",
  "message": "Cần ít nhất 1 địa chỉ nhận hàng"
}
```
- Nếu còn nhiều địa chỉ và xóa địa chỉ mặc định, địa chỉ còn lại tự động được nâng cấp lên làm mặc định.
