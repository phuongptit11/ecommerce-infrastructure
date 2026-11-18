#!/bin/bash

set -e

# Nạp biến môi trường
[ -f .env ] && export $(grep -v '^#' .env | xargs)

CONTAINER_NAME="ecommerce_database"
DB_NAME="${DB_NAME:-ecommerce_db}"
DB_USER="${DB_USER:-ecommerce_user}"
DB_PASSWORD="${DB_PASSWORD:-ecommerce_secret}"

# Kiểm tra container
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Lỗi: Container '${CONTAINER_NAME}' chưa chạy. Vui lòng chạy: docker compose up -d"
    exit 1
fi

# Kiểm tra tham số
if [ -z "$1" ]; then
    echo "Cách dùng:"
    echo "  Phục hồi từ file: bash scripts/restore.sh <file_backup.sql>"
    echo "  Reset về ban đầu: bash scripts/restore.sh --reset"
    exit 1
fi

# Hàm làm sạch CSDL
clean_schema() {
    echo "Đang làm sạch schema public..."
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -c "
            DROP SCHEMA public CASCADE;
            CREATE SCHEMA public;
            GRANT ALL ON SCHEMA public TO $DB_USER;
            GRANT ALL ON SCHEMA public TO public;
        " > /dev/null
}

if [ "$1" == "--reset" ]; then
    clean_schema
    echo "Đang chạy file 01-schema.sql..."
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /docker-entrypoint-initdb.d/01-schema.sql > /dev/null

    echo "Đang chạy file 02-seed.sql..."
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /docker-entrypoint-initdb.d/02-seed.sql > /dev/null
else
    BACKUP_FILE="$1"
    if [ ! -f "$BACKUP_FILE" ]; then
        echo "Lỗi: Không tìm thấy file '$BACKUP_FILE'."
        exit 1
    fi

    clean_schema
    echo "Đang nạp dữ liệu từ '$BACKUP_FILE'..."
    
    if [[ "$BACKUP_FILE" == *.gz ]]; then
        gunzip -c "$BACKUP_FILE" | docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
            psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" > /dev/null
    else
        docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
            psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE" > /dev/null
    fi
fi

echo "Đang khởi động lại backend..."
docker compose restart backend

echo "Hoàn tất phục hồi dữ liệu!"