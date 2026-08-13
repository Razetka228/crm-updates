@echo off
title CRM: sozdat zadachu avto-obnovleniya KP
echo.
echo   Sozdayu zadachu avto-obnovleniya (ispravlennaya versiya)...
echo.
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "extensions\tools\kp-install.ps1"
popd
echo.
echo   Esli vyshe net krasnoy oshibki i napisano "Scheduled task registered" - gotovo.
echo.
pause
