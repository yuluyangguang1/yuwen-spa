#!/usr/bin/env bash
# ────────────────────────────────────────────────────
# 足韵 yuwen-spa — macOS 启动器
# 双击此文件即可启动
# ────────────────────────────────────────────────────

# 让脚本在终端中运行
cd "$(dirname "$0")"
cd ..

bash installers/start.sh

# 等待按键后关闭
echo ""
echo "按 Enter 关闭..."
read
