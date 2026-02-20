#!/bin/bash
set -e

echo '========================================'
echo '  Claude Code Open - 一键部署'
echo '========================================'

# 检查 Docker
if ! command -v docker &> /dev/null; then
  echo '错误: 未安装 Docker，请先安装 Docker'
  echo '安装指南: https://docs.docker.com/get-docker/'
  exit 1
fi

# 检查 docker-compose (v2 内置在 docker 中)
if docker compose version &> /dev/null 2>&1; then
  COMPOSE='docker compose'
elif command -v docker-compose &> /dev/null; then
  COMPOSE='docker-compose'
else
  echo '错误: 未安装 docker-compose'
  echo '提示: Docker Desktop 自带 docker compose，或执行 apt-get install docker-compose-plugin'
  exit 1
fi

echo "使用: $COMPOSE"

# 检查 .env 文件
if [ ! -f .env ]; then
  echo '未找到 .env 文件，正在从 .env.example 创建...'
  cp .env.example .env
  echo ''
  echo '!!  请编辑 .env 文件，至少填入 ANTHROPIC_API_KEY'
  echo '    vim .env  或  nano .env'
  echo ''
  exit 1
fi

# 检查 API Key
if ! grep -q 'ANTHROPIC_API_KEY=sk-' .env; then
  echo '警告: .env 中未配置有效的 ANTHROPIC_API_KEY'
  echo '请编辑 .env 文件填入你的 API Key'
  read -p '是否继续部署？(y/N) ' -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 构建并启动
echo '正在构建并启动服务...'
$COMPOSE up -d --build

# 等待健康检查
echo '等待服务启动...'
for i in $(seq 1 30); do
  if curl -sf http://localhost:3456/api/health > /dev/null 2>&1; then
    echo ''
    echo '========================================'
    echo '  部署成功!'
    echo '  访问地址: http://localhost:3456'
    echo '========================================'
    exit 0
  fi
  printf '.'
  sleep 2
done

echo ''
echo '服务可能仍在启动中，请稍后访问 http://localhost:3456'
echo "查看日志: $COMPOSE logs -f claude"
