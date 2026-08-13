# CRM extension auto-update INSTALLER (BT direction). Run ONCE per machine.
#   powershell -NoProfile -ExecutionPolicy Bypass -File bt-install.ps1
#
# 1) downloads the updater script locally
# 2) does the initial sync (populates the extension folder from GitHub)
# 3) registers a scheduled task that re-syncs every few minutes
# Then load the printed folder as an unpacked extension in your browser (once).

$ErrorActionPreference = 'Stop'

$Base        = Join-Path $env:LOCALAPPDATA 'crm-ext'
$ExtDir      = Join-Path $Base 'bt'
$UpdaterPath = Join-Path $Base 'bt-updater.ps1'
$UpdaterUrl  = 'https://raw.githubusercontent.com/Razetka228/crm-updates/main/extensions/tools/bt-updater.ps1'
$VbsPath     = Join-Path $Base 'bt-run-hidden.vbs'
$VbsUrl      = 'https://raw.githubusercontent.com/Razetka228/crm-updates/main/extensions/tools/bt-run-hidden.vbs'
$TaskName    = 'CRM Ext Auto-Update BT'
$IntervalMin = 3

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

New-Item -ItemType Directory -Path $Base -Force | Out-Null

# 1) get the updater script
$u = $UpdaterUrl + '?_=' + [DateTimeOffset]::Now.ToUnixTimeSeconds()
Invoke-WebRequest -Uri $u -OutFile $UpdaterPath -UseBasicParsing -TimeoutSec 60
try { Unblock-File -Path $UpdaterPath } catch {}
Write-Host ("Updater saved: " + $UpdaterPath)

# 1b) get the hidden VBS launcher (prevents a PowerShell window from flashing every run)
$uv = $VbsUrl + '?_=' + [DateTimeOffset]::Now.ToUnixTimeSeconds()
Invoke-WebRequest -Uri $uv -OutFile $VbsPath -UseBasicParsing -TimeoutSec 60
try { Unblock-File -Path $VbsPath } catch {}

# 2) initial sync (populate the extension folder now)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $UpdaterPath
Write-Host ("Initial sync done. Extension folder: " + $ExtDir)

# 3) register the scheduled task (every N minutes, current user)
# Run through wscript + hidden VBS so NO PowerShell window ever appears.
# Register-ScheduledTask (not schtasks.exe) handles paths with spaces correctly.
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$startAt = (Get-Date).AddMinutes(1)
$action  = New-ScheduledTaskAction -Execute $wscript -Argument ('"' + $VbsPath + '"')
$trigger = New-ScheduledTaskTrigger -Once -At $startAt
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Minutes $IntervalMin)).Repetition
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host ("Scheduled task registered: '" + $TaskName + "' every " + $IntervalMin + " min")

Write-Host ""
Write-Host "=== NEXT STEP (once) ==="
Write-Host "Open your browser extensions page, enable Developer mode,"
Write-Host "click 'Load unpacked' and select this folder:"
Write-Host ("    " + $ExtDir)
Write-Host "Remove the old copy of this extension so it is not loaded twice."
