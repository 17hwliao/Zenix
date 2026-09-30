param([switch]$Release)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskJbr = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
if (Test-Path (Join-Path $taskJbr 'bin\java.exe')) { $env:JAVA_HOME = $taskJbr }
$taskSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (!(Test-Path $taskSdk)) { throw 'Install Android SDK or set ANDROID_HOME first.' }
$env:ANDROID_HOME = $taskSdk
$taskSdkProperty = $taskSdk.Replace('\','/')
Set-Content -LiteralPath (Join-Path $taskRoot 'android\local.properties') -Value "sdk.dir=$taskSdkProperty" -Encoding ascii
Push-Location (Join-Path $taskRoot 'android')
try {
    $taskBuild = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
    & .\gradlew.bat $taskBuild --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Android build failed ($LASTEXITCODE)" }
} finally { Pop-Location }
