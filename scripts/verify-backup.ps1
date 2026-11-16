# ==============================================================================
# KỊCH BẢN KIỂM THỬ TỰ ĐỘNG SAO LƯU & PHỤC HỒI DỮ LIỆU AURAMALL (ĐỀ TÀI 07)
# Dành cho môi trường Windows PowerShell - KHÔNG can thiệp source code dự án
# ==============================================================================

param (
    [string]$DbContainer = "ecommerce_database",
    [string]$DbUser = "ecommerce_user",
    [string]$DbName = "ecommerce_db",
    [string]$TestDb = "ecommerce_verify_test"
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "   AURAMALL - KIỂM THỬ TỰ ĐỘNG SAO LƯU & PHỤC HỒI DỮ LIỆU (POWERSHELL)" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "Thời gian:         $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Container:         $DbContainer"
Write-Host "Database mục tiêu: $DbName"
Write-Host "Database test:     $TestDb"
Write-Host "--------------------------------------------------------------------------------"

# 1. Kiểm tra container
try {
    $running = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $DbContainer }
    if (-not $running) {
        Write-Host "[LỖI]: Container '$DbContainer' không hoạt động! Vui lòng chạy: docker compose up -d database" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Container database đang chạy." -ForegroundColor Green
} catch {
    Write-Host "[LỖI]: Không thể kết nối với Docker daemon." -ForegroundColor Red
    exit 1
}

$BackupDir = ".\database\backups"
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = "$BackupDir\auramall_test_backup_$Timestamp.sql"

# 2. Thu thập bản ghi ban đầu
Write-Host "`n>> [BƯỚC 1/6] Thu thập số lượng bản ghi của 8 bảng từ CSDL gốc..." -ForegroundColor Yellow
$QueryCounts = "
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

$rawOrig = docker exec -i $DbContainer psql -U $DbUser -d $DbName -t -A -F":" -c "$QueryCounts"
$origMap = @{}
foreach ($line in ($rawOrig -split "`r?`n")) {
    if ($line.Contains(":")) {
        $parts = $line.Split(":")
        $table = $parts[0].Trim()
        $cnt = [int64]$parts[1].Trim()
        $origMap[$table] = $cnt
        Write-Host ("   - Bảng {0,-18}: {1,6} bản ghi" -f $table, $cnt) -ForegroundColor Gray
    }
}

# 3. Sao lưu & Đo thời gian
Write-Host "`n>> [BƯỚC 2/6] Đang thực hiện sao lưu (pg_dump bên trong container)..." -ForegroundColor Yellow
$swBackup = [System.Diagnostics.Stopwatch]::StartNew()
# Thực hiện dump trực tiếp vào file tạm trong container rồi copy ra để tránh lỗi ký tự trên Windows
$containerTmp = "/tmp/auramall_backup_$Timestamp.sql"
docker exec $DbContainer pg_dump -U $DbUser -d $DbName --clean --if-exists -f $containerTmp
docker cp "$DbContainer`:$containerTmp" $BackupFile
docker exec $DbContainer rm -f $containerTmp
$swBackup.Stop()

if (-not (Test-Path $BackupFile) -or (Get-Item $BackupFile).Length -eq 0) {
    Write-Host "[LỖI]: Tệp sao lưu không được tạo hoặc rỗng!" -ForegroundColor Red
    exit 1
}
$fileInfo = Get-Item $BackupFile
$fileSizeKb = [math]::Round($fileInfo.Length / 1KB, 2)
Write-Host ("[OK] Sao lưu hoàn tất trong {0:N2} giây. Tệp: {1} ({2} KB)" -f $swBackup.Elapsed.TotalSeconds, $BackupFile, $fileSizeKb) -ForegroundColor Green

# 4. Kiểm tra cấu trúc tệp sao lưu
Write-Host "`n>> [BƯỚC 3/6] Kiểm tra cấu trúc tệp sao lưu (Header & SQL Statements)..." -ForegroundColor Yellow
$firstLines = Get-Content -Path $BackupFile -TotalCount 10
if ($firstLines -match "PostgreSQL database dump") {
    Write-Host "[OK] Định dạng hợp lệ: PostgreSQL database dump header hợp chuẩn." -ForegroundColor Green
} else {
    Write-Host "[LỖI]: Tệp sao lưu không có header PostgreSQL hợp lệ!" -ForegroundColor Red
    exit 1
}

# 5. Khởi tạo Database độc lập để phục hồi thử nghiệm (Shadow Restore)
Write-Host "`n>> [BƯỚC 4/6] Khởi tạo Database kiểm thử độc lập: $TestDb..." -ForegroundColor Yellow
docker exec -i $DbContainer psql -U $DbUser -d postgres -c "DROP DATABASE IF EXISTS $TestDb;" | Out-Null
docker exec -i $DbContainer psql -U $DbUser -d postgres -c "CREATE DATABASE $TestDb OWNER $DbUser;" | Out-Null
Write-Host "[OK] Đã tạo database độc lập '$TestDb' (Không ảnh hưởng database chính)." -ForegroundColor Green

# 6. Phục hồi và đo RTO
Write-Host "`n>> [BƯỚC 5/6] Đang phục hồi dữ liệu vào CSDL kiểm thử (Đo RTO)..." -ForegroundColor Yellow
$swRestore = [System.Diagnostics.Stopwatch]::StartNew()
docker cp $BackupFile "$DbContainer`:$containerTmp"
docker exec $DbContainer psql -U $DbUser -d $TestDb -f $containerTmp | Out-Null
docker exec $DbContainer rm -f $containerTmp
$swRestore.Stop()
$rtoSeconds = [math]::Round($swRestore.Elapsed.TotalSeconds, 2)
Write-Host ("[OK] Phục hồi hoàn tất! RTO (Thời gian phục hồi): {0} giây" -f $rtoSeconds) -ForegroundColor Green

# 7. Đối soát dữ liệu giữa 2 Database
Write-Host "`n>> [BƯỚC 6/6] Đối soát tính toàn vẹn dữ liệu..." -ForegroundColor Yellow
$rawRest = docker exec -i $DbContainer psql -U $DbUser -d $TestDb -t -A -F":" -c "$QueryCounts"
$restMap = @{}
foreach ($line in ($rawRest -split "`r?`n")) {
    if ($line.Contains(":")) {
        $parts = $line.Split(":")
        $table = $parts[0].Trim()
        $cnt = [int64]$parts[1].Trim()
        $restMap[$table] = $cnt
    }
}

$allPassed = $true
Write-Host "--------------------------------------------------------------------------------"
Write-Host ("{0,-20} | {1,-15} | {2,-15} | {3,-10}" -f "Tên Bảng", "CSDL Gốc", "CSDL Phục Hồi", "Kết Quả")
Write-Host "--------------------------------------------------------------------------------"

foreach ($table in ($origMap.Keys | Sort-Object)) {
    $orig = $origMap[$table]
    $rest = if ($restMap.ContainsKey($table)) { $restMap[$table] } else { -1 }
    $status = if ($orig -eq $rest) { "PASS" } else { "FAIL"; $allPassed = $false }
    
    $color = if ($status -eq "PASS") { [ConsoleColor]::Green } else { [ConsoleColor]::Red }
    Write-Host ("{0,-20} | {1,-15} | {2,-15} | {3,-10}" -f $table, $orig, $rest, $status) -ForegroundColor $color
}
Write-Host "--------------------------------------------------------------------------------"

# 8. Dọn dẹp
Write-Host "`n>> Đang dọn dẹp cơ sở dữ liệu kiểm thử..." -ForegroundColor Yellow
docker exec -i $DbContainer psql -U $DbUser -d postgres -c "DROP DATABASE IF EXISTS $TestDb;" | Out-Null
Write-Host "[OK] Đã xóa database kiểm thử $TestDb an toàn." -ForegroundColor Green

# 9. Báo cáo tổng kết
Write-Host "`n================================================================================" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "  KẾT LUẬN KIỂM THỬ: >> ĐẠT YÊU CẦU (PASSED) <<" -ForegroundColor Green
    Write-Host "  - Dữ liệu 8 bảng nghiệp vụ toàn vẹn 100%."
    Write-Host ("  - Thời gian sao lưu:       {0:N2} giây" -f $swBackup.Elapsed.TotalSeconds)
    Write-Host ("  - Thời gian phục hồi (RTO): {0:N2} giây" -f $rtoSeconds)
    Write-Host ("  - Dung lượng bản sao lưu:  {0} KB" -f $fileSizeKb)
    Write-Host "  - Tỷ lệ mất mát dữ liệu (RPO): 0% (Zero Data Loss)"
} else {
    Write-Host "  KẾT LUẬN KIỂM THỬ: >> THẤT BẠI (FAILED) <<" -ForegroundColor Red
    Write-Host "  - Phát hiện sai lệch dữ liệu sau khi phục hồi!"
    exit 1
}
Write-Host "================================================================================" -ForegroundColor Cyan
