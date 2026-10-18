# Installation de Recipe Finder en un double-clic (via install.cmd).
# Installe Node.js si besoin (winget), prepare l'app, cree le raccourci du bureau, puis lance l'app.
# L'IA (abonnement Claude ou modele local) se configure ensuite depuis l'app, en un clic.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Green }
function Fail($text) { Write-Host ""; Write-Host "ERREUR : $text" -ForegroundColor Red; exit 1 }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Node-Major {
  try { return [int](& node -p "process.versions.node.split('.')[0]") } catch { return 0 }
}

Write-Host "Installation de Recipe Finder" -ForegroundColor Cyan

Step "Verification de Node.js (24 ou plus)"
if ((Node-Major) -lt 24) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "winget est introuvable. Installe Node.js 24 depuis https://nodejs.org puis relance install.cmd."
  }
  Write-Host "Installation de Node.js (1 a 2 minutes)..."
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  Refresh-Path
  if ((Node-Major) -lt 24) { Fail "Node.js 24 n'a pas pu etre installe. Installe-le depuis https://nodejs.org puis relance install.cmd." }
}
Write-Host "Node.js $(& node --version) OK"

Step "Installation des dependances (1 a 3 minutes)"
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm install a echoue." }

Step "Preparation de l'interface"
& npm run build
if ($LASTEXITCODE -ne 0) { Fail "La construction de l'interface a echoue." }

Step "Creation du raccourci sur le bureau"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$root\scripts\create-shortcut.ps1"

Step "Lancement de Recipe Finder"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$root\scripts\launch.ps1"

Write-Host ""
Write-Host "C'est pret ! La prochaine fois, ouvre l'app avec le raccourci Recipe Finder du bureau." -ForegroundColor Cyan
Write-Host "Pour activer l'IA, suis l'etape \"Connecter une IA\" dans l'app (ou Reglages > Intelligence artificielle)."
