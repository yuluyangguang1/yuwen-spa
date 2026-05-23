@echo off
chcp 65001 >nul
title 足韵 yuwen-spa — 启动中
rem ──────────────────────────────────────────────
rem 足韵 yuwen-spa — Windows 启动器
rem 双击此文件即可启动
rem ──────────────────────────────────────────────

echo.
echo   足韵 yuwen-spa — 启动中
echo   ──────────────────────
echo.

rem ── 1. 检测 Node.js ─────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [^!] 未找到 Node.js，请安装 Node.js 20+
  echo     下载地址: https://nodejs.org/
  pause
  exit /b 1
)

rem ── 2. 检测端口 ─────────────────────────────
set PORT=8080
:check_port
netstat -ano | findstr ":%PORT% " >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  set /a PORT+=1
  if %PORT% GTR 8090 (
    echo [^!] 端口 8080-8090 全被占用
    pause
    exit /b 1
  )
  goto check_port
)

rem ── 3. 安装依赖（首次）────────────────────────
if not exist "%~dp0..\server\node_modules" (
  echo [✓] 安装后端依赖...
  cd /d "%~dp0..\server"
  call npm install --silent
)

rem ── 4. 检查 Hermes Gateway ─────────────────
echo [✓] 检查 Hermes Gateway...
powershell -Command "& {try {$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8642/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) {exit 0}} catch {}; exit 1}" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [!] Hermes Gateway 未运行
  echo     请先运行 setup-hermes.bat 安装配置
  echo.
  echo     或手动启动: hermes gateway run
  echo.
) else (
  echo [✓] Hermes Gateway 运行中
)

rem ── 5. 启动足韵后端 ─────────────────────────
echo [✓] 启动足韵后端 (端口 %PORT%)...

set PORT=%PORT%
start "yuwen-spa" /B node "%~dp0..\server\src\index.js"

timeout /t 3 /nobreak >nul

echo [✓] 足韵已启动 → http://localhost:%PORT%
echo.
echo  店内设备访问（同 WiFi）:
echo    http://本机IP:%PORT%
echo.
start http://localhost:%PORT%

echo  按 Ctrl+C 或关闭此窗口停止
echo.

:wait
timeout /t 3600 /nobreak >nul 2>&1
goto wait
