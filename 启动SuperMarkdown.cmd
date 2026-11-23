@echo off
setlocal
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 goto missing_pnpm
where cargo >nul 2>nul
if errorlevel 1 goto missing_rust
if not exist "%~dp0node_modules\vditor\dist\index.min.js" goto missing_deps

if /I "%~1"=="--check" exit /b 0

call pnpm dev:tauri
exit /b %errorlevel%

:missing_pnpm
echo pnpm was not found. Install Node.js 24 and pnpm 11.25.0 first.
goto failed
:missing_rust
echo Rust/Cargo was not found. Install the Rust stable toolchain first.
goto failed
:missing_deps
echo Project dependencies are missing. Run pnpm install --frozen-lockfile --ignore-scripts first.
goto failed
:failed
echo See README.md and docs/tauri.md for Tauri development prerequisites.
pause
exit /b 1
