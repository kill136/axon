@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo.
echo   +=============================================+
echo   ^|       Claude Code Open - WebUI              ^|
echo   +=============================================+
echo.

set "INSTALL_DIR=%USERPROFILE%\.claude-code-open"

if not exist "%INSTALL_DIR%" (
    echo [ERROR] Installation directory not found: %INSTALL_DIR%
    echo         Please run the installer first.
    goto :error_exit
)
cd /d "%INSTALL_DIR%"

REM --- Use portable Node.js if available ---
if exist "%INSTALL_DIR%\.node\node.exe" (
    set "PATH=%INSTALL_DIR%\.node;%PATH%"
    echo [OK] Using portable Node.js from .node\
)

REM --- Verify node is available, auto-install if not ---
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo [WARN] Node.js not found, downloading portable v22 LTS...
    call :install_node_portable
    if !errorlevel! neq 0 goto :error_exit
)

REM --- Show node version ---
for /f "tokens=*" %%v in ('node -v 2^>nul') do echo [OK] Node.js %%v

echo.
echo [INFO] Starting Claude Code WebUI...
echo.

node_modules\.bin\tsx.cmd src\web-cli.ts --evolve -H 0.0.0.0

if !errorlevel! neq 0 (
    echo.
    echo [ERROR] Application exited with error code !errorlevel!
    goto :error_exit
)
goto :end

REM ============================================
REM Auto-install Node.js portable (zip, no MSI)
REM ============================================
:install_node_portable
set "NODE_VER=22.14.0"
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (set "NODE_ARCH=x64") else (set "NODE_ARCH=x86")
set "NODE_ZIP=node-v%NODE_VER%-win-%NODE_ARCH%.zip"
set "NODE_DIR=%INSTALL_DIR%\.node"
set "DL_PATH=%TEMP%\%NODE_ZIP%"

REM Try nodejs.org first, then China mirror
set "URL1=https://nodejs.org/dist/v%NODE_VER%/%NODE_ZIP%"
set "URL2=https://npmmirror.com/mirrors/node/v%NODE_VER%/%NODE_ZIP%"

echo [INFO] Downloading %NODE_ZIP% ...

REM Use PowerShell to download (available on all modern Windows)
powershell -NoProfile -Command ^
    "try { Invoke-WebRequest -Uri '%URL1%' -OutFile '%DL_PATH%' -UseBasicParsing -TimeoutSec 60; exit 0 } catch { try { Invoke-WebRequest -Uri '%URL2%' -OutFile '%DL_PATH%' -UseBasicParsing -TimeoutSec 60; exit 0 } catch { exit 1 } }"

if !errorlevel! neq 0 (
    echo [ERROR] Failed to download Node.js. Check your internet connection.
    exit /b 1
)

echo [INFO] Extracting to %NODE_DIR% ...
if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%"

REM Extract zip using PowerShell
powershell -NoProfile -Command ^
    "Expand-Archive -Path '%DL_PATH%' -DestinationPath '%TEMP%\node-extract' -Force; $d = Get-ChildItem '%TEMP%\node-extract' -Directory | Select-Object -First 1; Move-Item $d.FullName '%NODE_DIR%' -Force; Remove-Item '%TEMP%\node-extract' -Recurse -Force -ErrorAction SilentlyContinue"

del "%DL_PATH%" >nul 2>&1

if not exist "%NODE_DIR%\node.exe" (
    echo [ERROR] Node.js extraction failed.
    exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"
echo [OK] Node.js portable installed to %NODE_DIR%
exit /b 0

:error_exit
echo.
echo Press any key to exit...
pause >nul
exit /b 1

:end
pause
