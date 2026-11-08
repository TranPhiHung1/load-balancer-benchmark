param(
    [ValidateSet('http2', 'grpc', 'regression', 'all')][string]$Suite = 'all',
    [ValidateSet('nginx', 'haproxy', 'envoy', 'all')][string]$Balancer = 'all'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    $k6 = (Get-Command k6 -ErrorAction Stop).Source
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $run = Join-Path $PSScriptRoot "results/run-$stamp-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Path $run -ErrorAction Stop | Out-Null
    & $k6 version | Out-File (Join-Path $run 'k6-version.txt') -Encoding utf8
    git rev-parse HEAD | Out-File (Join-Path $run 'git-head.txt') -Encoding utf8
    git diff | Out-File (Join-Path $run 'working-tree.patch') -Encoding utf8
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        docker compose images | Out-File (Join-Path $run 'images.txt') -Encoding utf8
        docker compose ps | Out-File (Join-Path $run 'compose-ps.txt') -Encoding utf8
    }
    $rows = @()
    foreach ($entry in @(@('nginx',0), @('haproxy',1), @('envoy',2))) {
        $name = $entry[0]; $index = [int]$entry[1]
        if ($Balancer -ne 'all' -and $Balancer -ne $name) { continue }
        $jobs = @()
        if ($Suite -in @('http2','all')) { $jobs += ,@('http2', 'benchmark/http2.js', "BASE_URL=https://localhost:$(8440+$index)") }
        if ($Suite -in @('grpc','all')) { $jobs += ,@('grpc', 'benchmark/grpc-unary.js', "GRPC_ADDR=localhost:$(9440+$index)") }
        if ($Suite -in @('regression','all')) {
            $jobs += ,@('rest','benchmark/rest-api.js', "BASE_URL=http://localhost:$(8080+$index)")
            $jobs += ,@('keepalive-on','benchmark/keep-alive.js', "BASE_URL=http://localhost:$(8080+$index)", 'KEEP_ALIVE=on')
            $jobs += ,@('keepalive-off','benchmark/keep-alive.js', "BASE_URL=http://localhost:$(8080+$index)", 'KEEP_ALIVE=off')
        }
        foreach ($job in $jobs) {
            $output = Join-Path $run "$name-$($job[0]).json"
            $arguments = @('run', '--summary-trend-stats=avg,min,med,max,p(90),p(95)', "--summary-export=$output", '-e', $job[2])
            if ($job.Count -gt 3) { $arguments += @('-e', $job[3]) }
            $arguments += $job[1]
            # Windows PowerShell represents native stderr as ErrorRecord objects.
            $ErrorActionPreference = 'Continue'
            & $k6 @arguments 2>&1 | Tee-Object -FilePath (Join-Path $run "$name-$($job[0]).txt") | Out-Host
            $exit = $LASTEXITCODE
            $ErrorActionPreference = 'Stop'
            $rows += [pscustomobject]@{ balancer=$name; workload=$job[0]; exitCode=$exit; summary=$output }
        }
    }
    $rows | ConvertTo-Json -Depth 5 | Out-File (Join-Path $run 'runs.json') -Encoding utf8
    node tools/summarize.cjs $run
    if ($LASTEXITCODE -ne 0) { throw "Summary failed: $run" }
    if (@($rows | Where-Object { $_.exitCode -ne 0 }).Count -gt 0) { throw "One or more benchmarks failed. See $run" }
    Write-Host "Results: $run"
} finally { Pop-Location }
