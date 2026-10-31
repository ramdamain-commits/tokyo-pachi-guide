# Registers the Task Scheduler tasks that run scripts/run-collect.ps1 on this PC.
# Windows PowerShell 5.1 compatible. Keep this file ASCII only (see docs for the Japanese description).
#
# Tasks:
#   tokyo-pachi-guide-collect          every Monday 06:00
#   tokyo-pachi-guide-collect-logon    at logon (run-collect.ps1 skips it when the last success is within 6 days)
#   tokyo-pachi-guide-collect-monthly  every month on day 1 at 09:00 (registered with schtasks.exe)
# A task that already exists is left as it is (overwriting may need administrator rights).
param(
    [string]$RepoDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$RepoDir = (Resolve-Path -LiteralPath $RepoDir).Path
$runScript = Join-Path $RepoDir "scripts\run-collect.ps1"
if (-not (Test-Path -LiteralPath $runScript)) { throw ("run-collect.ps1 not found: " + $runScript) }

$weeklyName = "tokyo-pachi-guide-collect"
$logonName = "tokyo-pachi-guide-collect-logon"
$monthlyName = "tokyo-pachi-guide-collect-monthly"
$allNames = @($weeklyName, $logonName, $monthlyName)

function Test-TaskExists {
    param([string]$Name)
    $t = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    return ($t -ne $null)
}

# Argument string shared by all tasks. The script resolves node.exe and git.exe itself.
$baseArgs = '-NoProfile -ExecutionPolicy Bypass -File "' + $runScript + '"'

$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

# Weekly: Monday 06:00
if (Test-TaskExists $weeklyName) {
    Write-Host ("already registered: " + $weeklyName)
}
else {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $baseArgs -WorkingDirectory $RepoDir
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "06:00"
    Register-ScheduledTask -TaskName $weeklyName -Action $action -Trigger $trigger -Settings $settings `
        -Description "tokyo-pachi-guide: collect hot events weekly and push data to main" | Out-Null
    Write-Host ("registered: " + $weeklyName)
}

# At logon (catch-up when the PC was off at the scheduled time)
if (Test-TaskExists $logonName) {
    Write-Host ("already registered: " + $logonName)
}
else {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($baseArgs + " -Trigger logon") -WorkingDirectory $RepoDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    Register-ScheduledTask -TaskName $logonName -Action $action -Trigger $trigger -Settings $settings `
        -Description "tokyo-pachi-guide: catch-up collection at logon (skipped if last success is within 6 days)" | Out-Null
    Write-Host ("registered: " + $logonName)
}

# Monthly: day 1 at 09:00 (New-ScheduledTaskTrigger has no monthly option, so use schtasks.exe)
if (Test-TaskExists $monthlyName) {
    Write-Host ("already registered: " + $monthlyName)
}
else {
    $tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"' + $runScript + '\"'
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = & schtasks.exe /Create /TN $monthlyName /SC MONTHLY /D 1 /ST 09:00 /TR $tr 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prev
    }
    foreach ($o in $out) {
        if ($o -is [System.Management.Automation.ErrorRecord]) { Write-Host $o.Exception.Message } else { Write-Host $o }
    }
    if ($code -ne 0) { throw ("schtasks.exe /Create failed with exit code " + $code) }

    # schtasks cannot set WakeToRun / StartWhenAvailable etc., so apply the same settings afterwards.
    try {
        Set-ScheduledTask -TaskName $monthlyName -Settings $settings | Out-Null
        Write-Host ("registered: " + $monthlyName)
    }
    catch {
        Write-Warning ("registered " + $monthlyName + " but could not apply the settings (WakeToRun etc.): " + $_.Exception.Message)
        Write-Warning "Set the wake / run-when-missed options of this task in Task Scheduler, or run Set-ScheduledTask from an administrator PowerShell."
    }
}

# Registration can fail without a terminating error, so check that all tasks exist.
foreach ($n in $allNames) {
    if (-not (Test-TaskExists $n)) { throw ("task was not registered: " + $n) }
}
Write-Host "ok: all tasks exist"
