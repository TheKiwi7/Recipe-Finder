# Cree le raccourci " Recipe Finder " sur le bureau et dans le menu Demarrer (la recherche de Windows le trouve la,
# avec son icone). -OnlyExisting : met seulement a jour ceux qui existent (le lanceur s'en sert apres un changement).
param([switch]$OnlyExisting)
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
# Logo de l'app (docs/logo.svg), 16 a 256 px. S'il change, changer aussi le nom du fichier : Windows garde les icones
# en cache par chemin, et continuerait d'afficher l'ancien dessin (c'est arrive avec recipe-finder.ico).
$icon = "$root\scripts\logo.ico"
$folders = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($folder in $folders) {
  $path = "$folder\Recipe Finder.lnk"
  if ($OnlyExisting -and -not (Test-Path -LiteralPath $path)) { continue }
  $lnk = $shell.CreateShortcut($path)
  # conhost --headless : le lanceur tourne sans fenetre. PowerShell seul s'ouvrirait dans Windows Terminal, qui ignore
  # -WindowStyle Hidden et laisserait un terminal dans la barre des taches tant que l'app est ouverte.
  $lnk.TargetPath = "$env:SystemRoot\System32\conhost.exe"
  $lnk.Arguments = "--headless $env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$root\scripts\launch.ps1`""
  $lnk.WorkingDirectory = $root
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Description = 'Recipe Finder'
  $lnk.WindowStyle = 7 # minimise : pas de fenetre console visible
  $lnk.Save()
  Write-Output "Raccourci cree : $path"
}
