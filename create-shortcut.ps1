# 临时脚本：创建桌面快捷方式

# 创建 .local\bin 目录
$BatDir = Join-Path $env:USERPROFILE ".local\bin"
if (!(Test-Path $BatDir)) { New-Item -ItemType Directory -Path $BatDir -Force | Out-Null }

# 获取实际安装路径
$InstallDir = Join-Path $env:USERPROFILE ".claude-code-open"
$WebCliPath = Join-Path $InstallDir "dist\web-cli.js"

# 创建批处理文件
$BatPath = Join-Path $BatDir "claude-web-launch.bat"
$BatContent = @"
@echo off
cd /d "$env:USERPROFILE"
echo Starting Claude Code WebUI...
echo Press Ctrl+C to stop the server
echo.

REM Run the script directly with node
node "$WebCliPath"

pause
"@

Set-Content -Path $BatPath -Value $BatContent -Encoding ASCII

# 创建快捷方式
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "Claude Code WebUI.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $BatPath
$Shortcut.Description = "Launch Claude Code Web Interface"
$Shortcut.WorkingDirectory = $env:USERPROFILE
$Shortcut.Save()

Write-Host ""
Write-Host "✓ Batch file created: $BatPath" -ForegroundColor Green
Write-Host "✓ Shortcut created: $ShortcutPath" -ForegroundColor Green
Write-Host ""
Write-Host "Install Dir: $InstallDir"
Write-Host "WebCLI Path: $WebCliPath"
Write-Host ""

# 检查 web-cli.js 是否存在
if (Test-Path $WebCliPath) {
    Write-Host "✓ web-cli.js found!" -ForegroundColor Green
} else {
    Write-Host "✗ web-cli.js NOT found! Run 'npm run build' in $InstallDir" -ForegroundColor Red
}
