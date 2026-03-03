@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo.
echo   +=============================================+
echo   ^|            Axon - WebUI                     ^|
echo   +=============================================+
echo.

set "INSTALL_DIR=%USERPROFILE%\.axon"

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

REM --- Auto-update from git ---
if exist "%INSTALL_DIR%\.git" (
    echo.
    echo [INFO] Checking for updates...

    REM Save current commit hash
    for /f "tokens=*" %%h in ('git rev-parse HEAD 2^>nul') do set "OLD_HASH=%%h"

    REM Discard local changes (protect .node portable directory)
    git checkout -- . 2>nul
    git clean -fd --exclude=.node 2>nul

    REM Pull latest code
    git pull origin private_web_ui 2>nul
    if !errorlevel! equ 0 (
        for /f "tokens=*" %%h in ('git rev-parse HEAD 2^>nul') do set "NEW_HASH=%%h"

        if not "!OLD_HASH!"=="!NEW_HASH!" (
            echo [OK] Updated: !OLD_HASH:~0,8! -^> !NEW_HASH:~0,8!
            echo [INFO] Source code changed, rebuilding...

            REM Check if remote is gitee (China mirror)
            for /f "tokens=*" %%u in ('git remote get-url origin 2^>nul') do (
                echo %%u | findstr /i "gitee" >nul 2>&1
                if !errorlevel! equ 0 (
                    npm config set registry https://registry.npmmirror.com
                )
            )

            REM Reinstall dependencies and rebuild
            call npm install --legacy-peer-deps 2>&1 | findstr /n "." | findstr "^[0-9]*:" >nul
            call npm run build 2>&1 | findstr /n "." | findstr "^[0-9]*:" >nul
            echo [OK] Rebuild complete!
        ) else (
            echo [OK] Already up to date
        )
    ) else (
        echo [WARN] Git pull failed ^(network issue?^), starting with current version...
    )
) else (
    echo [WARN] Not a git repository, skipping update
)

echo.
echo [INFO] Starting Axon WebUI...
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
