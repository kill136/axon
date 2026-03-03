@echo off
rem ============================================
rem Axon - Windows One-Click Uninstaller
rem
rem Usage:
rem   Double-click this file, or run in cmd:
rem     uninstall.bat
rem
rem   Or one-liner from cmd (GitHub):
rem     curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/uninstall.bat -o uninstall.bat && uninstall.bat
rem   Or one-liner from cmd (Gitee, for China):
rem     curl -fsSL https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/uninstall.bat -o uninstall.bat && uninstall.bat
rem ============================================

chcp 65001 >nul 2>&1

echo.
echo   +=============================================+
echo   ^|           Axon Uninstaller                  ^|
echo   +=============================================+
echo.

rem --- Check if uninstall.ps1 exists alongside this bat file ---
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%uninstall.ps1" (
    echo [INFO] Found uninstall.ps1 in %SCRIPT_DIR%
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%uninstall.ps1"
    goto :end
)

rem --- uninstall.ps1 not found locally, download to temp and execute ---
echo [INFO] uninstall.ps1 not found locally, downloading from remote...
set "PS1_TEMP=%TEMP%\claude-code-uninstall.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop'; " ^
    "try { Invoke-WebRequest -Uri 'https://github.com' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop | Out-Null; $url = 'https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/uninstall.ps1' } catch { $url = 'https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/uninstall.ps1' }; " ^
    "Write-Host \"[INFO] Downloading from $url\"; " ^
    "Invoke-WebRequest -Uri $url -OutFile '%PS1_TEMP%' -UseBasicParsing"

if not exist "%PS1_TEMP%" (
    echo [ERROR] Failed to download uninstall script.
    goto :end
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1_TEMP%"

del "%PS1_TEMP%" >nul 2>&1

:end
if "%1"=="" pause
