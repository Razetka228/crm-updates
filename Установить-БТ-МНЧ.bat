@echo off
title CRM: avto-obnovlenie BT + MNC
echo.
echo   ============================================================
echo     Stavlyu avto-obnovlenie rasshireniy BT i MNC s GitHub.
echo     Zapustit ODIN raz na etom kompyutere. Podozhdite...
echo   ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; foreach($d in 'bt','mnc'){ Write-Host ''; Write-Host ('===== '+$d.ToUpper()+' ====='); $u='https://raw.githubusercontent.com/Razetka228/crm-updates/main/extensions/tools/'+$d+'-install.ps1?_='+[DateTimeOffset]::Now.ToUnixTimeSeconds(); try { iex (iwr $u -UseBasicParsing).Content } catch { Write-Host ('OSHIBKA '+$d+': '+$_.Exception.Message) } }"
echo.
echo   ============================================================
echo     Gotovo. Dalshe BT i MNC obnovlyayutsya SAMI.
echo     Odin raz zagruzi 2 papki v brauzer (Load unpacked):
echo         %%LOCALAPPDATA%%\crm-ext\bt
echo         %%LOCALAPPDATA%%\crm-ext\mnc
echo   ============================================================
echo.
pause
