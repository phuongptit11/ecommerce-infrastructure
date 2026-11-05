'use strict';

// Đặc tả OpenAPI 3.0 của API AuraMall, hiển thị bằng Swagger UI tại /api/docs/ (JSON thô: /api/docs/openapi.json).
// Khi thêm hoặc sửa API: cập nhật docs/api-contract.md và file này cùng lúc.

const json = (schema, example) => ({
  'application/json': example === undefined ? { schema } : { schema, example },
});

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const fail = (description, message) => ({
  description,
  content: json(ref('Error'), { status: 'fail', message }),
});

const success = (description, dataSchema, extra = {}) => ({
  description,
  content: json({
    type: 'object',
    properties: { status: { type: 'string', example: 'success' }, ...extra, data: dataSchema },
  }),
});

const idParam = (description) => ({
  name: 'id',
  in: 'path',
  required: true,
  description,
  schema: { type: 'integer', minimum: 1 },
});

const UNAUTHORIZED = fail('Chưa đăng nhập hoặc token hết hạn', 'Vui lòng đăng nhập để thực hiện thao tác này.');
const FORBIDDEN = fail('Vai trò không đủ quyền', 'Bạn không có quyền thực hiện thao tác này.');
const BEARER = [{ bearerAuth: [] }];
// Chỉ dùng cho tạo đơn: không gửi token thì là đơn của khách vãng lai (k6 loadtest)
const OPTIONAL_BEARER = [{}, { bearerAuth: [] }];
const ROLE_ENUM = { type: 'string', enum: ['admin', 'seller', 'user'] };
const ORDER_STATUS_ENUM = { type: 'string', enum: ['CREATED', 'CONFIRMED', 'DELIVERING', 'COMPLETED', 'CANCELLED'] };

const productExample = {
  id: 1,
  name: 'Bàn phím cơ không dây AKKO 3087',
  slug: 'ban-phim-co-khong-day-akko-3087',
  category_id: 10,
  category_name: 'Gaming & Ngoại vi',
  category_slug: 'gaming-ngoai-vi',
  price: 1250000,
  original_price: 1550000,
  discount_percent: 19,
  stock: 50,
  rating: 4.9,
  review_count: 320,
  sold_count: 1240,
  is_flash_sale: false,
  image_url: '/images/products/akko-3087.jpg',
  thumbnails: ['/images/products/akko-3087.jpg', '/images/products/akko-3087-2.jpg'],
  description: 'Bàn phím cơ không dây AKKO 3087 v2 sử dụng switch độc quyền Akko CS Switch...',
  seller_id: null,
  seller_username: null,
  created_at: '2026-11-03T12:00:00.000Z',
};

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'AuraMall API',
    version: '1.0.0',
    description: [
      'API của hệ thống TMĐT **AuraMall** (Đề tài 07: hạ tầng 3 tầng Nginx → Node.js Express → PostgreSQL).',
      '',
      '- Định dạng phản hồi theo JSend: `success` (2xx), `fail` (4xx, lỗi dữ liệu gửi lên), `error` (5xx).',
      '- Xác thực: đăng nhập qua `POST /api/auth/login` (hoặc `POST /api/auth/google`), bấm **Authorize** và dán `token` nhận được.',
      '- Phân quyền 3 vai trò: `user` (người mua), `seller` (người bán: kênh người bán), `admin` (quản trị: mọi API).',
      '- Tài khoản mẫu (mật khẩu `Password123`): `auramall_user`, `auramall_seller`, `auramall_admin`.',
      '- Tài liệu dạng văn bản: `docs/api-contract.md`.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'Cùng địa chỉ với trang web (đi qua Nginx)' }],
  tags: [
    { name: 'Hệ thống', description: 'Kiểm tra sức khỏe hạ tầng' },
    { name: 'Xác thực', description: 'Đăng ký, đăng nhập, thông tin tài khoản' },
    { name: 'Danh mục', description: 'Cây danh mục sản phẩm' },
    { name: 'Sản phẩm', description: 'Luồng nghiệp vụ 1: đọc danh mục sản phẩm' },
    { name: 'Kênh người bán', description: 'Quyền seller hoặc admin: đăng bán, sửa, xóa sản phẩm, xem đơn của shop' },
    { name: 'Đơn hàng', description: 'Luồng nghiệp vụ 2: đặt hàng, trừ kho nguyên tử' },
    { name: 'Người dùng', description: 'Hồ sơ cá nhân, ảnh đại diện, sổ địa chỉ (cần đăng nhập)' },
    { name: 'Quản trị', description: 'Chỉ admin: thống kê, phân quyền người dùng, quản lý đơn hàng' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token nhận được từ đăng nhập hoặc đăng ký',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['fail', 'error'] },
          message: { type: 'string' },
        },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'UP' },
          service: { type: 'string', example: 'ecommerce-backend' },
          database: { type: 'string', example: 'CONNECTED' },
          uptime: { type: 'number', example: 124.5 },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      User: {
        type: 'object',
        description: 'Thông tin người dùng trả về khi đăng ký/đăng nhập',
        properties: {
          id: { type: 'integer', example: 1 },
          username: { type: 'string', example: 'auramall_user' },
          email: { type: 'string', example: 'user@auramall.vn' },
          phone: { type: 'string', example: '0969795794' },
          gender: { type: 'string', example: 'nam' },
          birthday: { type: 'string', format: 'date', nullable: true, example: '1998-05-15' },
          avatarUrl: { type: 'string', nullable: true },
          role: { ...ROLE_ENUM, example: 'user' },
        },
      },
      Profile: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          username: { type: 'string', example: 'auramall_user' },
          email: { type: 'string', example: 'user@auramall.vn' },
          maskedEmail: { type: 'string', example: 'us***@auramall.vn' },
          phone: { type: 'string', example: '0969795794' },
          gender: { type: 'string', enum: ['nam', 'nu', 'khac', 'other'], example: 'nam' },
          birthday: { type: 'string', format: 'date-time', nullable: true },
          avatar_url: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          role: { ...ROLE_ENUM, example: 'user' },
          has_password: { type: 'boolean', description: 'false: tài khoản tạo bằng Google, chưa đặt mật khẩu' },
          google_linked: { type: 'boolean', description: 'Đã liên kết tài khoản Google' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'success' },
          message: { type: 'string', example: 'Đăng nhập thành công!' },
          token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
          user: ref('User'),
        },
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 10 },
          name: { type: 'string', example: 'Gaming & Ngoại vi' },
          slug: { type: 'string', example: 'gaming-ngoai-vi' },
          icon: { type: 'string', example: '🎮' },
          display_order: { type: 'integer', example: 10 },
          product_count: { type: 'integer', example: 5 },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          slug: { type: 'string' },
          category_id: { type: 'integer', nullable: true },
          category_name: { type: 'string', nullable: true },
          category_slug: { type: 'string', nullable: true },
          price: { type: 'number', description: 'Giá bán (VND)' },
          original_price: { type: 'number', nullable: true, description: 'Giá gốc trước giảm (VND)' },
          discount_percent: { type: 'integer' },
          stock: { type: 'integer', description: 'Tồn kho' },
          rating: { type: 'number', description: 'Điểm đánh giá 0 - 5 (0 khi chưa có đánh giá)' },
          review_count: { type: 'integer' },
          sold_count: { type: 'integer' },
          is_flash_sale: { type: 'boolean' },
          image_url: { type: 'string', nullable: true, description: 'Ảnh chính: link http(s) hoặc /images/...' },
          thumbnails: { type: 'array', items: { type: 'string' }, description: 'Dải ảnh, phần tử đầu là ảnh chính' },
          description: { type: 'string', nullable: true },
          seller_id: { type: 'integer', nullable: true, description: 'Người đăng bán; null = hàng AuraMall' },
          seller_username: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
        example: productExample,
      },
      ProductInput: {
        type: 'object',
        required: ['name', 'categoryId', 'price', 'stock'],
        properties: {
          name: { type: 'string', minLength: 3, maxLength: 255 },
          categoryId: { type: 'integer', description: 'ID danh mục (xem GET /api/categories)' },
          price: { type: 'integer', minimum: 1000, maximum: 9999999999, description: 'Giá bán (VND)' },
          originalPrice: {
            type: 'integer',
            nullable: true,
            description: 'Giá gốc, phải >= giá bán; dùng để tính % giảm giá',
          },
          stock: { type: 'integer', minimum: 0, maximum: 1000000 },
          imageUrl: { type: 'string', nullable: true, description: 'Link ảnh http(s)' },
          thumbnails: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Ảnh phụ' },
          description: { type: 'string', maxLength: 5000 },
        },
        example: {
          name: 'Tai nghe True Wireless AuraBuds Pro',
          categoryId: 4,
          price: 1290000,
          originalPrice: 1590000,
          stock: 40,
          imageUrl: 'https://example.com/aurabuds.jpg',
          thumbnails: [],
          description: 'Chống ồn chủ động, pin 30 giờ, sạc nhanh USB-C.',
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          totalItems: { type: 'integer', example: 24 },
          totalPages: { type: 'integer', example: 2 },
        },
      },
      OrderItemInput: {
        type: 'object',
        required: ['productId'],
        properties: {
          productId: { type: 'integer', minimum: 1 },
          quantity: { type: 'integer', minimum: 1, maximum: 100, default: 1 },
        },
      },
      OrderCreate: {
        type: 'object',
        description: 'Gửi `items` (thanh toán giỏ hàng) hoặc cặp `productId`/`quantity` (tương thích k6 loadtest)',
        properties: {
          items: { type: 'array', items: ref('OrderItemInput') },
          productId: { type: 'integer' },
          quantity: { type: 'integer' },
          recipientName: { type: 'string' },
          recipientPhone: { type: 'string' },
          shippingAddress: { type: 'string' },
          paymentMethod: { type: 'string', enum: ['COD', 'BANK_TRANSFER'], default: 'COD' },
          note: { type: 'string', description: 'Lời nhắn cho người bán' },
        },
      },
      OrderCreated: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'success' },
          message: { type: 'string', example: 'Tạo đơn hàng thành công!' },
          orderId: { type: 'integer', example: 15 },
          orderCode: { type: 'string', example: 'AUR-20261103-8F4C' },
          product: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              remainingStock: { type: 'integer' },
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'integer' },
                name: { type: 'string' },
                price: { type: 'number' },
                quantity: { type: 'integer' },
                subtotal: { type: 'number' },
                imageUrl: { type: 'string', nullable: true },
                remainingStock: { type: 'integer' },
              },
            },
          },
          quantity: { type: 'integer' },
          totalPrice: { type: 'number', description: 'Tổng tiền hàng' },
          shippingFee: { type: 'number', description: '30.000đ, miễn phí khi tiền hàng từ 500.000đ' },
          finalTotal: { type: 'number' },
          paymentMethod: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 15 },
          order_code: { type: 'string', example: 'AUR-20261103-8F4C' },
          quantity: { type: 'integer' },
          total_price: { type: 'number' },
          shipping_fee: { type: 'number' },
          final_total: { type: 'number' },
          recipient_name: { type: 'string' },
          recipient_phone: { type: 'string' },
          shipping_address: { type: 'string' },
          payment_method: { type: 'string', enum: ['COD', 'BANK_TRANSFER'] },
          status: { type: 'string', example: 'CREATED' },
          created_at: { type: 'string', format: 'date-time' },
          product_name: { type: 'string' },
          product_image: { type: 'string', nullable: true },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'integer' },
                name: { type: 'string' },
                image: { type: 'string', nullable: true },
                quantity: { type: 'integer' },
                unitPrice: { type: 'number' },
                subtotal: { type: 'number' },
              },
            },
          },
        },
      },
      ProfileUpdate: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          phone: { type: 'string', description: '10 - 11 chữ số, bắt đầu bằng 0 hoặc +84' },
          gender: { type: 'string', enum: ['nam', 'nu', 'khac'] },
          birthday: { type: 'string', format: 'date', description: 'Không vượt quá ngày hiện tại' },
          avatarUrl: { type: 'string' },
        },
        example: { email: 'user@auramall.vn', phone: '0969795794', gender: 'nam', birthday: '1998-05-15' },
      },
      Address: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          recipient_name: { type: 'string', example: 'Nguyễn Văn A' },
          phone: { type: 'string', example: '0969795794' },
          detail_address: { type: 'string', example: 'Số 12 ngõ 86 đường Cầu Giấy, Hà Nội' },
          is_default: { type: 'boolean', example: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      AddressInput: {
        type: 'object',
        required: ['recipientName', 'phone', 'detailAddress'],
        properties: {
          recipientName: { type: 'string' },
          phone: { type: 'string' },
          detailAddress: { type: 'string' },
          isDefault: { type: 'boolean' },
        },
        example: {
          recipientName: 'Nguyễn Văn A',
          phone: '0969795794',
          detailAddress: 'Số 88 Phố Huế, Hoàn Kiếm, Hà Nội',
          isDefault: false,
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Hệ thống'],
        summary: 'Kiểm tra kết nối backend và CSDL',
        description: 'Docker healthcheck và giao diện web gọi định kỳ.',
        responses: {
          200: { description: 'Hệ thống hoạt động', content: json(ref('Health')) },
          503: {
            description: 'Mất kết nối CSDL',
            content: json(ref('Health'), { status: 'DOWN', database: 'DISCONNECTED', timestamp: '2026-11-03T18:30:00.000Z' }),
          },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Xác thực'],
        summary: 'Đăng ký tài khoản',
        requestBody: {
          required: true,
          content: json(
            {
              type: 'object',
              required: ['username', 'email', 'phone', 'password'],
              properties: {
                username: { type: 'string', description: '3 - 30 ký tự: chữ, số, gạch dưới' },
                email: { type: 'string', format: 'email' },
                phone: { type: 'string', description: '10 - 11 chữ số' },
                password: { type: 'string', description: 'Tối thiểu 8 ký tự, có chữ hoa, chữ thường và số' },
                confirmPassword: { type: 'string' },
                role: { type: 'string', enum: ['user', 'seller'], default: 'user', description: 'Loại tài khoản; quyền admin không tự đăng ký được' },
              },
            },
            {
              username: 'tester2026',
              email: 'tester2026@gmail.com',
              phone: '0988776655',
              password: 'Password123',
              confirmPassword: 'Password123',
              role: 'user',
            }
          ),
        },
        responses: {
          201: { description: 'Đăng ký thành công, trả kèm token', content: json(ref('AuthResponse')) },
          400: fail('Sai định dạng, trùng tên đăng nhập/email hoặc xin quyền admin', 'Tên đăng nhập đã được sử dụng.'),
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Xác thực'],
        summary: 'Đăng nhập bằng tên đăng nhập, email hoặc số điện thoại',
        requestBody: {
          required: true,
          content: json(
            {
              type: 'object',
              required: ['login', 'password'],
              properties: {
                login: { type: 'string' },
                password: { type: 'string' },
                remember: { type: 'boolean', description: 'true: token sống 30 ngày, false: 2 ngày' },
              },
            },
            { login: 'auramall_user', password: 'Password123', remember: true }
          ),
        },
        responses: {
          200: { description: 'Đăng nhập thành công', content: json(ref('AuthResponse')) },
          400: fail('Thiếu thông tin', 'Vui lòng nhập tên đăng nhập/email/số điện thoại và mật khẩu.'),
          401: fail('Sai tài khoản hoặc mật khẩu', 'Tài khoản hoặc mật khẩu không chính xác.'),
        },
      },
    },
    '/api/auth/config': {
      get: {
        tags: ['Xác thực'],
        summary: 'Cấu hình đăng nhập Google cho giao diện',
        responses: {
          200: success('Client ID công khai, null nếu chưa cấu hình GOOGLE_CLIENT_ID', {
            type: 'object',
            properties: { googleClientId: { type: 'string', nullable: true } },
          }),
        },
      },
    },
    '/api/auth/google': {
      post: {
        tags: ['Xác thực'],
        summary: 'Đăng nhập / đăng ký bằng Google',
        description:
          'Gửi `credential` (ID token) nhận từ nút "Sign in with Google". Backend kiểm tra chữ ký RS256 theo khóa công khai của Google, ' +
          '`aud` = GOOGLE_CLIENT_ID, hạn dùng và email đã xác minh. Email đã có tài khoản thì liên kết vào tài khoản đó, chưa có thì tạo mới (không mật khẩu).',
        requestBody: {
          required: true,
          content: json(
            {
              type: 'object',
              required: ['credential'],
              properties: {
                credential: { type: 'string', description: 'ID token Google' },
                role: { type: 'string', enum: ['user', 'seller'], default: 'user', description: 'Chỉ dùng khi tạo tài khoản mới' },
              },
            },
            { credential: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...', role: 'user' }
          ),
        },
        responses: {
          200: { description: 'Đăng nhập tài khoản đã có', content: json(ref('AuthResponse')) },
          201: { description: 'Đã tạo tài khoản mới từ Google', content: json(ref('AuthResponse')) },
          400: fail('Email Google chưa xác minh hoặc role sai', 'Email Google chưa được xác minh.'),
          401: fail('Token sai chữ ký, sai client ID hoặc hết hạn', 'Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn.'),
          409: fail('Email đã liên kết với tài khoản Google khác', 'Email này đã liên kết với một tài khoản Google khác.'),
          503: fail('Chưa cấu hình GOOGLE_CLIENT_ID', 'Đăng nhập Google chưa được cấu hình (thiếu GOOGLE_CLIENT_ID).'),
        },
      },
    },
    '/api/auth/password': {
      put: {
        tags: ['Xác thực'],
        summary: 'Đổi mật khẩu',
        description: 'Tài khoản tạo bằng Google chưa có mật khẩu (`has_password = false`) thì đặt mới, không cần `currentPassword`.',
        security: BEARER,
        requestBody: {
          required: true,
          content: json(
            {
              type: 'object',
              required: ['newPassword', 'confirmPassword'],
              properties: {
                currentPassword: { type: 'string' },
                newPassword: { type: 'string', description: 'Tối thiểu 8 ký tự, có chữ hoa, chữ thường và số' },
                confirmPassword: { type: 'string' },
              },
            },
            { currentPassword: 'Password123', newPassword: 'Matkhaumoi1', confirmPassword: 'Matkhaumoi1' }
          ),
        },
        responses: {
          200: {
            description: 'Đã đổi mật khẩu',
            content: json(ref('Error'), { status: 'success', message: 'Đổi mật khẩu thành công.' }),
          },
          400: fail('Sai mật khẩu hiện tại, mật khẩu mới yếu hoặc nhập lại không khớp', 'Mật khẩu hiện tại không chính xác.'),
          401: UNAUTHORIZED,
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Xác thực'],
        summary: 'Thông tin tài khoản đang đăng nhập',
        security: BEARER,
        responses: {
          200: success('Thông tin tài khoản', ref('Profile')),
          401: UNAUTHORIZED,
          404: fail('Tài khoản không còn tồn tại', 'Không tìm thấy người dùng.'),
        },
      },
    },
    '/api/categories': {
      get: {
        tags: ['Danh mục'],
        summary: 'Danh sách danh mục kèm số sản phẩm',
        responses: {
          200: success('Danh sách danh mục', { type: 'array', items: ref('Category') }, { total: { type: 'integer' } }),
        },
      },
    },
    '/api/products': {
      get: {
        tags: ['Sản phẩm'],
        summary: 'Danh sách sản phẩm: phân trang, lọc, sắp xếp, tìm kiếm',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          {
            name: 'category',
            in: 'query',
            description: 'ID hoặc slug danh mục',
            schema: { type: 'string' },
            example: 'gaming-ngoai-vi',
          },
          { name: 'minPrice', in: 'query', description: 'Giá thấp nhất (VND)', schema: { type: 'number' } },
          { name: 'maxPrice', in: 'query', description: 'Giá cao nhất (VND)', schema: { type: 'number' } },
          { name: 'minRating', in: 'query', description: 'Số sao tối thiểu', schema: { type: 'number', minimum: 0, maximum: 5 } },
          { name: 'flashSale', in: 'query', description: '`true` để chỉ lấy hàng Flash Sale', schema: { type: 'boolean' } },
          {
            name: 'sort',
            in: 'query',
            description: 'popular: phổ biến, newest: mới nhất, best_seller: bán chạy, price_asc / price_desc: theo giá',
            schema: { type: 'string', enum: ['popular', 'newest', 'best_seller', 'price_asc', 'price_desc'] },
          },
          { name: 'q', in: 'query', description: 'Từ khóa tìm theo tên hoặc mô tả', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Một trang sản phẩm',
            content: json({
              type: 'object',
              properties: {
                status: { type: 'string', example: 'success' },
                total: { type: 'integer', description: 'Số sản phẩm trong trang hiện tại' },
                data: { type: 'array', items: ref('Product') },
                pagination: ref('Pagination'),
              },
            }),
          },
          400: fail('Tham số phân trang sai', 'page phải là số nguyên từ 1 đến 100000'),
        },
      },
      post: {
        tags: ['Kênh người bán'],
        summary: 'Đăng bán sản phẩm mới (seller, admin)',
        description: 'Sản phẩm được gắn với người đang đăng nhập (`seller_id`). Chưa có đánh giá nên `rating` = 0.',
        security: BEARER,
        requestBody: { required: true, content: json(ref('ProductInput')) },
        responses: {
          201: success('Đăng bán thành công', ref('Product'), {
            message: { type: 'string', example: 'Đăng bán sản phẩm thành công!' },
          }),
          400: fail('Dữ liệu không hợp lệ', 'Giá gốc phải lớn hơn hoặc bằng giá bán.'),
          401: UNAUTHORIZED,
          403: FORBIDDEN,
        },
      },
    },
    '/api/products/{id}': {
      parameters: [idParam('ID sản phẩm')],
      get: {
        tags: ['Sản phẩm'],
        summary: 'Chi tiết một sản phẩm',
        responses: {
          200: success('Chi tiết sản phẩm', ref('Product')),
          400: fail('ID sai định dạng', 'id phải là số nguyên dương'),
          404: fail('Không có sản phẩm', 'Không tìm thấy sản phẩm.'),
        },
      },
      put: {
        tags: ['Kênh người bán'],
        summary: 'Sửa sản phẩm (seller: sản phẩm của mình, admin: mọi sản phẩm)',
        description: 'Gửi đầy đủ các trường như khi đăng bán.',
        security: BEARER,
        requestBody: { required: true, content: json(ref('ProductInput')) },
        responses: {
          200: success('Đã cập nhật', ref('Product'), { message: { type: 'string', example: 'Cập nhật sản phẩm thành công.' } }),
          400: fail('Dữ liệu không hợp lệ', 'Tên sản phẩm phải từ 3 đến 255 ký tự.'),
          401: UNAUTHORIZED,
          403: fail('Không phải sản phẩm của bạn', 'Bạn chỉ có thể thay đổi sản phẩm do chính mình đăng bán.'),
          404: fail('Không có sản phẩm', 'Không tìm thấy sản phẩm.'),
        },
      },
      delete: {
        tags: ['Kênh người bán'],
        summary: 'Xóa sản phẩm (seller: sản phẩm của mình, admin: mọi sản phẩm)',
        security: BEARER,
        responses: {
          200: {
            description: 'Đã xóa',
            content: json(ref('Error'), { status: 'success', message: 'Đã xóa sản phẩm.' }),
          },
          401: UNAUTHORIZED,
          403: fail('Không phải sản phẩm của bạn', 'Bạn chỉ có thể thay đổi sản phẩm do chính mình đăng bán.'),
          404: fail('Không có sản phẩm', 'Không tìm thấy sản phẩm.'),
          409: fail(
            'Sản phẩm đã có đơn hàng',
            'Sản phẩm đã có đơn hàng nên không thể xóa. Hãy đặt tồn kho về 0 để ngừng bán.'
          ),
        },
      },
    },
    '/api/user/products': {
      get: {
        tags: ['Kênh người bán'],
        summary: 'Sản phẩm do tôi đăng bán, mới nhất trước (seller, admin)',
        security: BEARER,
        responses: {
          200: success('Danh sách sản phẩm', { type: 'array', items: ref('Product') }, { total: { type: 'integer' } }),
          401: UNAUTHORIZED,
          403: FORBIDDEN,
        },
      },
    },
    '/api/orders': {
      post: {
        tags: ['Đơn hàng'],
        summary: 'Tạo đơn hàng, trừ kho nguyên tử trong một transaction',
        description:
          'Tồn kho được trừ bằng `UPDATE ... WHERE stock >= quantity` nên nhiều khách đặt cùng lúc không bị bán vượt số lượng. ' +
          'Không gửi token thì là đơn của khách vãng lai (`user_id` = NULL, dùng cho k6 loadtest).',
        security: OPTIONAL_BEARER,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: ref('OrderCreate'),
              examples: {
                cart: {
                  summary: 'Thanh toán giỏ hàng',
                  value: {
                    items: [
                      { productId: 1, quantity: 1 },
                      { productId: 2, quantity: 2 },
                    ],
                    recipientName: 'Nguyễn Văn A',
                    recipientPhone: '0969795794',
                    shippingAddress: 'Số 12 ngõ 86 Cầu Giấy, Hà Nội',
                    paymentMethod: 'COD',
                    note: 'Giao giờ hành chính',
                  },
                },
                loadtest: { summary: 'Một sản phẩm (k6 loadtest)', value: { productId: 1, quantity: 1 } },
              },
            },
          },
        },
        responses: {
          201: { description: 'Tạo đơn thành công', content: json(ref('OrderCreated')) },
          400: fail('Dữ liệu đơn hàng sai', 'Dữ liệu đơn hàng không hợp lệ, cần ít nhất 1 sản phẩm.'),
          404: fail('Sản phẩm không tồn tại', 'Không tìm thấy sản phẩm có ID 999.'),
          409: fail('Hết hàng', 'rất tiếc, sản phẩm vừa hết hàng do số lượng có hạn!'),
        },
      },
      get: {
        tags: ['Đơn hàng'],
        summary: 'Đơn mua của tôi (50 đơn mới nhất)',
        description: 'Chỉ trả đơn của người đang đăng nhập. Admin xem toàn bộ đơn tại `GET /api/admin/orders`.',
        security: BEARER,
        responses: {
          200: success('Danh sách đơn hàng', { type: 'array', items: ref('Order') }, { total: { type: 'integer' } }),
          401: UNAUTHORIZED,
        },
      },
    },
    '/api/orders/{id}': {
      get: {
        tags: ['Đơn hàng'],
        summary: 'Chi tiết một đơn hàng (chủ đơn hoặc admin)',
        security: BEARER,
        parameters: [idParam('ID đơn hàng')],
        responses: {
          200: success('Chi tiết đơn hàng', ref('Order')),
          401: UNAUTHORIZED,
          403: fail('Không phải đơn của bạn', 'Bạn không có quyền xem đơn hàng này.'),
          404: fail('Không có đơn hàng', 'Không tìm thấy đơn hàng.'),
        },
      },
    },
    '/api/user/profile': {
      get: {
        tags: ['Người dùng'],
        summary: 'Xem hồ sơ cá nhân',
        security: BEARER,
        responses: {
          200: success('Hồ sơ', ref('Profile')),
          404: fail('Không có người dùng', 'Không tìm thấy thông tin người dùng.'),
        },
      },
      put: {
        tags: ['Người dùng'],
        summary: 'Cập nhật hồ sơ cá nhân',
        security: BEARER,
        requestBody: { required: true, content: json(ref('ProfileUpdate')) },
        responses: {
          200: success('Đã cập nhật', ref('Profile'), { message: { type: 'string', example: 'cập nhật hồ sơ thành công' } }),
          400: fail('Dữ liệu không hợp lệ', 'Ngày sinh không được vượt quá ngày hiện tại.'),
        },
      },
    },
    '/api/user/avatar': {
      post: {
        tags: ['Người dùng'],
        summary: 'Tải ảnh đại diện (Base64 Data URL, png/jpg, tối đa 2MB)',
        security: BEARER,
        requestBody: {
          required: true,
          content: json(
            { type: 'object', required: ['imageBase64'], properties: { imageBase64: { type: 'string' } } },
            { imageBase64: 'data:image/png;base64,iVBORw0KGgo...' }
          ),
        },
        responses: {
          200: {
            description: 'Đã cập nhật ảnh',
            content: json({
              type: 'object',
              properties: {
                status: { type: 'string', example: 'success' },
                message: { type: 'string' },
                avatarUrl: { type: 'string' },
              },
            }),
          },
          400: fail('Sai định dạng hoặc quá dung lượng', 'Định dạng hợp lệ: chỉ chấp nhận .png/.jpg/.jpeg'),
        },
      },
    },
    '/api/user/addresses': {
      get: {
        tags: ['Người dùng'],
        summary: 'Sổ địa chỉ nhận hàng (mặc định đứng đầu)',
        security: BEARER,
        responses: {
          200: success('Danh sách địa chỉ', { type: 'array', items: ref('Address') }, { total: { type: 'integer' } }),
        },
      },
      post: {
        tags: ['Người dùng'],
        summary: 'Thêm địa chỉ nhận hàng',
        description: 'Địa chỉ đầu tiên tự động là mặc định.',
        security: BEARER,
        requestBody: { required: true, content: json(ref('AddressInput')) },
        responses: {
          201: success('Đã thêm', ref('Address'), { message: { type: 'string' } }),
          400: fail('Thiếu thông tin', 'Vui lòng nhập tên người nhận, số điện thoại và địa chỉ cụ thể.'),
        },
      },
    },
    '/api/user/addresses/{id}': {
      parameters: [idParam('ID địa chỉ')],
      put: {
        tags: ['Người dùng'],
        summary: 'Sửa địa chỉ nhận hàng',
        security: BEARER,
        requestBody: { required: true, content: json(ref('AddressInput')) },
        responses: {
          200: success('Đã cập nhật', ref('Address'), { message: { type: 'string' } }),
          404: fail('Không có địa chỉ', 'Không tìm thấy địa chỉ để cập nhật.'),
        },
      },
      delete: {
        tags: ['Người dùng'],
        summary: 'Xóa địa chỉ nhận hàng',
        description: 'Không cho xóa khi chỉ còn 1 địa chỉ. Xóa địa chỉ mặc định thì địa chỉ khác được đặt làm mặc định.',
        security: BEARER,
        responses: {
          200: {
            description: 'Đã xóa',
            content: json(ref('Error'), { status: 'success', message: 'Xóa địa chỉ thành công.' }),
          },
          400: fail('Chỉ còn 1 địa chỉ', 'Cần ít nhất 1 địa chỉ nhận hàng'),
          404: fail('Không có địa chỉ', 'Không tìm thấy địa chỉ.'),
        },
      },
    },
    '/api/user/addresses/{id}/default': {
      patch: {
        tags: ['Người dùng'],
        summary: 'Đặt làm địa chỉ mặc định',
        security: BEARER,
        parameters: [idParam('ID địa chỉ')],
        responses: {
          200: success('Đã đặt mặc định', ref('Address'), { message: { type: 'string' } }),
          404: fail('Không có địa chỉ', 'Không tìm thấy địa chỉ.'),
        },
      },
    },
    '/api/seller/orders': {
      get: {
        tags: ['Kênh người bán'],
        summary: 'Đơn hàng có sản phẩm của shop (seller, admin)',
        description: 'Mỗi dòng là một sản phẩm của shop trong một đơn. `summary` không tính đơn đã hủy.',
        security: BEARER,
        responses: {
          200: {
            description: 'Danh sách dòng đơn và thống kê',
            content: json({
              type: 'object',
              properties: {
                status: { type: 'string', example: 'success' },
                total: { type: 'integer' },
                summary: {
                  type: 'object',
                  properties: { orders: { type: 'integer' }, itemsSold: { type: 'integer' }, revenue: { type: 'number' } },
                },
                data: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      order_id: { type: 'integer' },
                      order_code: { type: 'string' },
                      status: { type: 'string' },
                      created_at: { type: 'string', format: 'date-time' },
                      buyer_username: { type: 'string', nullable: true },
                      recipient_name: { type: 'string' },
                      recipient_phone: { type: 'string' },
                      shipping_address: { type: 'string' },
                      product_id: { type: 'integer' },
                      product_name: { type: 'string' },
                      quantity: { type: 'integer' },
                      unit_price: { type: 'number' },
                      subtotal: { type: 'number' },
                    },
                  },
                },
              },
            }),
          },
          401: UNAUTHORIZED,
          403: FORBIDDEN,
        },
      },
    },
    '/api/admin/stats': {
      get: {
        tags: ['Quản trị'],
        summary: 'Thống kê toàn hệ thống',
        security: BEARER,
        responses: {
          200: success('Số liệu', {
            type: 'object',
            properties: {
              users: { type: 'object', example: { total: 3, admin: 1, seller: 1, user: 1 } },
              products: { type: 'object', example: { total: 24, outOfStock: 1 } },
              orders: {
                type: 'object',
                example: { total: 2, byStatus: { CREATED: 1, CONFIRMED: 0, DELIVERING: 0, COMPLETED: 1, CANCELLED: 0 } },
              },
              revenue: { type: 'number', description: 'Tổng tiền các đơn chưa hủy', example: 2500000 },
            },
          }),
          401: UNAUTHORIZED,
          403: FORBIDDEN,
        },
      },
    },
    '/api/admin/users': {
      get: {
        tags: ['Quản trị'],
        summary: 'Danh sách người dùng',
        security: BEARER,
        parameters: [
          { name: 'role', in: 'query', schema: ROLE_ENUM },
          { name: 'q', in: 'query', description: 'Tìm theo tên đăng nhập, email, số điện thoại', schema: { type: 'string' } },
        ],
        responses: {
          200: success(
            'Danh sách người dùng',
            {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  username: { type: 'string' },
                  email: { type: 'string' },
                  phone: { type: 'string' },
                  role: ROLE_ENUM,
                  created_at: { type: 'string', format: 'date-time' },
                  google_linked: { type: 'boolean' },
                  order_count: { type: 'integer' },
                  product_count: { type: 'integer' },
                },
              },
            },
            { total: { type: 'integer' } }
          ),
          401: UNAUTHORIZED,
          403: FORBIDDEN,
        },
      },
    },
    '/api/admin/users/{id}/role': {
      patch: {
        tags: ['Quản trị'],
        summary: 'Phân quyền người dùng',
        description: 'Có hiệu lực ngay ở request tiếp theo. Admin không tự đổi quyền của chính mình.',
        security: BEARER,
        parameters: [idParam('ID người dùng')],
        requestBody: {
          required: true,
          content: json({ type: 'object', required: ['role'], properties: { role: ROLE_ENUM } }, { role: 'seller' }),
        },
        responses: {
          200: success(
            'Đã đổi quyền',
            { type: 'object', properties: { id: { type: 'integer' }, username: { type: 'string' }, role: ROLE_ENUM } },
            { message: { type: 'string', example: 'Đã cập nhật quyền cho auramall_user.' } }
          ),
          400: fail('Quyền sai hoặc tự đổi quyền của mình', 'Không thể tự thay đổi quyền của chính mình.'),
          401: UNAUTHORIZED,
          403: FORBIDDEN,
          404: fail('Không có người dùng', 'Không tìm thấy người dùng.'),
        },
      },
    },
    '/api/admin/orders': {
      get: {
        tags: ['Quản trị'],
        summary: 'Toàn bộ đơn hàng (phân trang, lọc trạng thái)',
        security: BEARER,
        parameters: [
          { name: 'status', in: 'query', schema: ORDER_STATUS_ENUM },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: {
            description: 'Một trang đơn hàng, `buyer_username` = null là đơn khách vãng lai',
            content: json({
              type: 'object',
              properties: {
                status: { type: 'string', example: 'success' },
                total: { type: 'integer' },
                data: { type: 'array', items: ref('Order') },
                pagination: ref('Pagination'),
              },
            }),
          },
          401: UNAUTHORIZED,
          403: FORBIDDEN,
        },
      },
    },
    '/api/admin/orders/{id}/status': {
      patch: {
        tags: ['Quản trị'],
        summary: 'Cập nhật trạng thái đơn hàng',
        description: 'Chuyển sang `CANCELLED` sẽ hoàn lại tồn kho và lượt bán; đơn đã hủy không chuyển sang trạng thái khác.',
        security: BEARER,
        parameters: [idParam('ID đơn hàng')],
        requestBody: {
          required: true,
          content: json({ type: 'object', required: ['status'], properties: { status: ORDER_STATUS_ENUM } }, { status: 'CONFIRMED' }),
        },
        responses: {
          200: success(
            'Đã cập nhật',
            { type: 'object', properties: { id: { type: 'integer' }, status: { type: 'string' } } },
            { message: { type: 'string', example: 'Đã cập nhật trạng thái đơn hàng.' } }
          ),
          400: fail('Trạng thái không hợp lệ', 'Trạng thái phải là một trong: CREATED, CONFIRMED, DELIVERING, COMPLETED, CANCELLED.'),
          401: UNAUTHORIZED,
          403: FORBIDDEN,
          404: fail('Không có đơn hàng', 'Không tìm thấy đơn hàng.'),
          409: fail('Đơn đã hủy', 'Đơn hàng đã hủy, không thể chuyển sang trạng thái khác.'),
        },
      },
    },
  },
};
