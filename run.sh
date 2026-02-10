#!/bin/bash
set -e

IMAGE_NAME="wbj66/claude-code-open:latest"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed. Please install Docker first."
    echo "  https://docs.docker.com/get-docker/"
    exit 1
fi

# 如果镜像不存在，自动从 Docker Hub 拉取
if ! docker image inspect "$IMAGE_NAME" &> /dev/null; then
    echo "Pulling image from Docker Hub..."
    docker pull "$IMAGE_NAME"
fi

# 确保 ~/.claude 目录存在
mkdir -p ~/.claude

# 启动
exec docker run -it --rm \
    ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
    -v "$HOME/.claude:/root/.claude" \
    -v "$(pwd):/workspace" \
    "$IMAGE_NAME" "$@"
