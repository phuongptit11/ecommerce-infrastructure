#!/bin/bash
# ========================================================
# KỊCH BẢN SAO LƯU CƠ SỞ DỮ LIỆU AURAMALL (ĐỀ TÀI 07)
# Thực hiện sao lưu định kỳ PostgreSQL trong Docker Container
# ========================================================

set -e

BACKUP_DIR="./database/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/auramall_backup_${TIMESTAMP}.sql.gz"
DB_CONTAINER="${DB_CONTAINER:-ecommerce_database}"
DB_USER="${DB_USER:-ecommerce_user}"
DB_NAME="${DB_NAME:-ecommerce_db}"

mkdir -p "$BACKUP_DIR"

echo "=========================================="
echo "Bắt đầu sao lưu cơ sở dữ liệu: $DB_NAME"
echo "Thời gian: $(date)"
echo "Container: $DB_CONTAINER"
echo "=========================================="

# Kiểm tra container database có đang chạy không
if ! docker ps --format '{{.Names}}' | grep -w "$DB_CONTAINER" > /dev/null; then
    echo "LỖI: Container $DB_CONTAINER không hoạt động. Vui lòng chạy 'docker compose up -d database' trước."
    exit 1
fi

# Thực thi pg_dump trong container và nén gzip
docker exec -t "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$BACKUP_FILE"

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Sao lưu thành công!"
echo "Tệp sao lưu: $BACKUP_FILE (Dung lượng: $FILESIZE)"

# Tự động dọn dẹp các bản sao lưu cũ hơn 7 ngày (Retention policy)
find "$BACKUP_DIR" -type f -name "auramall_backup_*.sql.gz" -mtime +7 -exec rm {} \;
echo "Đã dọn dẹp các bản sao lưu cũ hơn 7 ngày."
