@echo off
rem Stops the background Personal Hub server (it starts again at next login, or with Open Personal Hub.cmd).
powershell -NoProfile -Command "$p = (Get-NetTCPConnection -LocalPort 4400 -State Listen -ErrorAction SilentlyContinue).OwningProcess; if ($p) { Stop-Process -Id $p; 'Personal Hub stopped.' } else { 'Personal Hub was not running.' }"
timeout /t 3 >nul
