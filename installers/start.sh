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

# ── 0. JWT_SECRET 占位：从已有 .env 读取（生成需 node，放到 Node 检测后）──
if [ -z "$JWT_SECRET" ] && [ -f "$PROJECT_DIR/.env" ]; then
  JWT_SECRET=$(grep -E '^JWT_SECRET=' "$PROJECT_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export JWT_SECRET
fi

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

# ── 1b. JWT_SECRET 缺失则生成并持久化 ──────────────
if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  export JWT_SECRET
  echo "JWT_SECRET=$JWT_SECRET" >> "$PROJECT_DIR/.env"
  info "已生成 JWT_SECRET 并写入 .env"
fi

# ── 2. 安装依赖（首次）──────────────────────────────
if [ ! -d "$PROJECT_DIR/server/node_modules" ]; then
  info "安装后端依赖..."
  cd "$PROJECT_DIR/server" && npm install --silent
fi

# ── 3. 获取可用端口 ────────────────────────────────
PORT=8080
while lsof -i :$PORT -P 2>/dev/null | grep -q LISTEN; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt 8090 ]; then
    error "端口 8080-8090 全被占用"
    exit 1
  fi
done

# ── 4. 启动足韵后端 ────────────────────────────────
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

# ── 5. 打开浏览器 ──────────────────────────────────
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

# ── 6. 等待退出 ────────────────────────────────────
trap "echo ''; info '正在关闭...'; kill $SERVER_PID 2>/dev/null; exit 0" INT TERM
wait $SERVER_PID
