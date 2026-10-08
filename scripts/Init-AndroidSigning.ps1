$ErrorActionPreference = 'Stop'
$taskDirectory = Join-Path $env:USERPROFILE '.zenix\signing'
$taskKey = Join-Path $taskDirectory 'zenix-android-release.p12'
$taskConfig = Join-Path $taskDirectory 'android-signing.properties'
$taskKeytool = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr\bin\keytool.exe'
if (!(Test-Path -LiteralPath $taskKeytool)) { throw 'keytool was not found. Install Android Studio first.' }
New-Item -ItemType Directory -Force -Path $taskDirectory | Out-Null
if ((Test-Path -LiteralPath $taskKey) -or (Test-Path -LiteralPath $taskConfig)) {
    if ((Test-Path -LiteralPath $taskKey) -and (Test-Path -LiteralPath $taskConfig)) { Write-Output 'Existing release signing identity retained.'; exit 0 }
    throw 'Signing files are incomplete. Refusing to overwrite release identity.'
}
throw 'Zenix already has a published Android signing identity. Restore the original signing files; generating a replacement key is prohibited.'
