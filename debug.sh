#!/bin/bash
# debug-bot-ho.sh - 一键诊断 bot-ho 启动问题
# 在 VPS 上跑这个,把完整输出发给我

set +e

echo "============================================="
echo "1. 检查 VPS 环境"
echo "============================================="
echo "PATH: $PATH"
which node && node -v
which curl
which openssl
ls -la keys/ 2>&1 || echo "(keys/ 不存在)"
ls -la config.json 2>&1 || echo "(config.json 不存在)"
ls -la web 2>&1 || echo "(web 不存在)"

echo ""
echo "============================================="
echo "2. 手动测试 sing-box x25519 输出"
echo "============================================="
if [ -f "./web" ]; then
    ./web x25519 2>&1 | head -20
    echo ""
    echo "=== 第一次测试输出长度 ==="
    OUT=$(./web x25519 2>&1)
    echo "$OUT" | wc -l
    echo "$OUT" | head -5 | cat -A
else
    echo "web binary 不存在 - 第一次跑会下载"
fi

echo ""
echo "============================================="
echo "3. 手动测试 sing-box config 验证"
echo "============================================="
if [ -f "./config.json" ]; then
    echo "=== config.json 内容 ==="
    cat config.json | head -50
    echo ""
    echo "=== 尝试启动 sing-box ==="
    timeout 5 ./web run -c config.json 2>&1 | head -30
fi

echo ""
echo "============================================="
echo "4. 检查 GitHub 上 index.js 状态"
echo "============================================="
curl -s https://raw.githubusercontent.com/cdwdw-eng/bot-ho/main/index.js | head -10
echo ""
echo "=== index.js commit ==="
curl -s https://api.github.com/repos/cdwdw-eng/bot-ho/commits/main | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sha'][:12], '-', d['commit']['message'])"

echo ""
echo "============================================="
echo "5. 检查 keys 目录"
echo "============================================="
cat keys/reality_key.txt 2>&1 | head -3
echo "Length:"
cat keys/reality_key.txt 2>&1 | tr -d '\n' | wc -c
echo "Decoded bytes (base64):"
cat keys/reality_key.txt 2>&1 | tr -d '\n' | base64 -d | wc -c

echo ""
echo "============================================="
echo "6. 测试 Reality 节点 URL 解析"
echo "============================================="
grep "Reality 加密节点" /tmp/bot-ho.log 2>&1
grep -A 3 "Reality 加密节点" /tmp/bot-ho.log 2>&1

echo ""
echo "============================================="
echo "Done. 把整个输出复制发给我。"
