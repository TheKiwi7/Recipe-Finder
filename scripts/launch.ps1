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
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)] public struct PV { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore { void GetCount(out uint c); void GetAt(uint i, out PKEY k); void GetValue(ref PKEY k, out PV v); void SetValue(ref PKEY k, ref PV v); void Commit(); }
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore s);
  // Identite de la fenetre pour la barre des taches (proprietes System.AppUserModel), posee une fois a l'ouverture :
  // la barre des taches la traite comme l'app Recipe Finder et prend l'icone du .ico (nette a toutes les tailles), au lieu
  // de la petite icone de la page que le navigateur agrandit (floue). Epingler la fenetre relance l'app par le lanceur.
  public static int SetAppIdentity(IntPtr h, string id, string icon, string command) {
    var iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IPropertyStore s;
    int hr = SHGetPropertyStoreForWindow(h, ref iid, out s); if (hr != 0) return hr;
    var g = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    // RelaunchCommand (2), RelaunchIconResource (3), RelaunchDisplayNameResource (4), puis ID (5) qui les active.
    foreach (var kv in new[] { Tuple.Create(2u, command), Tuple.Create(3u, icon), Tuple.Create(4u, "Recipe Finder"), Tuple.Create(5u, id) }) {
      var k = new PKEY { fmtid = g, pid = kv.Item1 }; var v = new PV { vt = 31, p = Marshal.StringToCoTaskMemUni(kv.Item2) };
      s.SetValue(ref k, ref v); Marshal.FreeCoTaskMem(v.p);
    }
    Marshal.ReleaseComObject(s); return 0;
  }
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
$icon = "$root\scripts\logo.ico"
# Commande de l'app, la meme que celle des raccourcis : la barre des taches s'en sert pour la relancer une fois epinglee.
$relaunch = "$env:SystemRoot\System32\conhost.exe --headless $env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$root\scripts\launch.ps1`""

# Raccourcis d'une version precedente (ancien logo recipe-finder.ico, que Windows garde en cache avec l'ancien dessin ;
# PowerShell lance sans conhost --headless, visible dans Windows Terminal) : remis a jour.
$shell = New-Object -ComObject WScript.Shell
$outdated = foreach ($folder in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  $path = "$folder\Recipe Finder.lnk"
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $lnk = $shell.CreateShortcut($path)
  if ($lnk.Arguments.Contains("$root\scripts\launch.ps1") -and ($lnk.IconLocation -ne "$icon,0" -or $lnk.TargetPath -notlike '*\conhost.exe')) { $path }
}
if ($outdated) { & "$root\scripts\create-shortcut.ps1" -OnlyExisting | Out-Null }

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
  while ([RfWindows]::IsWindow($h)) {
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
    if ($h) {
      [void][RfWindows]::SetAppIdentity($h, 'TheKiwi7.RecipeFinder', "$icon,0", $relaunch)
      Restore-Window $h; Watch-Window $h
    }
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
