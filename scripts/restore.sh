#!/bin/bash
# ========================================================
# KỊCH BẢN PHỤC HỒI CƠ SỞ DỮ LIỆU AURAMALL (ĐỀ TÀI 07)
# Thực hiện phục hồi dữ liệu từ bản sao lưu .sql hoặc .sql.gz
# ========================================================

set -e

BACKUP_FILE="$1"
DB_CONTAINER="${DB_CONTAINER:-ecommerce_database}"
DB_USER="${DB_USER:-ecommerce_user}"
DB_NAME="${DB_NAME:-ecommerce_db}"

if [ -z "$BACKUP_FILE" ]; then
    echo "Cách sử dụng: ./scripts/restore.sh <duong_dan_tep_backup>"
    echo "Ví dụ: ./scripts/restore.sh ./database/backups/auramall_backup_20261103_120000.sql.gz"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "LỖI: Tệp sao lưu không tồn tại: $BACKUP_FILE"
    exit 1
fi

echo "=========================================="
echo "CẢNH BÁO: Thao tác này sẽ ghi đè toàn bộ dữ liệu hiện tại của $DB_NAME"
echo "Tệp phục hồi: $BACKUP_FILE"
echo "Container: $DB_CONTAINER"
echo "=========================================="
read -p "Bạn có chắc chắn muốn tiếp tục không? (y/N): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Đã hủy thao tác phục hồi."
    exit 0
fi

# Kiểm tra container database
if ! docker ps --format '{{.Names}}' | grep -w "$DB_CONTAINER" > /dev/null; then
    echo "LỖI: Container $DB_CONTAINER không hoạt động. Vui lòng bật hệ thống trước."
    exit 1
fi

echo "Đang phục hồi dữ liệu..."
if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"
else
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE"
fi

echo "Phục hồi cơ sở dữ liệu thành công hoàn tất!"
