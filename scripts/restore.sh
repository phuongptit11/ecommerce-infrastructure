#!/bin/bash

# Dừng kịch bản nếu có lỗi xảy ra
set -e

# 1. Nạp biến môi trường từ file .env (nếu có)
[ -f .env ] && export $(grep -v '^#' .env | xargs)

# 2. Cấu hình thông số với giá trị mặc định
CONTAINER_NAME="ecommerce_database"
DB_NAME="${DB_NAME:-ecommerce_db}"
DB_USER="${DB_USER:-ecommerce_user}"
DB_PASSWORD="${DB_PASSWORD:-ecommerce_secret}"

BACKUP_FILE="$1"

# 3. Kiểm tra tham số đầu vào
if [ -z "$BACKUP_FILE" ]; then
    echo "Lỗi: Vui lòng cung cấp đường dẫn đến tệp sao lưu."
    echo "Cách dùng: bash scripts/restore.sh ./database/backups/<TEN_TEP_BACKUP>.sql.gz"
    exit 1
fi

# Kiểm tra tệp sao lưu có tồn tại không
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Lỗi: Không tìm thấy tệp '$BACKUP_FILE'."
    exit 1
fi

# Kiểm tra trạng thái container
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Lỗi: Container '${CONTAINER_NAME}' chưa chạy. Vui lòng khởi động hệ thống bằng: docker compose up -d"
    exit 1
fi

# 4. Cảnh báo an toàn (Theo mục 4.1 của tài liệu)
echo "CẢNH BÁO: Thao tác này sẽ GHI ĐÈ TOÀN BỘ dữ liệu hiện tại của CSDL '${DB_NAME}'!"
read -p "Bạn có chắc chắn muốn phục hồi từ tệp '$BACKUP_FILE' không? (y/N): " confirm

if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Đã hủy thao tác phục hồi."
    exit 0
fi

echo "Đang nạp dữ liệu từ '$BACKUP_FILE' vào cơ sở dữ liệu..."

# 5. Xử lý nạp dữ liệu (Hỗ trợ cả file nén .gz và file raw .sql)
if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" > /dev/null
else
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE" > /dev/null
fi

# Khởi động lại Backend để đồng bộ các connection pool hoặc cache (nếu cần)
echo "Đang khởi động lại Backend để đồng bộ dữ liệu..."
docker compose restart backend

echo "Hoàn tất phục hồi dữ liệu thành công!"