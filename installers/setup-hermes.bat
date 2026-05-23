@echo off
chcp 65001 >nul
title 足韵 yuwen-spa — Hermes Agent 安装配置
rem ──────────────────────────────────────────────
rem 足韵 yuwen-spa — Hermes Agent 安装/配置脚本
rem Windows 专用
rem ──────────────────────────────────────────────

echo.
echo   足韵 yuwen-spa — Hermes Agent 安装配置
echo   ──────────────────────────────────────
echo.

rem ── 1. 检查 Python ──────────────────────────
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [!] 未找到 Python，请先安装 Python 3.10+
  echo     下载地址: https://www.python.org/downloads/
  pause
  exit /b 1
)

rem ── 2. 检查 Hermes ─────────────────────────
where hermes >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo [✓] Hermes Agent 已安装
  for /f "tokens=*" %%i in ('hermes --version 2^>^&1') do echo     %%i
  echo.
  goto :configure
)

echo [!] Hermes Agent 未安装
echo.
echo  正在安装 Hermes Agent...
echo  更多信息: https://hermes-agent.nousresearch.com
echo.
echo  打开 PowerShell 以管理员身份运行：
echo.
echo    irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 ^| iex
echo.
echo  安装完成后重新运行此脚本。
pause
exit /b 1

:configure
rem ── 3. 创建 yuwen-spa profile ─────────────
echo ─── 配置 Hermes 环境 ───
echo.

for /f "tokens=*" %%i in ('hermes profile list 2^>^&1 ^| findstr "yuwen-spa"') do set PROFILE_EXISTS=1
if defined PROFILE_EXISTS (
  echo [✓] Hermes profile 'yuwen-spa' 已存在
) else (
  echo [✓] 创建 Hermes profile 'yuwen-spa'...
  hermes profile create yuwen-spa >nul 2>&1
)

rem ── 4. 配置 API Server ─────────────────────
echo.
echo ─── 配置 Hermes API Server ───
echo.

set PROFILE_DIR=%USERPROFILE%\.hermes\profiles\yuwen-spa
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%"

rem 检查是否已配置 API Server
findstr "API_SERVER_ENABLED" "%PROFILE_DIR%\.env" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo   [^?] 是否已准备好 AI API Key？
  echo.
  echo   请选择一个服务商：
  echo     [1] DeepSeek（推荐，便宜）
  echo     [2] OpenRouter（多模型）
  echo     [3] 跳过，稍后手动配置
  echo.
  set /p PROVIDER_CHOICE="  请选择 [1-3]: "

  if "%PROVIDER_CHOICE%"=="1" (
    set /p DS_KEY="  输入 DeepSeek API Key (sk-...): "
    if not "%DS_KEY%"=="" (
      echo DEEPSEEK_API_KEY=%DS_KEY%>> "%PROFILE_DIR%\.env"
      echo [✓] DeepSeek API Key 已保存
    )
  ) else if "%PROVIDER_CHOICE%"=="2" (
    set /p OR_KEY="  输入 OpenRouter API Key: "
    if not "%OR_KEY%"=="" (
      echo OPENROUTER_API_KEY=%OR_KEY%>> "%PROFILE_DIR%\.env"
      echo [✓] OpenRouter API Key 已保存
    )
  ) else (
    echo [!] 跳过 API Key 配置
  )

  echo.>> "%PROFILE_DIR%\.env"
  echo rem Hermes API Server — 足韵通过此接口调用 AI>> "%PROFILE_DIR%\.env"
  echo API_SERVER_ENABLED=true>> "%PROFILE_DIR%\.env"
  echo API_SERVER_PORT=8642>> "%PROFILE_DIR%\.env"
  echo API_SERVER_KEY=yuwen-local>> "%PROFILE_DIR%\.env"

  echo [✓] Hermes API Server 已启用（端口 8642）
) else (
  echo [✓] API Server 已配置
)

rem ── 5. 写足韵 AI 配置 ─────────────────────
set AI_CONFIG=%~dp0..\server\db\ai-config.json
if not exist "%~dp0..\server\db" mkdir "%~dp0..\server\db"

echo {> "%AI_CONFIG%"
echo   "hermesUrl": "http://127.0.0.1:8642",>> "%AI_CONFIG%"
echo   "model": "",>> "%AI_CONFIG%"
echo   "enabled": true>> "%AI_CONFIG%"
echo }>> "%AI_CONFIG%"

echo [✓] 足韵 AI 配置已设置 → Hermes (http://127.0.0.1:8642)

rem ── 6. 启动 Gateway ────────────────────────
echo.
echo ─── 启动 Hermes Gateway ───
echo.

powershell -Command "& {try {$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8642/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) {exit 0}} catch {}; exit 1}" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo [✓] Hermes Gateway 已在运行
) else (
  echo [✓] 正在启动 Hermes Gateway...
  start "hermes-gateway" /B hermes -p yuwen-spa gateway run

  timeout /t 5 /nobreak >nul

  powershell -Command "& {try {$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8642/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) {exit 0}} catch {}; exit 1}" >nul 2>&1
  if %ERRORLEVEL% EQU 0 (
    echo [✓] Hermes Gateway 已启动
  ) else (
    echo [!] Gateway 启动较慢，稍后请手动检查
  )
)

rem ── 完成 ──────────────────────────────────────
echo.
echo  ✓ Hermes Agent 配置完成
echo.
echo  足韵 AI 设置:
echo    Hermes 地址:  http://127.0.0.1:8642
echo    Auth Token:   yuwen-local
echo    Profile:      yuwen-spa
echo.
echo  后续启动足韵:
echo    双击 installers/start.bat
echo.
pause
