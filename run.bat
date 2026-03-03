@echo off
setlocal enabledelayedexpansion

set IMAGE_NAME=wbj66/axon:latest

:: 检查 Docker
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Docker is not installed. Please install Docker first.
    echo   https://docs.docker.com/get-docker/
    exit /b 1
)

:: 确保 .axon 目录存在
if not exist "%USERPROFILE%\.axon" mkdir "%USERPROFILE%\.axon"

:: --- 自动更新镜像（每 24 小时检查一次）---
:: 设置 AXON_AUTO_PULL=0 可禁用
if "%AXON_AUTO_PULL%"=="" set "AXON_AUTO_PULL=1"

if "%AXON_AUTO_PULL%"=="1" (
    set "LAST_PULL_FILE=%USERPROFILE%\.axon\.last_docker_pull"
    set "NEED_PULL=0"

    :: 检查镜像是否存在
    docker image inspect %IMAGE_NAME% >nul 2>nul
    if !errorlevel! neq 0 set "NEED_PULL=1"

    :: 检查上次 pull 时间（通过 PowerShell 计算小时差）
    if "!NEED_PULL!"=="0" (
        if exist "!LAST_PULL_FILE!" (
            for /f "tokens=*" %%t in ('powershell -NoProfile -Command ^
                "$last = Get-Content '!LAST_PULL_FILE!' -ErrorAction SilentlyContinue; if ($last) { [int]((Get-Date) - [DateTimeOffset]::FromUnixTimeSeconds([long]$last).DateTime).TotalHours } else { 999 }"') do (
                if %%t GEQ 24 set "NEED_PULL=1"
            )
        ) else (
            set "NEED_PULL=1"
        )
    )

    if "!NEED_PULL!"=="1" (
        echo Checking for Docker image updates...
        docker pull %IMAGE_NAME% 2>nul
        if !errorlevel! equ 0 (
            :: Save current timestamp
            powershell -NoProfile -Command "[int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds() | Set-Content '%USERPROFILE%\.axon\.last_docker_pull'"
            echo Image updated.
        ) else (
            echo Warning: Could not pull latest image. Using local version.
        )
    )
) else (
    :: 如果自动 pull 已禁用，仍在镜像不存在时拉取
    docker image inspect %IMAGE_NAME% >nul 2>nul
    if !errorlevel! neq 0 (
        echo Pulling image from Docker Hub...
        docker pull %IMAGE_NAME%
    )
)

:: 启动
docker run -it --rm ^
    -e ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY% ^
    -v "%USERPROFILE%\.axon:/root/.axon" ^
    -v "%cd%:/workspace" ^
    %IMAGE_NAME% %*
