# CRM extension auto-updater (KP direction).
# Run by Windows Task Scheduler every few minutes.
# Compares the extension version on GitHub with the local one and, if GitHub is
# newer, downloads the fresh files into the local extension folder.
# The extension's own service worker then calls chrome.runtime.reload() to apply.
#
# Works the same on Chrome / Yandex / Edge / Opera (all load unpacked from a folder).

$ErrorActionPreference = 'Stop'

# === CONFIG ===
$ExtDir            = Join-Path $env:LOCALAPPDATA 'crm-ext\kp'
$RepoZipUrl        = 'https://codeload.github.com/Razetka228/crm-updates/zip/refs/heads/main'
$RepoSubPath       = 'crm-updates-main\extensions\kp'
$RemoteManifestUrl = 'https://raw.githubusercontent.com/Razetka228/crm-updates/main/extensions/kp/manifest.json'

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Get-RemoteVersion {
    $u = $RemoteManifestUrl + '?_=' + [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $j = Invoke-RestMethod -Uri $u -Headers @{ 'Cache-Control' = 'no-cache' } -TimeoutSec 30
    return [string]$j.version
}

function Get-LocalVersion {
    $m = Join-Path $ExtDir 'manifest.json'
    if (Test-Path $m) {
        try { return [string]((Get-Content $m -Raw -Encoding UTF8 | ConvertFrom-Json).version) } catch { return '' }
    }
    return ''
}

$remote = ''
try { $remote = Get-RemoteVersion } catch { exit 0 }   # no network -> just wait for next run
if ([string]::IsNullOrWhiteSpace($remote)) { exit 0 }

$local = Get-LocalVersion
if ($remote -eq $local) { exit 0 }                       # already up to date

# Download the repo zip and extract into a temp folder
$tmp = Join-Path $env:TEMP ('crmext_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
    $zip = Join-Path $tmp 'repo.zip'
    Invoke-WebRequest -Uri $RepoZipUrl -OutFile $zip -TimeoutSec 180 -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force

    $src = Join-Path $tmp $RepoSubPath
    if (-not (Test-Path $src)) { exit 1 }

    New-Item -ItemType Directory -Path $ExtDir -Force | Out-Null

    # Copy every file EXCEPT manifest.json first, then manifest.json last,
    # so the version marker only flips after all other files are in place.
    Get-ChildItem -Path $src -File | Where-Object { $_.Name -ne 'manifest.json' } | ForEach-Object {
        Copy-Item $_.FullName -Destination (Join-Path $ExtDir $_.Name) -Force
    }
    Copy-Item (Join-Path $src 'manifest.json') -Destination (Join-Path $ExtDir 'manifest.json') -Force
}
finally {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
