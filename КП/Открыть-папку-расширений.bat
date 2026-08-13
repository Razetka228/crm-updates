@echo off
rem Universal shortcut to the CRM extensions BASE folder.
rem Inside it: subfolders kp, bt, mnc (each is a separate unpacked extension).
rem Works on ANY machine / ANY username because it resolves %LOCALAPPDATA% at runtime.
set "BASEDIR=%LOCALAPPDATA%\crm-ext"
if not exist "%BASEDIR%" (
  echo.
  echo   Papka rasshireniy poka ne sozdana.
  echo   Snachala zapustite ustanovku, potom otkroyte etot fayl.
  echo.
  pause
  exit /b
)
start "" explorer "%BASEDIR%"
