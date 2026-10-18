# Lance Recipe Finder : demarre le serveur en arriere-plan s'il ne tourne pas, puis ouvre Brave en mode application.
# -NoBrowser : demarre seulement le serveur (tests).
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url = 'http://localhost:5317'
$brave = @(
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
  "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

function Test-Server {
  try { Invoke-WebRequest "$url/api/import/status" -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-Server)) {
  Push-Location $root
  try {
    if (-not (Test-Path "$root\node_modules")) { npm install | Out-Null }
    # Reconstruit l'interface si le code a change depuis la derniere construction.
    $built = Get-Item "$root\client\dist\index.html" -ErrorAction SilentlyContinue
    $newest = Get-ChildItem "$root\client\src", "$root\client\index.html" -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $built -or $newest.LastWriteTime -gt $built.LastWriteTime) { npm run build | Out-Null }
  } finally { Pop-Location }

  New-Item -ItemType Directory -Force "$root\data" | Out-Null
  Start-Process node -ArgumentList '--disable-warning=ExperimentalWarning', 'server/index.ts' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput "$root\data\server.log" -RedirectStandardError "$root\data\server-errors.log"
  for ($i = 0; $i -lt 160 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 250 }
}

if ($NoBrowser) { if (Test-Server) { 'server ok' } else { 'server KO' }; return }
if ($brave) { Start-Process $brave -ArgumentList "--app=$url" } else { Start-Process $url }
