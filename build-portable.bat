@echo off
REM Axon Electron Manual Packaging Script

echo [1/5] Creating release directory...
if exist release\axon-portable rmdir /s /q release\axon-portable
mkdir release\axon-portable

echo [2/5] Copying Electron runtime...
xcopy /E /I /Y node_modules\electron\dist release\axon-portable

echo [3/5] Copying application files...
xcopy /E /I /Y dist release\axon-portable\resources\app\dist
xcopy /E /I /Y src\web\client\dist release\axon-portable\resources\app\src\web\client\dist
xcopy /E /I /Y electron release\axon-portable\resources\app\electron
copy package.json release\axon-portable\resources\app\

echo [4/5] Copying node_modules (this may take a while)...
xcopy /E /I /Y node_modules release\axon-portable\resources\app\node_modules

echo [5/5] Renaming electron.exe to Axon.exe...
ren release\axon-portable\electron.exe Axon.exe

echo.
echo Done! Portable app created at: release\axon-portable\
echo Run Axon.exe to start the application.
pause
