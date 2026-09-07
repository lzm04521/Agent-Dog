#!/bin/bash

# MCPDog npx 安装验证脚本（团队维护版）
# 验证 @lzm04521/mcpdog 发布后可通过 npx 正常安装和运行

set -e

echo "🧪 开始验证 @lzm04521/mcpdog 的 npx 安装..."

# 先停掉已存在的 daemon
echo "🛑 停止已存在的 daemon..."
npx @lzm04521/mcpdog stop 2>/dev/null || true
sleep 2

# 测试版本命令
echo "📋 测试版本命令..."
npx @lzm04521/mcpdog --version

if [ $? -eq 0 ]; then
    echo "✅ 版本命令正常"
else
    echo "❌ 版本命令失败"
    exit 1
fi

# 测试帮助命令
echo "📋 测试帮助命令..."
npx @lzm04521/mcpdog --help

if [ $? -eq 0 ]; then
    echo "✅ 帮助命令正常"
else
    echo "❌ 帮助命令失败"
    exit 1
fi

# 测试 daemon 启动（后台）
echo "📋 测试 daemon 启动..."
npx @lzm04521/mcpdog daemon start --web-port 38881 &
DAEMON_PID=$!
sleep 5

if kill -0 $DAEMON_PID 2>/dev/null; then
    echo "✅ daemon 启动成功"
else
    echo "❌ daemon 启动失败"
    exit 1
fi

# 测试 Web 界面
echo "📋 测试 Web 界面..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:38881)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Web 界面可访问（HTTP $HTTP_CODE）"
else
    echo "❌ Web 界面不可访问（HTTP $HTTP_CODE）"
    kill $DAEMON_PID 2>/dev/null || true
    exit 1
fi

# 停止 daemon
echo "📋 停止 daemon..."
kill $DAEMON_PID 2>/dev/null || true
sleep 2
npx @lzm04521/mcpdog stop 2>/dev/null || true

echo "🎉 npx 安装验证全部通过！"
