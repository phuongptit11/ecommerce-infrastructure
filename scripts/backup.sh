#!/bin/bash

# Dừng kịch bản ngay lập tức nếu có bất kỳ lỗi nào xảy ra
set -e

# ==============================================================================
# CẤU HÌNH BIẾN MÔI TRƯỜNG
# ==============================================================================
CONTAINER_NAME="ecommerce_database"
DB_USER="ecommerce_user"
DB_NAME="ecommerce_db"

BACKUP_DIR="./database/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/auramall_backup_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=7

# ==============================================================================
# QUY TRÌNH SAO LƯU (BACKUP)
# ==============================================================================

# 1. Kiểm tra trạng thái hoạt động của container CSDL
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Lỗi: Container '${CONTAINER_NAME}' hiện không hoạt động."
    echo "Vui lòng khởi động hệ thống Docker (docker compose up -d) trước khi sao lưu."
    exit 1
fi

# 2. Đảm bảo thư mục lưu trữ tồn tại
mkdir -p "$BACKUP_DIR"

echo "Đang tiến hành sao lưu logic toàn phần CSDL '${DB_NAME}'..."

# 3, 4 & 5. Chạy pg_dump với các cờ quy định và nén gzip luồng dữ liệu theo thời gian thực
docker exec -i "$CONTAINER_NAME" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$BACKUP_FILE"

# Kiểm tra tính toàn vẹn của tệp nén (Nghiệm thu theo mục 3.3)
if gzip -t "$BACKUP_FILE"; then
    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "Sao lưu thành công! Tệp tin đảm bảo toàn vẹn."
    echo "Vị trí lưu trữ: $BACKUP_FILE (Kích thước: $FILE_SIZE)"
else
    echo "Lỗi: Quá trình nén dữ liệu thất bại hoặc tệp bị hỏng byte."
    rm -f "$BACKUP_FILE"
    exit 1
fi

# 6. Chính sách lưu trữ (Retention Policy): Dọn dẹp tệp cũ hơn 7 ngày
echo "Đang dọn dẹp các bản sao lưu cũ hơn $RETENTION_DAYS ngày..."
find "$BACKUP_DIR" -type f -name "auramall_backup_*.sql.gz" -mtime +$RETENTION_DAYS -exec rm -f {} \;

echo "Hoàn tất kịch bản sao lưu!"
