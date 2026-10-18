# Installation de Recipe Finder en un double-clic (via install.cmd).
# Installe Node.js si besoin (winget), prepare l'app, cree les raccourcis (bureau, menu Demarrer), puis lance l'app.
# L'IA (abonnement Claude ou modele local) se configure ensuite depuis l'app, en un clic.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
# Depot d'origine : les mises a jour de l'app viennent de la (Reglages > Mises a jour).
$repoUrl = 'https://github.com/TheKiwi7/Recipe-Finder.git'

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

Step "Mises a jour automatiques (Git)"
if (-not (Get-Command git -ErrorAction SilentlyContinue) -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "Installation de Git (1 a 2 minutes)..."
  winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  Refresh-Path
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Git indisponible : l'app fonctionnera, mais sans mises a jour automatiques." -ForegroundColor Yellow
} elseif (Test-Path "$root\.git") {
  Write-Host "Mises a jour automatiques actives."
} else {
  # Telechargee en ZIP : le dossier devient une copie suivie du depot, a la derniere version.
  # Les donnees (dossier data) ne sont pas suivies par git : elles ne sont jamais touchees.
  & git init -q
  & git remote add origin $repoUrl
  & git fetch -q origin main
  if ($LASTEXITCODE -eq 0) {
    & git reset -q --hard origin/main
    & git branch -q -M main
    & git branch -q -u origin/main
    Write-Host "Mises a jour automatiques activees."
  } else {
    Remove-Item -Recurse -Force "$root\.git"
    Write-Host "GitHub injoignable : mises a jour automatiques non activees (relance install.cmd plus tard)." -ForegroundColor Yellow
  }
}

Step "Installation des dependances (1 a 3 minutes)"
# npm ci : exactement les versions verifiees de package-lock.json (installation identique chez tout le monde).
& npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "L'installation des dependances a echoue (connexion internet ?)." }

Step "Preparation de l'interface"
& npm run build
if ($LASTEXITCODE -ne 0) { Fail "La construction de l'interface a echoue." }

Step "Creation des raccourcis (bureau et menu Demarrer)"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$root\scripts\create-shortcut.ps1"

Step "Lancement de Recipe Finder"
# En arriere-plan : le lanceur reste actif (sans fenetre, via conhost --headless comme le raccourci) tant que la fenetre
# de l'app est ouverte, pour retenir sa taille.
Start-Process "$env:SystemRoot\System32\conhost.exe" -ArgumentList '--headless', "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe", '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$root\scripts\launch.ps1`""

Write-Host ""
Write-Host "C'est pret ! La prochaine fois, ouvre l'app avec le raccourci Recipe Finder du bureau." -ForegroundColor Cyan
Write-Host "Pour activer l'IA, suis l'etape \"Connecter une IA\" dans l'app (ou Reglages > Intelligence artificielle)."
