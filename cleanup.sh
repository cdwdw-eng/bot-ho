#!/bin/bash
# bot-ho 一键清理 + 重启
# 杀掉老的 sing-box 进程、清理残留、启动新版 xray

set -e

# 检测并杀掉占用端口的进程
echo "=== 检查端口占用 ==="
PORT=${SERVER_PORT:-${PORT:-3000}}
for port in $PORT 3000 8080 8443; do
    PID=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1)
    if [ -n "$PID" ]; then
        echo "端口 $port 被 PID $PID 占用,杀掉..."
        kill -9 $PID 2>/dev/null || true
    fi
done

# 杀掉老的 node 进程
echo "=== 清理 node 进程 ==="
pkill -9 -f "node index.js" 2>/dev/null || true
pkill -9 -f "node /tmp" 2>/dev/null || true
pkill -9 web 2>/dev/null || true

# 清理残留的 sing-box
echo "=== 清理 sing-box 残留 ==="
pkill -9 -f sing-box 2>/dev/null || true
# 保留 web 目录(新版 xray 会覆盖),但删除老的 reality_key.pem
rm -f keys/reality_key.pem 2>/dev/null || true
rm -f keys/reality_key.txt 2>/dev/null || true

# 重置 config.json (新版启动时会重新写入)
echo "=== 重置 config.json ==="
rm -f config.json 2>/dev/null || true

# 检查 git 状态并强制同步
echo "=== 强制同步 GitHub ==="
git fetch origin 2>&1 | tail -2
git reset --hard origin/main 2>&1 | tail -2

# 验证新版文件
echo "=== 验证新版 ==="
head -5 index.js

# 启动
echo "=== 启动新版 ==="
nohup node index.js > /tmp/bot-ho.log 2>&1 &
echo "Started PID: $!"
echo ""
echo "日志: tail -f /tmp/bot-ho.log"
echo "找节点: grep -A 5 'Reality 加密节点链接' /tmp/bot-ho.log"