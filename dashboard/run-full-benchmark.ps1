[CmdletBinding()]
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$runnerPath = Join-Path $PSScriptRoot 'full-benchmark-runner.cjs'
$projectPath = Split-Path $PSScriptRoot -Parent
if (-not $CheckOnly) {
    Write-Host 'FULL RUN: 15 real k6 tests, sequential, with Docker CPU/RAM sampling.'
    Write-Host 'About 450 seconds of load plus startup/teardown. Existing data is preserved.'
    $confirmation = Read-Host 'Type RUN to confirm (anything else cancels)'
    if ($confirmation -cne 'RUN') { Write-Host 'Cancelled. No benchmark started.'; return }
}
$runnerMode = '--run'
if ($CheckOnly) { $runnerMode = '--check' }
Push-Location $projectPath
try {
    # Native stderr must remain visible without terminating Windows PowerShell 5.1 early.
    $ErrorActionPreference = 'Continue'
    & $nodePath $runnerPath $runnerMode
    $fullBenchmarkExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = 'Stop'
    Pop-Location
}
if ($fullBenchmarkExit -ne 0) { throw "Full runner failed/cancelled (exit $fullBenchmarkExit). Read the log and new RUN directory above." }
