#!/bin/bash

# MCPDog 发布脚本（团队维护版）
# 发布 @keysqiu/mcpdog 到 npm

set -e

echo "🚀 开始 MCPDog 发布流程..."

# 检查项目根目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误：未找到 package.json，请在项目根目录运行本脚本。"
    exit 1
fi

# 检查未提交改动
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  警告：存在未提交的改动，建议先提交再发布。"
    read -p "仍要继续？(y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 显示当前版本
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📦 当前版本：${CURRENT_VERSION}"

# 确认 npm 登录身份
echo "🔐 当前 npm 身份：$(npm whoami)（应为 keysqiu）"

# 编译（prepublishOnly 也会触发，这里先行验证）
echo "🔨 编译项目..."
npm run build

echo ""
echo "✅ 预检完成。执行发布："
echo "   npm publish --access public"
echo "（scope 包必须带 --access public，否则默认私有会发布失败）"
