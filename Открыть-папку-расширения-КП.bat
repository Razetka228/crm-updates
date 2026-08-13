@echo off
rem Universal shortcut to the KP extension folder.
rem Works on ANY machine / ANY username because it resolves %LOCALAPPDATA% at runtime.
set "EXTDIR=%LOCALAPPDATA%\crm-ext\kp"
if not exist "%EXTDIR%" (
  echo.
  echo   Papka rasshireniya poka ne sozdana.
  echo   Snachala zapustite ustanovku ^(Ustanovit-rasshirenie-KP.bat^), potom otkroyte etot fayl.
  echo.
  pause
  exit /b
)
start "" explorer "%EXTDIR%"
