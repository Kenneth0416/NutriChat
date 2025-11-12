#!/usr/bin/env bash
set -e

# 啟動後端服務
cd /app/backend
node src/server.js &
backend_pid=$!

term_handler() {
  kill -TERM "$backend_pid" >/dev/null 2>&1 || true
  wait "$backend_pid" >/dev/null 2>&1 || true
  exit 0
}

trap term_handler SIGTERM SIGINT

# 以前景模式啟動 Nginx
nginx -g "daemon off;"

# 當 Nginx 結束時，確保後端也被停止
term_handler

