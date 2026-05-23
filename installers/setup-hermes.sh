#!/usr/bin/env bash
# ────────────────────────────────────────────────────
# 足韵 yuwen-spa — Hermes Agent 安装/配置脚本
# ────────────────────────────────────────────────────
# 用法: bash setup-hermes.sh
#
# 在客户机上跑一次即可：
#   1. 安装 Hermes Agent（如果尚未安装）
#   2. 创建 yuwen-spa 专用 profile
#   3. 配置 API Server（端口 8642）
#   4. 引导填写 API Key
#   5. 启动 Hermes Gateway
#
# 之后每次使用只需运行 start.sh / start.command → 自动启动所有服务
# ────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── 颜色 ───────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
step()  { echo -e "${CYAN}─── $1 ───${NC}"; }

echo ""
echo "  足韵 yuwen-spa — Hermes Agent 安装配置"
echo "  ──────────────────────────────────────"
echo ""

# ── 检测系统 ────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux)   OS_NAME="linux" ;;
  Darwin)  OS_NAME="darwin" ;;
  MINGW*|MSYS*) OS_NAME="windows" ;;
  *)       error "不支持的系统: $OS"; exit 1 ;;
esac
info "系统: $OS ($ARCH)"

# ── 1. 安装 Hermes Agent ───────────────────────────
step "检查 Hermes Agent"

if command -v hermes &>/dev/null; then
  info "Hermes Agent 已安装: $(hermes --version 2>&1 | head -1)"
else
  warn "Hermes Agent 未安装，开始安装..."
  echo ""
  echo "  正在从 Hermes 官方源安装..."
  echo "  更多信息: https://hermes-agent.nousresearch.com"
  echo ""

  if [ "$OS_NAME" = "windows" ]; then
    warn 'Windows 请手动安装: 打开 PowerShell 执行:'
    echo '  irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex'
    echo ""
    echo "安装完成后重新运行此脚本。"
    exit 0
  fi

  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

  # 让 shell 能找到 hermes
  export PATH="$HOME/.local/bin:$PATH"
  if command -v hermes &>/dev/null; then
    info "Hermes Agent 安装成功: $(hermes --version 2>&1 | head -1)"
  else
    error "安装失败，请手动安装后重试"
    exit 1
  fi
fi

# ── 2. 检查 Python 版本 ─────────────────────────────
PYTHON=$(command -v python3 || command -v python)
if [ -z "$PYTHON" ]; then
  error "未找到 Python 3，请先安装 Python 3.10+"
  exit 1
fi

# ── 3. 创建 yuwen-spa 专用 profile ─────────────────
step "配置 Hermes 环境"

PROFILE="yuwen-spa"
if hermes profile list 2>/dev/null | grep -q "$PROFILE"; then
  info "Hermes profile '${PROFILE}' 已存在"
else
  info "创建 Hermes profile '${PROFILE}'..."
  hermes profile create "$PROFILE" 2>/dev/null || true
fi

PROFILE_DIR="$HOME/.hermes/profiles/$PROFILE"
if [ ! -f "$PROFILE_DIR/.env" ]; then
  mkdir -p "$PROFILE_DIR"
fi

# ── 4. 配置 API Server ─────────────────────────────
step "配置 Hermes API Server"

# 读取已有配置
API_KEY=""
if [ -f "$PROFILE_DIR/.env" ]; then
  source "$PROFILE_DIR/.env" 2>/dev/null || true
fi

# 如果还没有 API Key，引导用户填写
if [ -z "$OPENROUTER_API_KEY" ] && [ -z "$DEEPSEEK_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  echo ""
  echo "  请选择一个 AI 服务商并输入 API Key："
  echo ""
  echo "    [1] DeepSeek（推荐，便宜） — api.deepseek.com"
  echo "    [2] OpenRouter（多模型）    — openrouter.ai"
  echo "    [3] 通义千问（阿里云）       — dashscope.aliyuncs.com"
  echo "    [4] 跳过，稍后手动配置"
  echo ""
  read -p "  请选择 [1-4]: " PROVIDER_CHOICE

  case "$PROVIDER_CHOICE" in
    1)
      read -p "  输入 DeepSeek API Key (sk-...): " DS_KEY
      if [ -n "$DS_KEY" ]; then
        echo "DEEPSEEK_API_KEY=$DS_KEY" >> "$PROFILE_DIR/.env"
        info "DeepSeek API Key 已保存"
      fi
      ;;
    2)
      read -p "  输入 OpenRouter API Key: " OR_KEY
      if [ -n "$OR_KEY" ]; then
        echo "OPENROUTER_API_KEY=$OR_KEY" >> "$PROFILE_DIR/.env"
        info "OpenRouter API Key 已保存"
      fi
      ;;
    3)
      read -p "  输入 通义千问 API Key (sk-...): " QWEN_KEY
      if [ -n "$QWEN_KEY" ]; then
        echo "DASHSCOPE_API_KEY=$QWEN_KEY" >> "$PROFILE_DIR/.env"
        info "通义千问 API Key 已保存"
      fi
      ;;
    *)
      warn "跳过 API Key 配置，请在 Hermes Web UI 中手动配置"
      ;;
  esac
else
  info "API Key 已配置，跳过"
fi

# 启用 API Server + 设置 API Key
if ! grep -q "API_SERVER_ENABLED" "$PROFILE_DIR/.env" 2>/dev/null; then
  cat >> "$PROFILE_DIR/.env" << EOF

# Hermes API Server — 足韵通过此接口调用 AI
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
API_SERVER_KEY=yuwen-local
EOF
  info "Hermes API Server 已启用（端口 8642）"
fi

# 写入 yuwen-spa 的 AI 配置
AI_CONFIG="$PROJECT_DIR/server/db/ai-config.json"
mkdir -p "$PROJECT_DIR/server/db"
cat > "$AI_CONFIG" << EOF
{
  "hermesUrl": "http://127.0.0.1:8642",
  "model": "",
  "enabled": true
}
EOF
info "足韵 AI 配置已设置 → Hermes (http://127.0.0.1:8642)"

# ── 5. 设置默认模型 ─────────────────────────────────
step "配置默认模型"

# 检查 Hermes 模型配置
HERMES_CONFIG="$PROFILE_DIR/config.yaml"
if [ ! -f "$HERMES_CONFIG" ]; then
  mkdir -p "$PROFILE_DIR"
  cat > "$HERMES_CONFIG" << EOF
model:
  default: deepseek-chat
  provider: deepseek
terminal:
  backend: local
  timeout: 180
EOF
  info "Hermes 默认模型已设为 DeepSeek"
fi

# ── 6. 启动 Hermes Gateway ─────────────────────────
step "启动 Hermes Gateway"

# 检查是否已在运行
if curl -sf http://127.0.0.1:8642/health >/dev/null 2>&1; then
  info "Hermes Gateway 已在运行"
else
  echo "  正在启动 Hermes Gateway..."
  # 使用 yuwen-spa profile 启动 gateway
  nohup hermes -p "$PROFILE" gateway run > "$PROFILE_DIR/gateway.log" 2>&1 &
  GATEWAY_PID=$!

  # 等待就绪（最多 15 秒）
  for i in $(seq 1 15); do
    sleep 1
    if curl -sf http://127.0.0.1:8642/health >/dev/null 2>&1; then
      info "Hermes Gateway 已启动 (PID $GATEWAY_PID)"
      break
    fi
    if [ "$i" -eq 15 ]; then
      warn "Gateway 启动较慢，请稍后查看日志: $PROFILE_DIR/gateway.log"
    fi
  done
fi

# ── 完成 ─────────────────────────────────────────────
echo ""
echo "  ${GREEN}✓ Hermes Agent 配置完成${NC}"
echo ""
echo "  足韵 AI 设置："
echo "    Hermes 地址:  http://127.0.0.1:8642"
echo "    Auth Token:   yuwen-local"
echo "    Profile:      ${PROFILE}"
echo ""
echo "  后续启动足韵:"
echo "    双击 installers/start.command (macOS)"
echo "    或运行: bash installers/start.sh"
echo ""
echo "  Hermes Web UI（模型管理、用量统计）:"
echo "    http://localhost:8642"
echo ""
