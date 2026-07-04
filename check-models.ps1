# 從 .env 讀取 GEMINI_API_KEY
$envLine = Get-Content "$PSScriptRoot\.env" | Where-Object { $_ -match "^GEMINI_API_KEY=" }
$key = $envLine -replace "^GEMINI_API_KEY=", ""

if (-not $key) {
    Write-Host "找不到 GEMINI_API_KEY，請確認 .env 已設定" -ForegroundColor Red
    exit 1
}

foreach ($version in @("v1beta", "v1alpha")) {
    Write-Host "`n--- $version ---" -ForegroundColor Cyan
    try {
        $resp = (Invoke-WebRequest "https://generativelanguage.googleapis.com/$version/models?key=$key" -ErrorAction Stop).Content | ConvertFrom-Json
        $live = $resp.models | Where-Object { $_.supportedGenerationMethods -contains "bidiGenerateContent" }
        if ($live) {
            Write-Host "找到 Live 模型：" -ForegroundColor Green
            $live | Select-Object name | Format-Table -AutoSize
        } else {
            Write-Host "無 bidiGenerateContent 模型" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "查詢失敗：$($_.Exception.Message)" -ForegroundColor Red
    }
}
