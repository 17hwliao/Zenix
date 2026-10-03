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
$taskBytes = New-Object byte[] 32
$taskRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
$taskRandom.GetBytes($taskBytes)
$taskRandom.Dispose()
$taskPassword = ([BitConverter]::ToString($taskBytes)).Replace('-','')
$env:ZENIX_TEMP_KEY_PASSWORD = $taskPassword
try {
    & $taskKeytool -genkeypair -keystore $taskKey -storetype PKCS12 -alias zenix -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Zenix, OU=Mobile, O=17hwliao' -storepass:env ZENIX_TEMP_KEY_PASSWORD -keypass:env ZENIX_TEMP_KEY_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Release key generation failed.' }
    $taskContent = "storeFile=$($taskKey.Replace('\','/'))`nstorePassword=$taskPassword`nkeyAlias=zenix`nkeyPassword=$taskPassword`n"
    [IO.File]::WriteAllText($taskConfig,$taskContent,[Text.UTF8Encoding]::new($false))
    $taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $taskDirectory /inheritance:r /grant:r "${taskIdentity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect signing directory permissions.' }
    Write-Output "Android signing configured. Private files are outside the repository: $taskDirectory"
} finally { Remove-Item Env:ZENIX_TEMP_KEY_PASSWORD -ErrorAction SilentlyContinue }
