#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo '请先按 DEPLOY.md 安装 Docker Engine 和 Compose 插件。' >&2
  exit 1
fi
mode="${1:-http}"
case "$mode" in
  http) config=compose.yaml ;;
  https) config=compose.https.yaml ;;
  *) echo '用法：bash deploy/start.sh [http|https]' >&2; exit 1 ;;
esac
docker compose -f "$config" config --quiet
docker compose -f "$config" up -d --build --wait --wait-timeout 120
docker compose -f "$config" ps
echo '服务已启动。访问地址和防火墙配置请见 DEPLOY.md。'
