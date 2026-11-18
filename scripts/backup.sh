#!/bin/bash

set -e

# Nạp biến môi trường
[ -f .env ] && export $(grep -v '^#' .env | xargs)

CONTAINER_NAME="ecommerce_database"
DB_NAME="${DB_NAME:-ecommerce_db}"
DB_USER="${DB_USER:-ecommerce_user}"
DB_PASSWORD="${DB_PASSWORD:-ecommerce_secret}"

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/auramall_${DB_NAME}_${TIMESTAMP}.sql"

# Kiểm tra container
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Lỗi: Container '${CONTAINER_NAME}' chưa chạy. Vui lòng chạy: docker compose up -d"
    exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Đang sao lưu CSDL '${DB_NAME}'..."

# Xuất dữ liệu
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner > "$BACKUP_FILE"

echo "Sao lưu hoàn tất: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
echo "Lệnh khôi phục: bash scripts/restore.sh $BACKUP_FILE"