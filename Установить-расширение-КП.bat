@echo off
title CRM: auto-update rasshireniya KP
echo.
echo   ============================================================
echo     Nastraivayu avto-obnovlenie rasshireniya KP s GitHub.
echo     Eto nuzhno zapustit ODIN raz na etom kompyutere.
echo     Podozhdite - idet zagruzka...
echo   ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $u='https://raw.githubusercontent.com/Razetka228/crm-updates/main/extensions/tools/kp-install.ps1?_='+[DateTimeOffset]::Now.ToUnixTimeSeconds(); iex (iwr $u -UseBasicParsing).Content"
echo.
echo   ============================================================
echo     Gotovo. Dalshe rasshirenie obnovlyaetsya SAMO.
echo     Odin raz zagruzi papku (put napechatan vyshe) v brauzer:
echo        Rasshireniya - Rezhim razrabotchika - Zagruzit raspakovannoe
echo   ============================================================
echo.
pause
