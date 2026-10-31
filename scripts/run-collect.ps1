# Runs the hot-events collection on this PC and pushes the data to main.
# Windows PowerShell 5.1 compatible. Keep this file ASCII only (see docs for the Japanese description).
#
# Exit codes:
#   0 = done (data updated and pushed, nothing changed, or skipped on purpose)
#   1 = a step failed (pull / tests / collect / validate / commit / push)
#   2 = skipped because the checkout is not clean on main (someone is working here)
param(
    [string]$RepoDir = (Split-Path -Parent $PSScriptRoot),
    [string]$Trigger = "",
    [string]$NodePath = "",
    [string]$GitPath = ""
)

$ErrorActionPreference = "Stop"

# Output of native commands is UTF-8 (node, git).
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$RepoDir = (Resolve-Path -LiteralPath $RepoDir).Path
$LogDir = Join-Path $RepoDir "logs"
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = Join-Path $LogDir ("collect-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".log")

function Write-Log {
    param([string]$Message)
    $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " " + $Message
    $line | Out-File -FilePath $LogFile -Encoding utf8 -Append
}

function Stop-Run {
    param([int]$Code, [string]$Message)
    Write-Log ($Message + " (exit " + $Code + ")")
    exit $Code
}

function Resolve-Exe {
    param([string]$Given, [string]$CommandName, [string[]]$Fallbacks)
    if ($Given -ne "" -and (Test-Path -LiteralPath $Given)) { return $Given }
    $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd -ne $null -and $cmd.Source) { return $cmd.Source }
    foreach ($f in $Fallbacks) {
        if (Test-Path -LiteralPath $f) { return $f }
    }
    return ""
}

# Runs a native command with stderr merged in. ErrorActionPreference is relaxed only for the call,
# so that the first stderr line does not abort the script. Returns @{ Code = int; Lines = string[] }.
function Invoke-Native {
    param([string]$Exe, [string[]]$CommandArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = $null
    $code = 1
    try {
        $out = & $Exe @CommandArgs 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prev
    }
    $lines = @()
    foreach ($o in $out) {
        if ($o -is [System.Management.Automation.ErrorRecord]) {
            $lines += [string]$o.Exception.Message
        }
        else {
            $lines += [string]$o
        }
    }
    return @{ Code = $code; Lines = $lines }
}

function Write-Native {
    param($Result)
    foreach ($l in $Result.Lines) { Write-Log ("  " + $l) }
}

# Throw away everything the collect step left in data/ (the tree was clean before the run, so the
# differences are all from this run). Without this, the next run would be skipped (exit 2) forever.
function Restore-Data {
    param([string]$GitExe)
    $r1 = Invoke-Native $GitExe @("restore", "--worktree", "--staged", "data")
    Write-Native $r1
    $r2 = Invoke-Native $GitExe @("clean", "-fd", "data")
    Write-Native $r2
    if ($r1.Code -ne 0 -or $r2.Code -ne 0) {
        Write-Log "WARNING: could not restore data/ completely; fix it by hand"
    }
    else {
        Write-Log "data/ restored to the committed state"
    }
}

# Exclusive lock so that only one run is active at a time (several tasks can fire at once).
# Held until the process ends. If another run holds it, skip with exit code 0.
$LockFile = Join-Path $LogDir "collect.lock"
$lockStream = $null
try {
    $lockStream = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
}
catch {
    try { Write-Log "skip: another run is in progress (lock held) (exit 0)" } catch { }
    exit 0
}

try {
    Write-Log ("start: repo=" + $RepoDir + " trigger=" + $Trigger)

    $node = Resolve-Exe $NodePath "node.exe" @("C:\Program Files\nodejs\node.exe")
    $git = Resolve-Exe $GitPath "git.exe" @("C:\Program Files\Git\cmd\git.exe", "C:\Program Files\Git\bin\git.exe")
    if ($node -eq "") { Stop-Run 1 "node.exe not found" }
    if ($git -eq "") { Stop-Run 1 "git.exe not found" }
    Write-Log ("node=" + $node)
    Write-Log ("git=" + $git)

    Set-Location -LiteralPath $RepoDir
    $env:GIT_TERMINAL_PROMPT = "0"

    # Logon trigger: skip when the last success is within 6 days (do not collect at every logon).
    if ($Trigger -eq "logon") {
        $metaPath = Join-Path $RepoDir "data\collect-meta.json"
        if (Test-Path -LiteralPath $metaPath) {
            $last = $null
            try {
                $meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $last = [DateTimeOffset]::Parse([string]$meta.lastSuccessAt, [System.Globalization.CultureInfo]::InvariantCulture)
            }
            catch {
                $last = $null
            }
            if ($last -ne $null) {
                $ageDays = ((Get-Date) - $last.LocalDateTime).TotalDays
                if ($ageDays -le 6) {
                    Stop-Run 0 ("logon trigger: last success " + $last.ToString("o") + " is within 6 days, skip")
                }
                Write-Log ("logon trigger: last success " + $last.ToString("o") + " is older than 6 days")
            }
            else {
                Write-Log "logon trigger: lastSuccessAt could not be read, run"
            }
        }
        else {
            Write-Log "logon trigger: collect-meta.json not found, run"
        }
    }

    # Step 2: do nothing unless the checkout is clean and on main.
    $r = Invoke-Native $git @("branch", "--show-current")
    Write-Native $r
    if ($r.Code -ne 0) { Stop-Run 1 "git branch --show-current failed" }
    $branch = (($r.Lines -join "").Trim())
    if ($branch -ne "main") {
        Stop-Run 2 ("skip: current branch is '" + $branch + "', not main")
    }
    $r = Invoke-Native $git @("status", "--porcelain")
    if ($r.Code -ne 0) { Write-Native $r; Stop-Run 1 "git status failed" }
    $dirty = @($r.Lines | Where-Object { $_ -ne "" })
    if ($dirty.Count -gt 0) {
        Write-Native $r
        Stop-Run 2 "skip: working tree has uncommitted changes"
    }

    # Step 3: fast-forward pull only.
    # Retry up to 2 more times, 60 seconds apart (the network may not be up right after a resume).
    $pullAttempt = 0
    while ($true) {
        $pullAttempt++
        $r = Invoke-Native $git @("pull", "--ff-only")
        Write-Native $r
        if ($r.Code -eq 0) { break }
        if ($pullAttempt -ge 3) { Stop-Run 1 "git pull --ff-only failed" }
        Write-Log ("git pull --ff-only failed (attempt " + $pullAttempt + "), retry in 60 seconds")
        Start-Sleep -Seconds 60
    }

    # Step 4: tests, collect, validate. Stop with the failing exit code.
    $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $RepoDir "test") -Filter "*.test.mjs" | Sort-Object Name | ForEach-Object { "test/" + $_.Name })
    $r = Invoke-Native $node (@("--test") + $testFiles)
    Write-Native $r
    if ($r.Code -ne 0) { Stop-Run $r.Code "node --test failed" }

    $r = Invoke-Native $node @("scripts/collect-events.mjs")
    Write-Native $r
    if ($r.Code -ne 0) {
        Restore-Data $git
        Stop-Run $r.Code "collect-events.mjs failed"
    }

    $r = Invoke-Native $node @("scripts/validate-data.mjs")
    Write-Native $r
    if ($r.Code -ne 0) {
        Restore-Data $git
        Stop-Run $r.Code "validate-data.mjs failed"
    }

    # Step 5: nothing to commit?
    $r = Invoke-Native $git @("status", "--porcelain", "data")
    if ($r.Code -ne 0) { Write-Native $r; Stop-Run 1 "git status data failed" }
    $changed = @($r.Lines | Where-Object { $_ -ne "" })

    # Step 6: commit (message from scripts/commit-message.txt) and push.
    if ($changed.Count -gt 0) {
        Write-Log ("changed files: " + $changed.Count)
        $today = Get-Date -Format "yyyy-MM-dd"
        $template = Join-Path $RepoDir "scripts\commit-message.txt"
        $messageFile = Join-Path $LogDir "commit-message.tmp"
        $text = [System.IO.File]::ReadAllText($template, [System.Text.Encoding]::UTF8)
        $text = $text.Replace("{DATE}", $today)
        [System.IO.File]::WriteAllText($messageFile, $text, (New-Object System.Text.UTF8Encoding($false)))

        $r = Invoke-Native $git @("add", "data")
        Write-Native $r
        if ($r.Code -ne 0) {
            Restore-Data $git
            Stop-Run 1 "git add data failed"
        }

        $r = Invoke-Native $git @("commit", "-F", $messageFile)
        Write-Native $r
        if ($r.Code -ne 0) {
            # Leave data/ clean; otherwise the staged files make every later run exit 2 (skipped).
            Restore-Data $git
            Stop-Run 1 "git commit failed"
        }
    }
    else {
        Write-Log "no changes in data"
    }

    # Push when there are local commits not on the remote (a commit left by a failed push is pushed here).
    $r = Invoke-Native $git @("rev-list", "--count", "@{u}..HEAD")
    if ($r.Code -ne 0) { Write-Native $r; Stop-Run 1 "git rev-list failed" }
    $countLines = @($r.Lines | Where-Object { ([string]$_).Trim() -ne "" })
    $ahead = 0
    $countText = ""
    if ($countLines.Count -gt 0) { $countText = ([string]$countLines[$countLines.Count - 1]).Trim() }
    if (-not [int]::TryParse($countText, [ref]$ahead)) {
        Write-Native $r
        Stop-Run 1 ("could not read the number of unpushed commits: '" + $countText + "'")
    }
    if ($ahead -eq 0) {
        Stop-Run 0 "nothing to push"
    }
    Write-Log ("commits to push: " + $ahead)

    $r = Invoke-Native $git @("push")
    Write-Native $r
    if ($r.Code -ne 0) { Stop-Run 1 "git push failed (the commit stays; the next run pushes it)" }

    Stop-Run 0 "done: data committed and pushed"
}
catch {
    Write-Log ("unexpected error: " + $_.Exception.Message)
    exit 1
}
finally {
    if ($lockStream -ne $null) { $lockStream.Close() }
}
