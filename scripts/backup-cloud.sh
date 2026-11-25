#!/bin/bash

# ==============================================================================
# KỊCH BẢN SAO LƯU CƠ SỞ DỮ LIỆU CLOUD (RENDER POSTGRESQL) - AURAMALL
# Dự án: Thiết kế hạ tầng CNTT cho hệ thống Thương mại Điện tử (Đề tài 07)
# Thực hiện: SV3 (Database) - Mạc Đức Dương
# ==============================================================================

set -e

# 1. Nạp biến môi trường từ file .env (nếu có)
[ -f .env ] && export $(grep -v '^#' .env | xargs)

# 2. Kiểm tra chuỗi kết nối Cloud Database (ưu tiên tham số đầu vào $1, rồi đến RENDER_DB_URL, rồi đến DATABASE_URL)
CLOUD_DB_URL="${1:-${RENDER_DB_URL:-$DATABASE_URL}}"

if [ -z "$CLOUD_DB_URL" ]; then
    echo "======================================================================"
    echo "LỖI: Chưa cấu hình chuỗi kết nối CSDL Render!"
    echo "Cách 1: Khai báo vào file .env:"
    echo "  RENDER_DB_URL=\"postgresql://ecommerce_user:A08US2EWaow9aP9kPOTFBoxmicrfRfle@dpg-dbstvaoae00c73934arg-a.singapore-postgres.render.com/ecommerce_db_eq41?sslmode=require\""
    echo "Cách 2: Truyền trực tiếp URL vào tham số lệnh:"
    echo "  bash scripts/backup-cloud.sh \"postgresql://...\""
    echo "======================================================================"
    exit 1
fi

# Tự động bổ sung ?sslmode=require nếu chưa có (Render bắt buộc SSL)
if [[ "$CLOUD_DB_URL" != *"sslmode="* ]]; then
    if [[ "$CLOUD_DB_URL" == *"?"* ]]; then
        CLOUD_DB_URL="${CLOUD_DB_URL}&sslmode=require"
    else
        CLOUD_DB_URL="${CLOUD_DB_URL}?sslmode=require"
    fi
fi

BACKUP_DIR="./database/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/auramall_render_backup_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=7
CONTAINER_NAME="ecommerce_database"

mkdir -p "$BACKUP_DIR"

echo ">>> [CLOUD BACKUP] Đang kết nối tới CSDL Render qua Internet..."
echo ">>> Mục tiêu: Sao lưu toàn phần CSDL phục vụ website https://duytu205.id.vn"

# 3. Thực thi pg_dump logic stream qua Docker container
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    docker exec -i "$CONTAINER_NAME" \
        pg_dump "$CLOUD_DB_URL" --clean --if-exists --no-owner | gzip > "$BACKUP_FILE"
else
    docker run --rm -i postgres:15-alpine \
        pg_dump "$CLOUD_DB_URL" --clean --if-exists --no-owner | gzip > "$BACKUP_FILE"
fi

# 4. Kiểm tra tính toàn vẹn (Validation)
if gzip -t "$BACKUP_FILE"; then
    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo ">>> [THÀNH CÔNG] Bản sao lưu Cloud toàn vẹn: $BACKUP_FILE ($FILE_SIZE)"
else
    echo ">>> [LỖI] Quá trình nén thất bại hoặc file hỏng. Đang xóa file lỗi..."
    rm -f "$BACKUP_FILE"
    exit 1
fi

# 5. Dọn dẹp bản sao lưu cũ > 7 ngày
find "$BACKUP_DIR" -type f -name "auramall_render_backup_*.sql.gz" -mtime +$RETENTION_DAYS -exec rm -f {} \;

echo ">>> HOÀN TẤT SAO LƯU CSDL CLOUD RENDER!"
