@echo off
setlocal enabledelayedexpansion

REM 切换到脚本所在目录
cd /d "%~dp0"

echo Axon Electron Portable Packaging Script
echo ========================================
echo.

REM 检查必需的目录
echo [0/6] Checking prerequisites...

if not exist "node_modules\electron\dist" (
    echo ERROR: node_modules\electron\dist not found
    echo Please run: npm install
    goto :error
)

if not exist "dist" (
    echo ERROR: dist directory not found
    echo Please run: npm run build
    goto :error
)

if not exist "src\web\client\dist" (
    echo ERROR: src\web\client\dist not found
    echo Please run: cd src\web\client ^&^& npm run build
    goto :error
)

if not exist "electron" (
    echo ERROR: electron directory not found
    goto :error
)

echo All prerequisites OK
echo.

echo [1/6] Creating release directory...
if exist release\axon-portable rmdir /s /q release\axon-portable
mkdir release\axon-portable

echo [2/6] Copying Electron runtime...
xcopy /E /I /Y /Q node_modules\electron\dist release\axon-portable >nul

echo [3/6] Creating app structure...
mkdir release\axon-portable\resources\app

echo [4/6] Copying application files...
xcopy /E /I /Y /Q dist release\axon-portable\resources\app\dist >nul
xcopy /E /I /Y /Q src\web\client\dist release\axon-portable\resources\app\src\web\client\dist >nul
xcopy /E /I /Y /Q electron release\axon-portable\resources\app\electron >nul
copy /Y electron\package.json release\axon-portable\resources\app\ >nul

echo [5/6] Copying node_modules (this may take 2-5 minutes)...
xcopy /E /I /Y /Q node_modules release\axon-portable\resources\app\node_modules >nul

echo [6/6] Renaming electron.exe to Axon.exe...
ren release\axon-portable\electron.exe Axon.exe

echo.
echo ========================================
echo SUCCESS! Portable app created
echo Location: release\axon-portable\
echo Run Axon.exe to start the application
echo ========================================
pause
exit /b 0

:error
echo.
echo ========================================
echo FAILED! Please fix the errors above
echo ========================================
pause
exit /b 1
