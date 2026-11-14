#!/bin/bash
# ==============================================================================
# KỊCH BẢN SAO LƯU CSDL AURAMALL (TẦNG 3: POSTGRESQL 15)
# Chạy lệnh: bash scripts/backup.sh
# ==============================================================================

set -e

# Tự động nạp biến môi trường từ file .env (nếu có)
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

CONTAINER_NAME="ecommerce_database"
DB_NAME="${DB_NAME:-ecommerce_db}"
DB_USER="${DB_USER:-ecommerce_user}"
DB_PASSWORD="${DB_PASSWORD:-ecommerce_secret}"

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/auramall_${DB_NAME}_${TIMESTAMP}.sql"

# Kiểm tra container ecommerce_database có đang chạy không
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Lỗi: Container '${CONTAINER_NAME}' chưa chạy!"
    echo "👉 Hãy khởi động hệ thống bằng: docker compose up -d"
    exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "⏳ Đang sao lưu CSDL '${DB_NAME}' từ container '${CONTAINER_NAME}'..."

# Xuất dữ liệu kèm cờ --clean --if-exists để khi restore tự động xóa bảng cũ
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner > "$BACKUP_FILE"

echo "✅ Sao lưu hoàn tất!"
echo "📁 File lưu tại: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
echo "🔄 Lệnh khôi phục tương ứng: bash scripts/restore.sh $BACKUP_FILE"
