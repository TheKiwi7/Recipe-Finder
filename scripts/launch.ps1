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

# Taille, position et etat agrandi de la fenetre de l'app : Brave, Chrome et Edge rouvrent une fenetre d'app
# toujours a la meme taille. Le lanceur releve donc l'emplacement de la fenetre aupres de Windows tant qu'elle est
# ouverte (data\window.txt), et le retablit a l'ouverture suivante.
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class RfWindows {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static IntPtr appIcon;
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
  [DllImport("user32.dll", EntryPoint = "SendMessageW")] static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct PLACEMENT { public int length, flags, showCmd; public POINT min, max; public RECT normal; }
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h, ref PLACEMENT p);
  [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr h, ref PLACEMENT p);
  public static List<IntPtr> Find() {
    var found = new List<IntPtr>();
    EnumWindows((h, p) => {
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (IsWindowVisible(h) && sb.ToString() == "Recipe Finder") found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static int SetIcon(IntPtr h, string path) {
    if (appIcon == IntPtr.Zero) appIcon = LoadImage(IntPtr.Zero, path, 1, 32, 32, 0x10);
    if (appIcon == IntPtr.Zero) return Marshal.GetLastWin32Error();
    if (SendMessage(h, 0x7F, new IntPtr(2), IntPtr.Zero) != appIcon) {
      SendMessage(h, 0x80, new IntPtr(0), appIcon);
      SendMessage(h, 0x80, new IntPtr(2), appIcon);
    }
    if (SendMessage(h, 0x7F, new IntPtr(1), IntPtr.Zero) != appIcon)
      SendMessage(h, 0x80, new IntPtr(1), appIcon);
    return 0;
  }
  // "agrandie,gauche,haut,droite,bas" : taille normale (hors agrandissement) et etat agrandi ; reduite = son etat d'avant.
  public static string Get(IntPtr h) {
    var p = new PLACEMENT(); p.length = Marshal.SizeOf(p);
    if (!GetWindowPlacement(h, ref p)) return null;
    bool max = p.showCmd == 3 || (p.showCmd == 2 && (p.flags & 2) != 0);
    return string.Join(",", max ? 1 : 0, p.normal.L, p.normal.T, p.normal.R, p.normal.B);
  }
  public static void Set(IntPtr h, string s) {
    var v = Array.ConvertAll(s.Split(','), int.Parse);
    var p = new PLACEMENT(); p.length = Marshal.SizeOf(p);
    p.showCmd = v[0] == 1 ? 3 : 1;
    p.normal.L = v[1]; p.normal.T = v[2]; p.normal.R = v[3]; p.normal.B = v[4];
    SetWindowPlacement(h, ref p);
  }
}
"@
[void][RfWindows]::SetProcessDPIAware() # pixels reels de l'ecran, a l'enregistrement comme au retablissement
$windowFile = "$root\data\window.txt"

# Attend la nouvelle fenetre de l'app (son titre apparait une fois la page chargee), ou $null.
function Wait-NewWindow($before) {
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 250
    $new = @([RfWindows]::Find() | Where-Object { $before -notcontains $_ })
    if ($new.Count) { return $new[0] }
  }
  return $null
}

function Restore-Window($h) {
  $saved = Get-Content $windowFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $saved -or $saved -notmatch '^[01](,-?\d+){4}$') { return } # premiere ouverture : taille par defaut du navigateur
  $v = $saved.Split(',') | ForEach-Object { [int]$_ }
  # Ecran debranche ou resolution changee : la fenetre doit rester visible, sinon le navigateur decide.
  $rect = New-Object System.Drawing.Rectangle ($v[1] + 8), ($v[2] + 8), ($v[3] - $v[1] - 16), ($v[4] - $v[2] - 16)
  if (-not ([System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.WorkingArea.IntersectsWith($rect) })) { return }
  [RfWindows]::Set($h, $saved)
}

# Releve l'emplacement de la fenetre chaque seconde tant qu'elle est ouverte (le lanceur reste cache en arriere-plan).
function Watch-Window($h) {
  $last = $null
  $iconPath = "$root\scripts\recipe-finder.ico"
  $iconError = [RfWindows]::SetIcon($h, $iconPath)
  if ($iconError) { Write-Warning "Impossible d'appliquer l'icône à la fenêtre ($iconError) : $([ComponentModel.Win32Exception]::new($iconError).Message)" }
  while ([RfWindows]::IsWindow($h)) {
    $iconError = [RfWindows]::SetIcon($h, $iconPath)
    if ($iconError) {
      Write-Warning "Impossible d'appliquer l'icône à la fenêtre ($iconError) : $([ComponentModel.Win32Exception]::new($iconError).Message)"
      break
    }
    $now = [RfWindows]::Get($h)
    if ($now -and $now -ne $last) { Set-Content $windowFile $now -Encoding ascii; $last = $now }
    Start-Sleep -Seconds 1
  }
}

function Open-App {
  $before = @([RfWindows]::Find())
  $exe = Get-DefaultBrowser
  $name = if ($exe) { [IO.Path]::GetFileNameWithoutExtension($exe).ToLower() } else { '' }
  if ($exe -and (Test-Path $exe) -and @('chrome', 'msedge', 'brave', 'vivaldi', 'chromium') -contains $name) {
    Start-Process $exe -ArgumentList "--app=$url"
    $h = Wait-NewWindow $before
    if ($h) { Restore-Window $h; Watch-Window $h }
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
