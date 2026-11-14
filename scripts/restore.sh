#!/bin/bash
# ==============================================================================
# KỊCH BẢN PHỤC HỒI CSDL AURAMALL (TẦNG 3: POSTGRESQL 15)
# Cách 1 (Từ file backup): bash scripts/restore.sh backups/ten_file.sql
# Cách 2 (Reset về gốc):   bash scripts/restore.sh --reset
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

# Kiểm tra container ecommerce_database có đang chạy không
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Lỗi: Container '${CONTAINER_NAME}' chưa chạy!"
    echo "👉 Hãy chạy: docker compose up -d"
    exit 1
fi

# Kiểm tra tham số đầu vào
if [ -z "$1" ]; then
    echo "⚠️  Vui lòng truyền đường dẫn file backup hoặc cờ --reset!"
    echo "   👉 Phục hồi từ file: bash scripts/restore.sh <file_backup.sql>"
    echo "   👉 Reset về ban đầu: bash scripts/restore.sh --reset"
    if [ -d "./backups" ] && [ "$(ls -A ./backups 2>/dev/null)" ]; then
        echo ""
        echo "📂 Danh sách file backup hiện có:"
        ls -1t ./backups/*.sql* 2>/dev/null | head -n 5
    fi
    exit 1
fi

# Hàm làm sạch schema public để tránh xung đột khóa ngoại & bảng cũ
clean_schema() {
    echo "🧹 Đang làm sạch schema public trên '${DB_NAME}'..."
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -c "
            DROP SCHEMA public CASCADE;
            CREATE SCHEMA public;
            GRANT ALL ON SCHEMA public TO $DB_USER;
            GRANT ALL ON SCHEMA public TO public;
        " > /dev/null
}

# CHẾ ĐỘ 1: Reset trực tiếp từ volume mount (/docker-entrypoint-initdb.d/)
if [ "$1" == "--reset" ]; then
    clean_schema
    echo "📐 [1/2] Đang chạy lại 01-schema.sql trong container..."
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /docker-entrypoint-initdb.d/01-schema.sql > /dev/null

    echo "🌱 [2/2] Đang chạy lại 02-seed.sql trong container..."
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /docker-entrypoint-initdb.d/02-seed.sql > /dev/null

    echo "🔄 Đang khởi động lại tầng Backend để đồng bộ миграции/ảnh sản phẩm..."
    docker compose restart backend
    echo "✅ Đã khôi phục CSDL AuraMall về trạng thái gốc (schema + seed) thành công!"
    exit 0
fi

# CHẾ ĐỘ 2: Restore từ file backup truyền vào
BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Lỗi: Không tìm thấy file '$BACKUP_FILE'!"
    exit 1
fi

clean_schema
echo "📥 Đang nạp dữ liệu từ '$BACKUP_FILE' vào container '${CONTAINER_NAME}'..."

if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" > /dev/null
else
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE" > /dev/null
fi

echo "🔄 Đang khởi động lại service backend..."
docker compose restart backend

echo "✅ Phục hồi dữ liệu từ '$BACKUP_FILE' hoàn tất!"
