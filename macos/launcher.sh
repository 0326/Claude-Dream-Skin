#!/usr/bin/env bash
# Claude Dream Skin — macOS Launcher
# 完整生命周期:关旧进程 → 带 --remote-debugging-port 重新拉起 → 等 CDP 就绪 → 启动 Injector。
# 始终通过本脚本启动 Claude,即可保证主题一直生效(PRD §3.4 的"看门狗"入口)。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PORT="${CLAUDE_DREAM_SKIN_PORT:-9222}"
CLAUDE_BIN="/Applications/Claude.app/Contents/MacOS/Claude"

if [[ ! -x "$CLAUDE_BIN" ]]; then
  echo "❌ 找不到 /Applications/Claude.app,请先安装 Claude Desktop。" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 需要 Node.js >= 22(https://nodejs.org),未在 PATH 中找到 node。" >&2
  exit 1
fi

# 1. 优雅关闭已运行的 Claude(先 AppleScript quit,超时再 pkill)
if pgrep -xq "Claude"; then
  echo "▸ 正在关闭已运行的 Claude..."
  osascript -e 'tell application "Claude" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -xq "Claude" || break
    sleep 0.5
  done
  if pgrep -xq "Claude"; then
    pkill -x "Claude" || true
    sleep 1
  fi
fi

# 2. 带调试端口重新拉起(CDP 只监听 127.0.0.1,见 README 安全边界)
echo "▸ 以 --remote-debugging-port=$PORT 启动 Claude..."
open -a "Claude" --args --remote-debugging-port="$PORT"

# 3. 轮询 CDP 端口就绪
echo "▸ 等待 CDP 端口就绪..."
ready=0
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" != "1" ]]; then
  echo "❌ 30 秒内 CDP 端口未就绪,Claude 可能没有接受 --remote-debugging-port 参数。" >&2
  exit 1
fi

# 4. 前台长驻 Injector(Ctrl+C 退出;退出后正常重开 Claude 即回到官方原状)
echo "▸ 启动 Injector(Ctrl+C 停止换肤;之后正常打开 Claude 即完全还原)"
exec node "$ROOT/injector/index.js" --port "$PORT"
