@echo off
rem ============================================
rem Axon - Windows One-Click Installer
rem This batch file bypasses PowerShell execution policy restrictions.
rem
rem Usage:
rem   Double-click this file, or run in cmd:
rem     install.bat
rem
rem   Or one-liner from cmd (GitHub):
rem     curl -fsSL https://raw.githubusercontent.com/kill136/axon/private_web_ui/install.bat -o install.bat && install.bat
rem   Or one-liner from cmd (Gitee, for China):
rem     curl -fsSL https://gitee.com/lubanbbs/axon/raw/private_web_ui/install.bat -o install.bat && install.bat
rem ============================================

chcp 65001 >nul 2>&1

echo.
echo   +=============================================+
echo   ^|             Axon Installer                  ^|
echo   ^|        github.com/kill136/axon              ^|
echo   +=============================================+
echo.

rem --- Detect script directory (handles both local and downloaded scenarios) ---
set "SCRIPT_DIR=%~dp0"

rem --- Check if install.ps1 exists alongside this bat file ---
if exist "%SCRIPT_DIR%install.ps1" (
    echo [INFO] Found install.ps1 in %SCRIPT_DIR%
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install.ps1" %*
    goto :end
)

rem --- install.ps1 not found locally, download to temp and execute ---
echo [INFO] install.ps1 not found locally, downloading from remote...
set "PS1_TEMP=%TEMP%\claude-code-install.ps1"

rem Detect network and download install.ps1 to temp file
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop'; " ^
    "try { Invoke-WebRequest -Uri 'https://github.com' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop | Out-Null; $url = 'https://raw.githubusercontent.com/kill136/axon/private_web_ui/install.ps1' } catch { $url = 'https://gitee.com/lubanbbs/axon/raw/private_web_ui/install.ps1' }; " ^
    "Write-Host \"[INFO] Downloading from $url\"; " ^
    "Invoke-WebRequest -Uri $url -OutFile '%PS1_TEMP%' -UseBasicParsing"

if not exist "%PS1_TEMP%" (
    echo [ERROR] Failed to download install script.
    goto :end
)

rem Execute the downloaded script with -File (supports Read-Host, full interactivity)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1_TEMP%" %*

rem Clean up
del "%PS1_TEMP%" >nul 2>&1

:end
if "%1"=="" pause
