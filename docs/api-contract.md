# Hợp đồng API (API Contract)

Cấu trúc JSON giữa Frontend và Backend. Mọi thay đổi phải cập nhật file này trước khi sửa code.

- Base URL (qua Nginx): `http://localhost`
- Định dạng: `application/json; charset=utf-8`
- Trường `status` theo kiểu JSend: `success` (thành công), `fail` (lỗi do dữ liệu gửi lên, mã 4xx), `error` (lỗi máy chủ, mã 5xx)
- Cấu trúc bảng CSDL: xem [database/schema.sql](../database/schema.sql)

## Định dạng lỗi

```json
{ "status": "fail", "message": "Sản phẩm đã hết hàng hoặc số lượng tồn kho không đủ để đáp ứng." }
```

| HTTP | `status` | Khi nào                                        |
|------|----------|------------------------------------------------|
| 400  | `fail`   | Dữ liệu gửi lên sai hoặc thiếu, JSON sai cú pháp |
| 404  | `fail`   | Không tìm thấy sản phẩm hoặc đường dẫn         |
| 409  | `fail`   | Số lượng đặt vượt tồn kho                      |
| 500  | `error`  | Lỗi máy chủ                                    |

## GET /health

Docker healthcheck và giao diện web gọi để kiểm tra kết nối CSDL.

`200 OK`:

```json
{
  "status": "UP",
  "service": "ecommerce-backend",
  "database": "CONNECTED",
  "uptime": 12.3,
  "timestamp": "2026-10-27T13:00:00.000Z"
}
```

`503 Service Unavailable`: `{ "status": "DOWN", "database": "DISCONNECTED", "timestamp": "..." }`

## GET /api/products

Query tùy chọn: `page` (mặc định 1), `limit` (mặc định 20, tối đa 100).

`200 OK`:

```json
{
  "status": "success",
  "total": 20,
  "data": [
    {
      "id": 1,
      "name": "Bàn phím cơ không dây AKKO 3087",
      "price": 1250000,
      "stock": 50,
      "created_at": "2026-10-27T13:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "totalItems": 20, "totalPages": 1 }
}
```

`total` là số sản phẩm trong trang hiện tại, `pagination.totalItems` là tổng số sản phẩm.

## GET /api/products/:id

`200 OK`: `{ "status": "success", "data": { ...một sản phẩm như trên } }`. Không tồn tại: `404`.

## POST /api/orders

Tạo đơn hàng. Tồn kho được trừ trong cùng transaction nên nhiều khách đặt đồng thời không bị bán vượt số lượng.

Request body:

```json
{ "productId": 1, "quantity": 2 }
```

| Trường      | Bắt buộc          | Quy tắc                                            |
|-------------|-------------------|----------------------------------------------------|
| `productId` | có                | số nguyên dương (nhận cả chuỗi chữ số như `"1"`)   |
| `quantity`  | không, mặc định 1 | số nguyên từ 1 đến 100 (nhận cả chuỗi chữ số)      |

`201 Created`:

```json
{
  "status": "success",
  "message": "Tạo đơn hàng thành công!",
  "orderId": 101,
  "product": { "id": 1, "name": "Bàn phím cơ không dây AKKO 3087", "remainingStock": 48 },
  "quantity": 2,
  "totalPrice": 2500000,
  "createdAt": "2026-10-27T13:05:00.000Z"
}
```

Lỗi: `400` (sai dữ liệu), `404` (sản phẩm không tồn tại), `409` (không đủ hàng).

## GET /api/orders

20 đơn hàng mới nhất, dùng để kiểm tra nhanh.

`200 OK`:

```json
{
  "status": "success",
  "total": 1,
  "data": [
    {
      "id": 101,
      "quantity": 2,
      "total_price": 2500000,
      "status": "CREATED",
      "created_at": "2026-10-27T13:05:00.000Z",
      "product_name": "Bàn phím cơ không dây AKKO 3087"
    }
  ]
}
```
