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

# Fenetres de premier niveau visibles dont le titre commence par "Recipe Finder" (pas l'editeur de code, etc.).
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class RfWindows {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public static List<IntPtr> Find() {
    var found = new List<IntPtr>();
    EnumWindows((h, p) => {
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (IsWindowVisible(h) && sb.ToString().StartsWith("Recipe Finder")) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

# Le navigateur rouvre une fenetre d'app a une taille par defaut (et ignore --start-maximized s'il tourne deja) :
# on agrandit nous-memes la nouvelle fenetre de l'app, des que son titre apparait.
function Maximize-NewWindow($before) {
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 250
    $new = [RfWindows]::Find() | Where-Object { $before -notcontains $_ }
    if ($new) { foreach ($h in $new) { [void][RfWindows]::ShowWindow($h, 3) }; return } # 3 = SW_MAXIMIZE
  }
}

function Open-App {
  $before = @([RfWindows]::Find())
  $exe = Get-DefaultBrowser
  $name = if ($exe) { [IO.Path]::GetFileNameWithoutExtension($exe).ToLower() } else { '' }
  if ($exe -and (Test-Path $exe) -and @('chrome', 'msedge', 'brave', 'vivaldi', 'chromium') -contains $name) {
    Start-Process $exe -ArgumentList "--app=$url"
  } elseif ($exe -and (Test-Path $exe) -and $name -eq 'firefox') {
    Start-Process $exe -ArgumentList '-new-window', $url
  } else {
    Start-Process $url
  }
  Maximize-NewWindow $before
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
