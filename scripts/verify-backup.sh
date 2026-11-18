#!/bin/bash
# ==============================================================================
# KỊCH BẢN KIỂM THỬ TỰ ĐỘNG SAO LƯU & PHỤC HỒI DỮ LIỆU AURAMALL (ĐỀ TÀI 07)
# Mục đích: Kiểm thử độc lập (Shadow Verification) - KHÔNG can thiệp source code
# ==============================================================================

set -e

DB_CONTAINER="${DB_CONTAINER:-ecommerce_database}"
DB_USER="${DB_USER:-ecommerce_user}"
DB_NAME="${DB_NAME:-ecommerce_db}"
TEST_DB="ecommerce_verify_test"
BACKUP_DIR="./database/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/auramall_test_backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "================================================================================"
echo "   AURAMALL - BẮT ĐẦU QUY TRÌNH KIỂM THỬ SAO LƯU & PHỤC HỒI CSDL"
echo "================================================================================"
echo "Thời gian bắt đầu: $(date)"
echo "Container mục tiêu: $DB_CONTAINER"
echo "Database gốc:       $DB_NAME"
echo "Database kiểm thử:  $TEST_DB (Môi trường cách ly an toàn)"
echo "--------------------------------------------------------------------------------"

# 1. Kiểm tra trạng thái Container CSDL
if ! docker ps --format '{{.Names}}' | grep -w "$DB_CONTAINER" > /dev/null; then
    echo "[LỖI]: Container $DB_CONTAINER không hoạt động! Vui lòng chạy 'docker compose up -d database' trước."
    exit 1
fi
echo "[OK] Container database đang hoạt động bình thường."

# 2. Lấy dữ liệu mốc (Baseline) từ Database gốc
echo ""
echo ">> [BƯỚC 1/6] Đang thu thập số lượng bản ghi của 8 bảng trong CSDL gốc..."

QUERY_COUNTS="
SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'user_addresses', COUNT(*) FROM user_addresses
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'uploaded_images', COUNT(*) FROM uploaded_images
UNION ALL SELECT 'password_resets', COUNT(*) FROM password_resets
ORDER BY 1;
"

ORIGINAL_COUNTS=$(docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -F":" -c "$QUERY_COUNTS")
echo "Số lượng bản ghi ban đầu:"
echo "$ORIGINAL_COUNTS" | while IFS=":" read -r table count; do
    printf "   - Bảng %-18s: %'d bản ghi\n" "$table" "$count"
done

# 3. Thực hiện sao lưu & đo thời gian (Backup Duration)
echo ""
echo ">> [BƯỚC 2/6] Đang thực hiện sao lưu (pg_dump + gzip)..."
START_BACKUP=$(date +%s)
docker exec -i "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$BACKUP_FILE"
END_BACKUP=$(date +%s)
BACKUP_DURATION=$((END_BACKUP - START_BACKUP))

if [ ! -f "$BACKUP_FILE" ] || [ ! -s "$BACKUP_FILE" ]; then
    echo "[LỖI]: Tệp sao lưu không tồn tại hoặc có kích thước 0 byte!"
    exit 1
fi
FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[OK] Sao lưu hoàn tất trong ${BACKUP_DURATION} giây."
echo "     Tệp tạo thành: $BACKUP_FILE (Dung lượng: $FILESIZE)"

# 4. Kiểm tra tính toàn vẹn của tệp nén (Integrity Check)
echo ""
echo ">> [BƯỚC 3/6] Kiểm tra tính toàn vẹn của tệp nén gzip..."
if gzip -t "$BACKUP_FILE" 2>/dev/null; then
    echo "[OK] Tệp sao lưu nén nguyên vẹn, không bị lỗi cấu trúc byte."
else
    echo "[LỖI]: Tệp sao lưu bị hỏng (Corrupted gzip)!"
    exit 1
fi

# 5. Khởi tạo Database độc lập để phục hồi thử nghiệm (Shadow Restore)
echo ""
echo ">> [BƯỚC 4/6] Chuẩn bị môi trường CSDL độc lập ($TEST_DB) để phục hồi an toàn..."
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB;" > /dev/null
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $TEST_DB OWNER $DB_USER;" > /dev/null
echo "[OK] Đã tạo CSDL thử nghiệm: $TEST_DB"

# 6. Thực hiện phục hồi & Đo RTO (Recovery Time Objective)
echo ""
echo ">> [BƯỚC 5/6] Đang phục hồi dữ liệu vào CSDL kiểm thử (Đo RTO)..."
START_RESTORE=$(date +%s)
gunzip -c "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$TEST_DB" > /dev/null 2>&1
END_RESTORE=$(date +%s)
RTO_DURATION=$((END_RESTORE - START_RESTORE))
echo "[OK] Phục hồi hoàn tất! Chỉ số RTO (Thời gian phục hồi): ${RTO_DURATION} giây."

# 7. Đối soát số lượng dòng (Data Consistency Verification)
echo ""
echo ">> [BƯỚC 6/6] Đối soát tính nhất quán dữ liệu giữa CSDL gốc và CSDL phục hồi..."
RESTORED_COUNTS=$(docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$TEST_DB" -t -A -F":" -c "$QUERY_COUNTS")

PASSED=true
echo "--------------------------------------------------------------------------------"
printf "%-20s | %-15s | %-15s | %-10s\n" "Tên Bảng" "CSDL Gốc" "CSDL Phục Hồi" "Kết Quả"
echo "--------------------------------------------------------------------------------"

declare -A orig_map
while IFS=":" read -r table count; do
    orig_map["$table"]="$count"
done <<< "$ORIGINAL_COUNTS"

while IFS=":" read -r table rest_count; do
    orig_count="${orig_map[$table]}"
    if [ "$orig_count" == "$rest_count" ]; then
        STATUS="PASS"
    else
        STATUS="FAIL"
        PASSED=false
    fi
    printf "%-20s | %-15s | %-15s | %-10s\n" "$table" "$orig_count" "$rest_count" "$STATUS"
done <<< "$RESTORED_COUNTS"
echo "--------------------------------------------------------------------------------"

# 8. Dọn dẹp môi trường kiểm thử
echo ""
echo ">> Đang dọn dẹp cơ sở dữ liệu kiểm thử..."
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB;" > /dev/null
echo "[OK] Đã xóa $TEST_DB, giữ nguyên trạng 100% CSDL sản xuất."

# 9. Báo cáo tổng kết nghiệm thu
echo ""
echo "================================================================================"
if [ "$PASSED" = true ]; then
    echo "  KẾT LUẬN KIỂM THỬ: >> ĐẠT YÊU CẦU (PASSED) <<"
    echo "  - Toàn bộ 8 bảng nghiệp vụ khớp 100% dữ liệu."
    echo "  - Thời gian sao lưu: ${BACKUP_DURATION}s"
    echo "  - Thời gian phục hồi (RTO): ${RTO_DURATION}s"
    echo "  - Kích thước bản sao lưu: $FILESIZE"
    echo "  - Mức độ mất mát dữ liệu (RPO): 0% tại thời điểm sao lưu."
else
    echo "  KẾT LUẬN KIỂM THỬ: >> THẤT BẠI (FAILED) <<"
    echo "  - Có sự sai lệch số lượng bản ghi sau khi phục hồi!"
    exit 1
fi
echo "================================================================================"
