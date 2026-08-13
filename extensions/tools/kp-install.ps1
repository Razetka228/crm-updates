# CRM extension auto-update INSTALLER (KP direction). Run ONCE per machine.
#   powershell -NoProfile -ExecutionPolicy Bypass -File kp-install.ps1
#
# 1) downloads the updater script locally
# 2) does the initial sync (populates the extension folder from GitHub)
# 3) registers a scheduled task that re-syncs every few minutes
# Then load the printed folder as an unpacked extension in your browser (once).

$ErrorActionPreference = 'Stop'

$Base        = Join-Path $env:LOCALAPPDATA 'crm-ext'
$ExtDir      = Join-Path $Base 'kp'
$UpdaterPath = Join-Path $Base 'kp-updater.ps1'
$UpdaterUrl  = 'https://raw.githubusercontent.com/Razetka228/crm-updates/main/extensions/tools/kp-updater.ps1'
$TaskName    = 'CRM Ext Auto-Update KP'
$IntervalMin = 3

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

New-Item -ItemType Directory -Path $Base -Force | Out-Null

# 1) get the updater script
$u = $UpdaterUrl + '?_=' + [DateTimeOffset]::Now.ToUnixTimeSeconds()
Invoke-WebRequest -Uri $u -OutFile $UpdaterPath -UseBasicParsing -TimeoutSec 60
try { Unblock-File -Path $UpdaterPath } catch {}
Write-Host ("Updater saved: " + $UpdaterPath)

# 2) initial sync (populate the extension folder now)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $UpdaterPath
Write-Host ("Initial sync done. Extension folder: " + $ExtDir)

# 3) register the scheduled task (every N minutes, current user)
$tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $UpdaterPath + '"'
schtasks /Create /TN $TaskName /TR $tr /SC MINUTE /MO $IntervalMin /F | Out-Null
Write-Host ("Scheduled task registered: '" + $TaskName + "' every " + $IntervalMin + " min")

Write-Host ""
Write-Host "=== NEXT STEP (once) ==="
Write-Host "Open your browser extensions page, enable Developer mode,"
Write-Host "click 'Load unpacked' and select this folder:"
Write-Host ("    " + $ExtDir)
Write-Host "Remove the old copy of this extension so it is not loaded twice."
