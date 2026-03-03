#!/bin/bash
set -e

IMAGE_NAME="wbj66/axon:latest"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed. Please install Docker first."
    echo "  https://docs.docker.com/get-docker/"
    exit 1
fi

# 确保 ~/.axon 目录存在
mkdir -p ~/.axon

# --- 自动更新镜像（每 24 小时检查一次）---
# 设置 AXON_AUTO_PULL=0 可禁用
AXON_AUTO_PULL="${AXON_AUTO_PULL:-1}"
if [ "$AXON_AUTO_PULL" = "1" ]; then
    LAST_PULL_FILE="$HOME/.axon/.last_docker_pull"
    CURRENT_TIME=$(date +%s)
    LAST_PULL=$(cat "$LAST_PULL_FILE" 2>/dev/null || echo 0)
    HOURS_SINCE=$(( (CURRENT_TIME - LAST_PULL) / 3600 ))

    if [ "$HOURS_SINCE" -ge 24 ] || ! docker image inspect "$IMAGE_NAME" &> /dev/null; then
        echo "Checking for Docker image updates..."
        if timeout 30 docker pull "$IMAGE_NAME" 2>/dev/null; then
            echo "$CURRENT_TIME" > "$LAST_PULL_FILE"
            echo "Image updated."
        else
            echo "Warning: Could not pull latest image (network issue or timeout). Using local version."
        fi
    fi
else
    # 如果镜像不存在，仍然需要拉取
    if ! docker image inspect "$IMAGE_NAME" &> /dev/null; then
        echo "Pulling image from Docker Hub..."
        docker pull "$IMAGE_NAME"
    fi
fi

# 启动
exec docker run -it --rm \
    ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
    -v "$HOME/.axon:/root/.axon" \
    -v "$(pwd):/workspace" \
    "$IMAGE_NAME" "$@"
