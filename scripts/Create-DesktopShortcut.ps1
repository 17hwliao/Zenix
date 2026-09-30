$ErrorActionPreference = 'Stop'
$zenixRoot = Split-Path -Parent $PSScriptRoot
$zenixExecutable = Join-Path $zenixRoot 'node_modules\electron\dist\electron.exe'
$zenixBuild = Join-Path $zenixRoot 'dist\index.html'
$zenixIcon = Join-Path $zenixRoot 'assets\zenix-icon.ico'
foreach ($zenixRequired in @($zenixExecutable, $zenixBuild, $zenixIcon)) {
    if (-not (Test-Path -LiteralPath $zenixRequired -PathType Leaf)) {
        throw "Missing launch file: $zenixRequired. Install dependencies and run npm run build first."
    }
}
$zenixDesktop = [Environment]::GetFolderPath('Desktop')
$zenixShortcutPath = Join-Path $zenixDesktop 'Zenix.lnk'
$zenixShell = New-Object -ComObject WScript.Shell
$zenixShortcut = $zenixShell.CreateShortcut($zenixShortcutPath)
$zenixShortcut.TargetPath = $zenixExecutable
$zenixShortcut.Arguments = '"' + $zenixRoot + '"'
$zenixShortcut.WorkingDirectory = $zenixRoot
$zenixShortcut.IconLocation = "$zenixIcon,0"
$zenixShortcut.WindowStyle = 1
$zenixShortcut.Description = 'Launch or restore Zenix Music Player'
$zenixShortcut.Save()
Write-Output "Created: $zenixShortcutPath"
