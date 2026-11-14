@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0node_modules\electron\dist\electron.exe" goto missing
set "ELECTRON_RUN_AS_NODE="
if /I "%~1"=="--check" exit /b 0
if /I "%~1"=="--verify" goto verify
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0src\app\main.cjs"
exit /b 0
:verify
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0src\app\main.cjs" --ux-verify
exit /b %errorlevel%
:missing
echo Electron runtime not found. Please see README.md for setup instructions.
pause
exit /b 1
