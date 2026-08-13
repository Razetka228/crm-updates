@echo off
title CRM: vklyuchit avto-obnovlenie KP
echo.
echo   ============================================================
echo     Vklyuchayu avto-obnovlenie rasshireniya KP s GitHub.
echo     Zapustit ODIN raz na etom kompyutere. Podozhdite...
echo   ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $u='https://raw.githubusercontent.com/Razetka228/crm-updates/main/extensions/tools/kp-install.ps1?_='+[DateTimeOffset]::Now.ToUnixTimeSeconds(); iex (iwr $u -UseBasicParsing).Content"
echo.
echo   ============================================================
echo     Gotovo. Dalshe KP obnovlyaetsya SAMO.
echo     Odin raz zagruzi papku v brauzer (Load unpacked):
echo         %%LOCALAPPDATA%%\crm-ext\kp
echo   ============================================================
echo.
pause
