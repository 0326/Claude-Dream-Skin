# Claude Dream Skin — Windows Launcher(与 macos/launcher.sh 同构)
# 关旧进程 → 带 --remote-debugging-port 重新拉起 → 等 CDP 就绪 → 启动 Injector。
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($env:CLAUDE_DREAM_SKIN_PORT) { [int]$env:CLAUDE_DREAM_SKIN_PORT } else { 9222 }

# 定位 claude.exe(Squirrel 安装布局:根目录入口或 app-<版本>\ 下)
$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'AnthropicClaude\claude.exe')
)
$candidates += Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'AnthropicClaude\app-*') -Filter 'claude.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | ForEach-Object { $_.FullName }
$ClaudeExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ClaudeExe) {
    Write-Error "找不到 claude.exe(查找路径: $env:LOCALAPPDATA\AnthropicClaude),请先安装 Claude Desktop。"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "需要 Node.js >= 22(https://nodejs.org),未在 PATH 中找到 node。"
}

# 1. 关闭已运行的 Claude
$running = Get-Process -Name 'claude' -ErrorAction SilentlyContinue
if ($running) {
    Write-Host '▸ 正在关闭已运行的 Claude...'
    $running | ForEach-Object { $_.CloseMainWindow() | Out-Null }
    if (-not ($running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue)) {
        Get-Process -Name 'claude' -ErrorAction SilentlyContinue | Stop-Process -Force
    }
    Start-Sleep -Seconds 1
}

# 2. 带调试端口重新拉起
Write-Host "▸ 以 --remote-debugging-port=$Port 启动 Claude..."
Start-Process -FilePath $ClaudeExe -ArgumentList "--remote-debugging-port=$Port"

# 3. 轮询 CDP 端口就绪
Write-Host '▸ 等待 CDP 端口就绪...'
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 | Out-Null
        $ready = $true
        break
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
if (-not $ready) {
    Write-Error '30 秒内 CDP 端口未就绪,Claude 可能没有接受 --remote-debugging-port 参数。'
}

# 4. 前台长驻 Injector(Ctrl+C 停止换肤;之后正常打开 Claude 即完全还原)
Write-Host '▸ 启动 Injector(Ctrl+C 停止换肤)'
& node (Join-Path $Root 'injector\index.js') --port $Port
