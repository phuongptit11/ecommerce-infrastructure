#!/bin/bash

# ==============================================================================
# KỊCH BẢN PHỤC HỒI CƠ SỞ DỮ LIỆU CLOUD (RENDER POSTGRESQL) - AURAMALL
# Dự án: Thiết kế hạ tầng CNTT cho hệ thống Thương mại Điện tử (Đề tài 07)
# Thực hiện: SV3 (Database) - Mạc Đức Dương
# ==============================================================================

set -e

# 1. Nạp biến môi trường từ file .env (nếu có)
[ -f .env ] && export $(grep -v '^#' .env | xargs)

BACKUP_FILE="$1"
CLOUD_DB_URL="${2:-${RENDER_DB_URL:-$DATABASE_URL}}"

# 2. Kiểm tra tham số đầu vào
if [ -z "$BACKUP_FILE" ]; then
    echo "======================================================================"
    echo "Lỗi: Vui lòng cung cấp đường dẫn đến tệp sao lưu."
    echo "Cách dùng: bash scripts/restore-cloud.sh ./database/backups/<TEN_TEP_BACKUP>.sql.gz"
    echo "======================================================================"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Lỗi: Không tìm thấy tệp '$BACKUP_FILE'."
    exit 1
fi

if [ -z "$CLOUD_DB_URL" ]; then
    echo "======================================================================"
    echo "LỖI: Chưa cấu hình chuỗi kết nối CSDL Render!"
    echo "Cách 1: Khai báo vào file .env: RENDER_DB_URL=\"postgresql://...\""
    echo "Cách 2: Truyền URL vào tham số thứ 2: bash scripts/restore-cloud.sh <file> \"<url>\""
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

# 3. Cảnh báo an toàn tuyệt đối
echo "======================================================================"
echo "⚠️  CẢNH BÁO: THAO TÁC NÀY SẼ GHI ĐÈ / PHỤC HỒI CƠ SỞ DỮ LIỆU"
echo "    TRỰC TIẾP TRÊN CLOUD RENDER ĐANG PHỤC VỤ https://duytu205.id.vn!"
echo "======================================================================"
read -p "Bạn có chắc chắn muốn phục hồi từ tệp '$BACKUP_FILE' không? (y/N): " confirm

if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo ">>> Đã hủy thao tác phục hồi."
    exit 0
fi

START_TIME=$(date +%s%N 2>/dev/null || date +%s)
echo ">>> [CLOUD RESTORE] Đang giải nén luồng và nạp dữ liệu vào Render qua Internet..."

CONTAINER_NAME="ecommerce_database"

# 4. Thực thi nạp dữ liệu vào Cloud (lọc bỏ các câu lệnh yêu cầu quyền role postgres)
FILTER_CMD="grep -vE '^(SET ROLE|ALTER[[:space:]]+.*OWNER[[:space:]]+TO[[:space:]]+postgres|ALTER[[:space:]]+DEFAULT[[:space:]]+PRIVILEGES[[:space:]]+FOR[[:space:]]+ROLE[[:space:]]+postgres)'"

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    if [[ "$BACKUP_FILE" == *.gz ]]; then
        gunzip -c "$BACKUP_FILE" | eval "$FILTER_CMD" | docker exec -i "$CONTAINER_NAME" \
            psql -v ON_ERROR_STOP=1 "$CLOUD_DB_URL" > /dev/null
    else
        eval "$FILTER_CMD" < "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" \
            psql -v ON_ERROR_STOP=1 "$CLOUD_DB_URL" > /dev/null
    fi
else
    if [[ "$BACKUP_FILE" == *.gz ]]; then
        gunzip -c "$BACKUP_FILE" | eval "$FILTER_CMD" | docker run --rm -i postgres:15-alpine \
            psql -v ON_ERROR_STOP=1 "$CLOUD_DB_URL" > /dev/null
    else
        eval "$FILTER_CMD" < "$BACKUP_FILE" | docker run --rm -i postgres:15-alpine \
            psql -v ON_ERROR_STOP=1 "$CLOUD_DB_URL" > /dev/null
    fi
fi

END_TIME=$(date +%s%N 2>/dev/null || date +%s)
echo ">>> [THÀNH CÔNG] Dữ liệu CSDL Render đã được phục hồi hoàn tất!"
echo ">>> Hãy mở trình duyệt truy cập https://duytu205.id.vn và nhấn F5 để kiểm tra đơn hàng!"
