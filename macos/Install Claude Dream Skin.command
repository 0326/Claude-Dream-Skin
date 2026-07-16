#!/usr/bin/env bash
# 双击安装:检查依赖 → 生成默认配置 → 赋权 → 立即启动。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "=============================================="
echo "  Claude Dream Skin 安装向导"
echo "=============================================="

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "❌ 未找到 Node.js。请先安装 Node.js >= 22:"
  echo "   https://nodejs.org  或  brew install node"
  echo ""
  read -r -p "按回车退出..."
  exit 1
fi
echo "✓ Node.js $(node --version)"

if [[ ! -d "/Applications/Claude.app" ]]; then
  echo "❌ 未找到 /Applications/Claude.app,请先安装 Claude Desktop。"
  read -r -p "按回车退出..."
  exit 1
fi
echo "✓ Claude Desktop 已安装"

if [[ ! -f "$ROOT/config.json" ]]; then
  printf '{\n  "port": 9222,\n  "theme": "nord"\n}\n' > "$ROOT/config.json"
  echo "✓ 已生成默认配置 config.json(主题: nord)"
else
  echo "✓ 已有配置 config.json,保留不动"
fi

chmod +x "$SCRIPT_DIR/launcher.sh"
echo "✓ launcher.sh 已赋权"

echo ""
echo "可用主题:"
node "$ROOT/injector/index.js" --list | sed 's/^/  - /'
echo ""
echo "以后启动方式:双击本文件,或运行 macos/launcher.sh"
echo "切换主题:node injector/index.js --set-theme <名字>(免重启生效)"
echo ""
read -r -p "按回车立即启动带皮肤的 Claude..."

exec "$SCRIPT_DIR/launcher.sh"
