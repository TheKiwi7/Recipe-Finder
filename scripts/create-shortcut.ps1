# Cree le raccourci " Recipe Finder " sur le bureau et dans le menu Demarrer (la recherche de Windows le trouve la,
# avec son icone).
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$icon = "$root\scripts\recipe-finder.ico"
$folders = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($folder in $folders) {
  $lnk = $shell.CreateShortcut("$folder\Recipe Finder.lnk")
  $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\launch.ps1`""
  $lnk.WorkingDirectory = $root
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Description = 'Recipe Finder'
  $lnk.WindowStyle = 7 # minimise : pas de fenetre console visible
  $lnk.Save()
  Write-Output "Raccourci cree : $folder\Recipe Finder.lnk"
}
# Windows garde en cache l'ancienne icone d'un raccourci recree : on lui demande de la relire.
& "$env:SystemRoot\System32\ie4uinit.exe" -show 2>$null
