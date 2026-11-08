@echo off
rem Opens the Personal Hub. The server normally starts by itself at login (start-hub-hidden.vbs);
rem if it isn't running, this starts it in the background first.
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:4400/api/nudge -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  wscript "%~dp0start-hub-hidden.vbs"
  timeout /t 2 /nobreak >nul
)
start "" http://localhost:4400/
