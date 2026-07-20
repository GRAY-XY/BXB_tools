#!/bin/bash

# 项目清理脚本
# 用于清理构建产物、缓存和临时文件

echo "🧹 开始清理项目..."

# 清理构建产物
echo "清理 build/ 目录..."
rm -rf build/

echo "清理 dist/ 目录..."
rm -rf dist/

# 清理 .DS_Store 文件
echo "清理 .DS_Store 文件..."
find . -name ".DS_Store" -type f -delete

# 清理会话数据 (可选)
# echo "清理 .banxuebang/ 目录..."
# rm -rf .banxuebang/

# 清理 Playwright 缓存 (可选)
# echo "清理 .playwright-cli/ 目录..."
# rm -rf .playwright-cli/

# 清理临时文件
echo "清理 artifacts/ 目录..."
rm -rf artifacts/

# 清理 Flutter 构建缓存
if [ -d "UI/banxuebang_flutter" ]; then
    echo "清理 Flutter 构建缓存..."
    cd UI/banxuebang_flutter
    flutter clean 2>/dev/null || echo "Flutter CLI 未安装，跳过 flutter clean"
    cd ../..
fi

# 清理 web-app node_modules (可选，取消注释以启用)
# echo "清理 web-app/node_modules/ 目录..."
# rm -rf web-app/node_modules/

echo "✅ 清理完成！"
echo ""
echo "提示："
echo "- 如需重新构建，请运行相应的构建脚本"
echo "- 如需清理会话数据，请取消注释脚本中的对应行"
echo "- node_modules/ 未被清理，如需清理请手动删除或修改此脚本"
