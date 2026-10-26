# seed-demo.ps1 - create a Kairo project + API key through the management
# API and ingest a small OTLP/JSON trace sample using curl.exe.
#
# Prerequisites: a running Kairo API (see scripts/run-local.ps1) and
# curl.exe (bundled with modern Windows) - Invoke-RestMethod is used as a
# fallback when curl.exe is not available.
#
# Configuration (environment):
#   KAIRO_ADDR         default http://localhost:8080
#   KAIRO_ADMIN_TOKEN  default kairo-dev-admin (the development default)
#   KAIRO_PROJECT_NAME default "Demo Project"
#
# Output: prints the project ID and the raw API key (shown only here,
# exactly like the API returns it only at creation time) and the seeded
# trace ID.
$ErrorActionPreference = 'Stop'

$Addr = if ($env:KAIRO_ADDR) { $env:KAIRO_ADDR } else { 'http://localhost:8080' }
$AdminToken = if ($env:KAIRO_ADMIN_TOKEN) { $env:KAIRO_ADMIN_TOKEN } else { 'kairo-dev-admin' }
$ProjectName = if ($env:KAIRO_PROJECT_NAME) { $env:KAIRO_PROJECT_NAME } else { 'Demo Project' }

function Invoke-KairoJson {
    param(
        [string]$Method,
        [string]$Url,
        [hashtable]$Headers,
        [string]$Body
    )
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        $args = @('-fsS', '-X', $Method, $Url)
        foreach ($k in $Headers.Keys) { $args += @('-H', "$k`: $($Headers[$k])") }
        if ($null -ne $Body) { $args += @('-d', $Body) }
        $raw = & curl.exe @args
        if ($LASTEXITCODE -ne 0) { throw "curl.exe failed for $Method $Url" }
        return $raw | ConvertFrom-Json
    }
    $params = @{ Method = $Method; Uri = $Url; Headers = $Headers }
    if ($null -ne $Body) { $params.Body = $Body; $params.ContentType = 'application/json' }
    return Invoke-RestMethod @params
}

Write-Host "==> Checking Kairo API at $Addr"
$health = Invoke-KairoJson -Method GET -Url "$Addr/healthz" -Headers @{}
if ($health.status -ne 'ok') { throw "$Addr/healthz is not healthy - is the API running?" }

Write-Host "==> Creating project '$ProjectName'"
$project = Invoke-KairoJson -Method POST -Url "$Addr/api/v1/projects" `
    -Headers @{ 'X-Admin-Token' = $AdminToken } `
    -Body (@{ name = $ProjectName } | ConvertTo-Json -Compress)
$projectId = $project.id
Write-Host "    project_id: $projectId"

Write-Host "==> Creating API key"
$key = Invoke-KairoJson -Method POST -Url "$Addr/api/v1/projects/$projectId/api-keys" `
    -Headers @{ 'X-Admin-Token' = $AdminToken } -Body '{}'
$rawKey = $key.raw_key
Write-Host "    api_key (shown only once - store it now): $rawKey"

Write-Host "==> Building OTLP sample payload"
# OTLP/JSON encodes trace/span IDs as hex strings.
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-RandomBytes([int]$n) {
    $b = New-Object byte[] $n
    $rng.GetBytes($b)
    # Avoid an all-zero ID, which OTLP forbids.
    $allZero = $true; foreach ($x in $b) { if ($x -ne 0) { $allZero = $false } }
    if ($allZero) { $b[0] = 1 }
    return $b
}
$traceIdBytes = New-RandomBytes 16
$traceIdHex = ([System.BitConverter]::ToString($traceIdBytes) -replace '-', '').ToLower()
$spanIdBytes = @(1..4 | ForEach-Object { New-RandomBytes 8 })
$hex = { param($bytes) ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower() }
$nowNs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() * 1000000
$ms = 1000000

function New-Span($idx, $name, $kind, $parentIdx, $startOff, $durNs) {
    $s = [ordered]@{
        traceId           = (& $hex $traceIdBytes)
        spanId            = (& $hex $spanIdBytes[$idx])
        name              = $name
        kind              = $kind
        startTimeUnixNano = [string]($nowNs + $startOff)
        endTimeUnixNano   = [string]($nowNs + $startOff + $durNs)
        status            = @{ code = 'STATUS_CODE_OK' }
        attributes        = @(@{ key = 'seed.source'; value = @{ stringValue = 'seed-demo' } })
    }
    if ($null -ne $parentIdx) { $s.parentSpanId = (& $hex $spanIdBytes[$parentIdx]) }
    return $s
}

$payload = @{
    resourceSpans = @(@{
        resource   = @{ attributes = @(
            @{ key = 'service.name'; value = @{ stringValue = 'checkout' } },
            @{ key = 'telemetry.sdk.name'; value = @{ stringValue = 'kairo-seed' } }
        ) }
        scopeSpans = @(@{
            scope = @{ name = 'kairo/seed'; version = '1.0.0' }
            spans = @(
                (New-Span 0 'POST /checkout' 2 $null 0 (42 * $ms)),
                (New-Span 1 'GET /reserve' 2 0 (2 * $ms) (9 * $ms)),
                (New-Span 2 'POST /charge' 2 0 (13 * $ms) (18 * $ms)),
                (New-Span 3 'POST /notify' 2 0 (33 * $ms) (6 * $ms))
            )
        })
    })
} | ConvertTo-Json -Depth 10 -Compress

$payloadFile = [System.IO.Path]::GetTempFileName()
try {
    [System.IO.File]::WriteAllText($payloadFile, $payload)
    Write-Host "==> Ingesting sample trace $traceIdHex"
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe -fsS -X POST "$Addr/v1/traces" `
            -H "Authorization: Bearer $rawKey" `
            -H 'Content-Type: application/json' `
            --data-binary "@$payloadFile" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'ingestion request failed' }
    } else {
        Invoke-RestMethod -Method POST -Uri "$Addr/v1/traces" `
            -Headers @{ Authorization = "Bearer $rawKey" } `
            -ContentType 'application/json' -Body $payload | Out-Null
    }
    Write-Host '    ingested OK'
} finally {
    Remove-Item $payloadFile -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Seed complete.'
Write-Host "  project_id: $projectId"
Write-Host "  api_key:    $rawKey"
Write-Host "  trace_id:   $traceIdHex"
Write-Host "Explore it at $Addr/api/v1/traces/$traceIdHex`?project_id=$projectId (with the API key or admin token)."
