@echo off

set IMAGE_NAME=wbj66/claude-code-open:latest

:: 检查 Docker
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Docker is not installed. Please install Docker first.
    echo   https://docs.docker.com/get-docker/
    exit /b 1
)

:: 如果镜像不存在，自动从 Docker Hub 拉取
docker image inspect %IMAGE_NAME% >nul 2>nul
if %errorlevel% neq 0 (
    echo Pulling image from Docker Hub...
    docker pull %IMAGE_NAME%
)

:: 确保 .claude 目录存在
if not exist "%USERPROFILE%\.claude" mkdir "%USERPROFILE%\.claude"

:: 启动
docker run -it --rm ^
    -e ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY% ^
    -v "%USERPROFILE%\.claude:/root/.claude" ^
    -v "%cd%:/workspace" ^
    %IMAGE_NAME% %*
