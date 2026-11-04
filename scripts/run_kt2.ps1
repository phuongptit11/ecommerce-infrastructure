# ========================================================
# KỊCH BẢN TỰ ĐỘNG THỰC HIỆN KIỂM THỬ KT2 (YÊU CẦU 3)
# Đề tài 07: Hạ tầng TMĐT 3 tầng (Nginx -> Node.js -> PostgreSQL)
# ========================================================

$ErrorActionPreference = "Continue"
$resultsDir = "docs/test-results"
if (-not (Test-Path $resultsDir)) {
    New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
}

$resourceStats = @{}

function Log-Message($msg) {
    $time = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$time] $msg"
}

function Capture-DockerStats($stageName) {
    Log-Message "Thu thập thông số tài nguyên (docker stats) cho giai đoạn: $stageName"
    try {
        $statsRaw = docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}"
        $list = @()
        foreach ($line in $statsRaw) {
            $parts = $line.Split(",")
            if ($parts.Length -ge 6) {
                $list += @{
                    Name = $parts[0]
                    CPU = $parts[1]
                    MemUsage = $parts[2]
                    MemPerc = $parts[3]
                    NetIO = $parts[4]
                    BlockIO = $parts[5]
                }
            }
        }
        $global:resourceStats[$stageName] = $list
        $statsTable = docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}" | Out-String
        $statsTable | Out-File "$resultsDir/stats_${stageName}.txt" -Encoding utf8
    } catch {
        Write-Warning "Không thể lấy docker stats: $_"
    }
}

Log-Message "=== BẮT ĐẦU KIỂM THỬ CHỊU TẢI KT2 (YÊU CẦU 3) ==="

# 0. Trạng thái nhàn rỗi (Baseline Idle)
Capture-DockerStats "idle"
Start-Sleep -Seconds 3

# ----------------------------------------------------
# 1. TÁC VỤ ĐỌC: GET /api/products (3 MỨC TẢI)
# ----------------------------------------------------

# Tác vụ Đọc - Mức 1: 20 VUs trong 30s
Log-Message "--- ĐỌC MỨC 1: 20 VUs (30s) ---"
$job = Start-Job -ScriptBlock { Start-Sleep -Seconds 12; docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}" }
$output = k6 run --vus 20 --duration 30s --summary-export="$resultsDir/read_level1_summary.json" loadtest/test-read.js 2>&1
$output | Out-File "$resultsDir/read_level1.txt" -Encoding utf8
$jobResult = Receive-Job $job
$resourceStats["read_level1"] = $jobResult
Remove-Job $job -Force
Start-Sleep -Seconds 5

# Tác vụ Đọc - Mức 2: 100 VUs trong 30s
Log-Message "--- ĐỌC MỨC 2: 100 VUs (30s) ---"
$job = Start-Job -ScriptBlock { Start-Sleep -Seconds 12; docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}" }
$output = k6 run --vus 100 --duration 30s --summary-export="$resultsDir/read_level2_summary.json" loadtest/test-read.js 2>&1
$output | Out-File "$resultsDir/read_level2.txt" -Encoding utf8
$jobResult = Receive-Job $job
$resourceStats["read_level2"] = $jobResult
Remove-Job $job -Force
Start-Sleep -Seconds 5

# Tác vụ Đọc - Mức 3: 300 VUs trong 30s
Log-Message "--- ĐỌC MỨC 3: 300 VUs (30s) ---"
$job = Start-Job -ScriptBlock { Start-Sleep -Seconds 12; docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}" }
$output = k6 run --vus 300 --duration 30s --summary-export="$resultsDir/read_level3_summary.json" loadtest/test-read.js 2>&1
$output | Out-File "$resultsDir/read_level3.txt" -Encoding utf8
$jobResult = Receive-Job $job
$resourceStats["read_level3"] = $jobResult
Remove-Job $job -Force
Start-Sleep -Seconds 5

# ----------------------------------------------------
# 2. TÁC VỤ GHI: POST /api/orders (3 MỨC TẢI)
# ----------------------------------------------------
Log-Message "Đồng bộ và làm mới tồn kho trước khi kiểm thử tác vụ Ghi..."
docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "UPDATE products SET stock = 500000 WHERE id BETWEEN 1 AND 20;" | Out-Null
Start-Sleep -Seconds 3

# Tác vụ Ghi - Mức 1: 20 VUs trong 30s
Log-Message "--- GHI MỨC 1: 20 VUs (30s) ---"
$job = Start-Job -ScriptBlock { Start-Sleep -Seconds 12; docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}" }
$output = k6 run --vus 20 --duration 30s --summary-export="$resultsDir/write_level1_summary.json" loadtest/test-write.js 2>&1
$output | Out-File "$resultsDir/write_level1.txt" -Encoding utf8
$jobResult = Receive-Job $job
$resourceStats["write_level1"] = $jobResult
Remove-Job $job -Force
Start-Sleep -Seconds 5

# Tác vụ Ghi - Mức 2: 100 VUs trong 30s
Log-Message "--- GHI MỨC 2: 100 VUs (30s) ---"
$job = Start-Job -ScriptBlock { Start-Sleep -Seconds 12; docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}" }
$output = k6 run --vus 100 --duration 30s --summary-export="$resultsDir/write_level2_summary.json" loadtest/test-write.js 2>&1
$output | Out-File "$resultsDir/write_level2.txt" -Encoding utf8
$jobResult = Receive-Job $job
$resourceStats["write_level2"] = $jobResult
Remove-Job $job -Force
Start-Sleep -Seconds 5

# Tác vụ Ghi - Mức 3: 300 VUs trong 30s
Log-Message "--- GHI MỨC 3: 300 VUs (30s) ---"
$job = Start-Job -ScriptBlock { Start-Sleep -Seconds 12; docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}" }
$output = k6 run --vus 300 --duration 30s --summary-export="$resultsDir/write_level3_summary.json" loadtest/test-write.js 2>&1
$output | Out-File "$resultsDir/write_level3.txt" -Encoding utf8
$jobResult = Receive-Job $job
$resourceStats["write_level3"] = $jobResult
Remove-Job $job -Force
Start-Sleep -Seconds 5

# ----------------------------------------------------
# 3. KỊCH BẢN TỔNG HỢP TMĐT FLASH SALE (80% ĐỌC, 20% GHI - 100s)
# ----------------------------------------------------
Log-Message "Làm mới tồn kho và bắt đầu kịch bản TMĐT tổng hợp Flash Sale..."
docker exec -i ecommerce_database psql -U ecommerce_user -d ecommerce_db -c "UPDATE products SET stock = 500000 WHERE id BETWEEN 1 AND 20;" | Out-Null
Start-Sleep -Seconds 3

Log-Message "--- KỊCH BẢN TỔNG HỢP: 80% ĐỌC / 20% GHI (STAGES: 20 -> 100 -> 300 VUs) ---"
$job = Start-Job -ScriptBlock { Start-Sleep -Seconds 45; docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}" }
$output = k6 run --summary-export="$resultsDir/ecommerce_full_summary.json" loadtest/ecommerce.js 2>&1
$output | Out-File "$resultsDir/ecommerce_full.txt" -Encoding utf8
$jobResult = Receive-Job $job
$resourceStats["ecommerce_full"] = $jobResult
Remove-Job $job -Force

# Lưu thống kê tài nguyên tổng hợp
$resourceStats | ConvertTo-Json -Depth 5 | Out-File "$resultsDir/resource_stats.json" -Encoding utf8

Log-Message "=== HOÀN TẤT TOÀN BỘ KIỂM THỬ KT2! ==="
