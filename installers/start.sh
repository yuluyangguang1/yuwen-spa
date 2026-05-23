#!/usr/bin/env bash
# ────────────────────────────────────────────────────
# 足韵 yuwen-spa 启动器
# Linux / macOS 通用
# ────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── 颜色 ───────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

echo ""
echo "  足韵 yuwen-spa — 启动中"
echo "  ──────────────────────"
echo ""

# ── 1. 检测 Node.js ────────────────────────────────
if ! command -v node &>/dev/null; then
  error "未找到 Node.js，请安装 Node.js 20+"
  exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  error "Node.js 版本过低 ($(node -v))，需要 20+"
  exit 1
fi
info "Node.js $(node -v)"

# ── 2. 安装依赖（首次）──────────────────────────────
if [ ! -d "$PROJECT_DIR/server/node_modules" ]; then
  info "安装后端依赖..."
  cd "$PROJECT_DIR/server" && npm install --silent
fi

# ── 3. 检查 Hermes Gateway ─────────────────────────
HERMES_URL="http://127.0.0.1:8642"
if ! curl -sf "$HERMES_URL/health" >/dev/null 2>&1; then
  warn "Hermes Gateway 未运行，正在启动..."

  if command -v hermes &>/dev/null; then
    # 检查是否有 yuwen-spa profile
    if hermes profile list 2>/dev/null | grep -q "yuwen-spa"; then
      PROFILE_FLAG="-p yuwen-spa"
    else
      PROFILE_FLAG=""
    fi

    nohup hermes $PROFILE_FLAG gateway run > "$PROJECT_DIR/hermes-gateway.log" 2>&1 &
    GATEWAY_PID=$!

    # 等待最多 15 秒
    for i in $(seq 1 15); do
      sleep 1
      if curl -sf "$HERMES_URL/health" >/dev/null 2>&1; then
        info "Hermes Gateway 已启动 (PID $GATEWAY_PID)"
        break
      fi
    done

    if ! curl -sf "$HERMES_URL/health" >/dev/null 2>&1; then
      warn "Hermes 启动超时，请稍后手动启动: hermes gateway run"
    fi
  else
    warn "未找到 Hermes，AI 功能不可用。运行 setup-hermes.sh 安装"
  fi
else
  info "Hermes Gateway 运行中"
fi

# ── 4. 获取可用端口 ────────────────────────────────
PORT=8080
while lsof -i :$PORT -P 2>/dev/null | grep -q LISTEN; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt 8090 ]; then
    error "端口 8080-8090 全被占用"
    exit 1
  fi
done

# ── 5. 启动足韵后端 ────────────────────────────────
cd "$PROJECT_DIR/server"
PORT=$PORT node src/index.js &
SERVER_PID=$!

# 等待就绪
sleep 2
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  error "足韵启动失败，请查看日志"
  exit 1
fi
info "足韵已启动 → http://localhost:$PORT"

# ── 6. 打开浏览器 ──────────────────────────────────
case "$(uname -s)" in
  Darwin) open "http://localhost:$PORT" 2>/dev/null || true ;;
  Linux)  xdg-open "http://localhost:$PORT" 2>/dev/null || true ;;
esac

# 显示局域网地址
echo ""
echo "  店内设备访问（同 WiFi）:"
if command -v ip &>/dev/null; then
  ip -4 addr show | grep -oP 'inet \K[\d.]+' | grep -v '127.0.0.1' | while read ip; do
    echo "    http://$ip:$PORT"
  done
elif command -v ifconfig &>/dev/null; then
  ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | while read ip; do
    echo "    http://$ip:$PORT"
  done
fi
echo ""
echo "  按 Ctrl+C 停止"

# ── 7. 等待退出 ────────────────────────────────────
trap "echo ''; info '正在关闭...'; kill $SERVER_PID 2>/dev/null; exit 0" INT TERM
wait $SERVER_PID
