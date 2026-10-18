# Lance Recipe Finder : demarre le serveur en arriere-plan s'il ne tourne pas, puis ouvre l'app dans le navigateur
# par defaut de la personne. Navigateurs Chromium (Chrome, Edge, Brave, Vivaldi) : fenetre dediee sans barre d'adresse ;
# Firefox : nouvelle fenetre ; autres : ouverture classique.
# -NoBrowser : demarre seulement le serveur (tests).
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:5317' # pas localhost : sous Windows il se resout d'abord en IPv6 (::1), ou le serveur n'ecoute pas

# Executable du navigateur par defaut (choix de l'utilisateur pour les liens http), ou $null.
function Get-DefaultBrowser {
  try {
    $progId = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction Stop).ProgId
    $cmd = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -ErrorAction Stop).'(default)'
    if ($cmd -match '^"([^"]+)"') { return $Matches[1] }
    if ($cmd -match '^(\S+\.exe)') { return $Matches[1] }
  } catch {}
  return $null
}

function Open-App {
  $exe = Get-DefaultBrowser
  $name = if ($exe) { [IO.Path]::GetFileNameWithoutExtension($exe).ToLower() } else { '' }
  if ($exe -and (Test-Path $exe) -and @('chrome', 'msedge', 'brave', 'vivaldi', 'chromium') -contains $name) {
    Start-Process $exe -ArgumentList "--app=$url"
  } elseif ($exe -and (Test-Path $exe) -and $name -eq 'firefox') {
    Start-Process $exe -ArgumentList '-new-window', $url
  } else {
    Start-Process $url
  }
}

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
Open-App
