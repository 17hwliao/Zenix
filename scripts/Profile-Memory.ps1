param([switch]$AsJson)

$ErrorActionPreference = 'Stop'
$zenixRoot = Split-Path -Parent $PSScriptRoot
$zenixExecutable = Join-Path $zenixRoot 'node_modules\electron\dist\electron.exe'
$zenixProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $zenixExecutable })
$zenixRoots = @($zenixProcesses | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine.Contains($zenixRoot) })
if (-not $zenixRoots.Count) { throw 'No running Zenix instance from this workspace.' }
$zenixIds = [System.Collections.Generic.HashSet[uint32]]::new()
foreach ($zenixRootProcess in $zenixRoots) { [void]$zenixIds.Add($zenixRootProcess.ProcessId) }
do {
    $zenixAdded = $false
    foreach ($zenixProcess in $zenixProcesses) {
        if ($zenixIds.Contains($zenixProcess.ParentProcessId) -and $zenixIds.Add($zenixProcess.ProcessId)) { $zenixAdded = $true }
    }
} while ($zenixAdded)
$zenixCounters = @{}
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object {
    if ($zenixIds.Contains([uint32]$_.IDProcess)) { $zenixCounters[[uint32]$_.IDProcess] = $_ }
}
$zenixRows = @($zenixProcesses | Where-Object { $zenixIds.Contains($_.ProcessId) } | ForEach-Object {
    $zenixCounter = $zenixCounters[[uint32]$_.ProcessId]
    $zenixRole = if ($_.CommandLine -match '--type=([^\s]+)') { $Matches[1] } else { 'main' }
    [pscustomobject]@{
        Pid = $_.ProcessId
        Role = $zenixRole
        PrivateWorkingMiB = if ($zenixCounter) { [math]::Round($zenixCounter.WorkingSetPrivate / 1MB, 1) } else { $null }
        WorkingMiB = if ($zenixCounter) { [math]::Round($zenixCounter.WorkingSet / 1MB, 1) } else { $null }
        PrivateCommittedMiB = if ($zenixCounter) { [math]::Round($zenixCounter.PrivateBytes / 1MB, 1) } else { $null }
    }
})
$zenixReport = [pscustomobject]@{
    Timestamp = [DateTimeOffset]::Now.ToString('o')
    ProcessCount = $zenixRows.Count
    PrivateWorkingMiB = [math]::Round(($zenixRows | Measure-Object PrivateWorkingMiB -Sum).Sum, 1)
    WorkingMiB = [math]::Round(($zenixRows | Measure-Object WorkingMiB -Sum).Sum, 1)
    PrivateCommittedMiB = [math]::Round(($zenixRows | Measure-Object PrivateCommittedMiB -Sum).Sum, 1)
    Processes = $zenixRows
}
if ($AsJson) { $zenixReport | ConvertTo-Json -Depth 4 }
else {
    $zenixRows | Format-Table
    Write-Output "Private resident: $($zenixReport.PrivateWorkingMiB) MiB; processes: $($zenixReport.ProcessCount)."
    Write-Output 'Working set includes shared pages. Private committed memory is not resident RAM. GPU dedicated memory is separate.'
}
