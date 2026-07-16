# Claude Dream Skin — Windows 安装脚本
# 检查依赖 → 生成默认配置 → 创建桌面快捷方式。
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot

Write-Host '=============================================='
Write-Host '  Claude Dream Skin 安装向导'
Write-Host '=============================================='

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host '❌ 未找到 Node.js,请先安装 Node.js >= 22: https://nodejs.org'
    Read-Host '按回车退出'
    exit 1
}
Write-Host "✓ Node.js $(node --version)"

if (-not (Test-Path (Join-Path $env:LOCALAPPDATA 'AnthropicClaude'))) {
    Write-Host '❌ 未找到 Claude Desktop 安装目录,请先安装 Claude Desktop。'
    Read-Host '按回车退出'
    exit 1
}
Write-Host '✓ Claude Desktop 已安装'

$ConfigPath = Join-Path $Root 'config.json'
if (-not (Test-Path $ConfigPath)) {
    @{ port = 9222; theme = 'nord' } | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
    Write-Host '✓ 已生成默认配置 config.json(主题: nord)'
} else {
    Write-Host '✓ 已有配置 config.json,保留不动'
}

# 桌面快捷方式,指向 start-dream-skin.ps1
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude Dream Skin.lnk'
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = 'powershell.exe'
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\start-dream-skin.ps1`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.Save()
Write-Host "✓ 桌面快捷方式已创建: $ShortcutPath"

Write-Host ''
Write-Host '可用主题:'
& node (Join-Path $Root 'injector\index.js') --list | ForEach-Object { Write-Host "  - $_" }
Write-Host ''
Write-Host '以后启动方式:双击桌面「Claude Dream Skin」快捷方式'
Write-Host '切换主题:node injector\index.js --set-theme <名字>(免重启生效)'
Write-Host ''
$answer = Read-Host '现在就启动带皮肤的 Claude 吗?(y/N)'
if ($answer -match '^[Yy]') {
    & (Join-Path $PSScriptRoot 'start-dream-skin.ps1')
}
