#!/bin/bash

set -e

# 1. Nạp biến môi trường từ file .env (nếu có)
[ -f .env ] && export $(grep -v '^#' .env | xargs)

# 2. Cấu hình thông số với giá trị mặc định dự phòng
CONTAINER_NAME="ecommerce_database"
DB_NAME="${DB_NAME:-ecommerce_db}"
DB_USER="${DB_USER:-ecommerce_user}"
DB_PASSWORD="${DB_PASSWORD:-ecommerce_secret}"

BACKUP_DIR="./database/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/auramall_backup_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=7

# 3. Kiểm tra trạng thái container
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Lỗi: Container '${CONTAINER_NAME}' chưa chạy. Vui lòng khởi động bằng: docker compose up -d"
    exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Đang sao lưu và nén CSDL '${DB_NAME}'..."

# 4. Ép nén gzip thời gian thực & Truyền mật khẩu an toàn
docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner | gzip > "$BACKUP_FILE"

# 5. Kịch bản nghiệm thu tự động (Validation)
if gzip -t "$BACKUP_FILE"; then
    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "Sao lưu toàn vẹn: $BACKUP_FILE ($FILE_SIZE)"
else
    echo "Lỗi: Quá trình nén thất bại hoặc file hỏng. Đang xóa bản sao lưu lỗi..."
    rm -f "$BACKUP_FILE"
    exit 1
fi

# 6. Áp dụng chính sách lưu trữ (Xóa file rác cũ hơn 7 ngày)
echo "Đang dọn dẹp các bản sao lưu cũ hơn $RETENTION_DAYS ngày..."
find "$BACKUP_DIR" -type f -name "auramall_backup_*.sql.gz" -mtime +$RETENTION_DAYS -exec rm -f {} \;

echo "Hoàn tất kịch bản sao lưu!"