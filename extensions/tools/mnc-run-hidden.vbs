' Hidden launcher for the CRM extension updater.
' Runs the updater PowerShell script with NO visible window (no flash every few minutes).
' Path is resolved from %LOCALAPPDATA% at runtime, so it works on any machine / user.
Dim sh, updater
Set sh = CreateObject("WScript.Shell")
updater = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\crm-ext\mnc-updater.ps1")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & updater & """", 0, False
