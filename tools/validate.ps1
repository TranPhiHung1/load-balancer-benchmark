$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    Get-Command docker -ErrorAction Stop | Out-Null
    docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Invalid Compose configuration' }
    node tools/generate-certs.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Certificate generation failed' }
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw 'Compose startup failed' }
    docker compose ps
    docker compose exec -T nginx nginx -V
    if ($LASTEXITCODE -ne 0) { throw 'nginx version check failed' }
    docker compose exec -T nginx nginx -t
    if ($LASTEXITCODE -ne 0) { throw 'nginx validation failed' }
    docker compose exec -T haproxy haproxy -vv
    if ($LASTEXITCODE -ne 0) { throw 'HAProxy version check failed' }
    docker compose exec -T haproxy haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg
    if ($LASTEXITCODE -ne 0) { throw 'HAProxy validation failed' }
    docker compose exec -T envoy envoy --version
    if ($LASTEXITCODE -ne 0) { throw 'Envoy version check failed' }
    docker compose exec -T envoy envoy --mode validate -c /etc/envoy/envoy.yaml
    if ($LASTEXITCODE -ne 0) { throw 'Envoy validation failed' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        node tools/verify.cjs
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (!$ready) {
        docker compose logs --tail 100
        throw 'Protocol/distribution checks failed; inspect logs above'
    }
} finally { Pop-Location }
