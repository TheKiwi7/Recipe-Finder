# Cree le raccourci " Recipe Finder " sur le bureau.
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut("$desktop\Recipe Finder.lnk")
$lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\launch.ps1`""
$lnk.WorkingDirectory = $root
$icon = "$root\scripts\recipe-finder.ico"
if (Test-Path $icon) { $lnk.IconLocation = $icon }
$lnk.WindowStyle = 7 # minimise : pas de fenetre console visible
$lnk.Save()
Write-Output "Raccourci cree : $desktop\Recipe Finder.lnk"
