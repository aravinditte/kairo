# run-local.ps1 - start the full Kairo local stack from a fresh clone:
#
#   Kairo API        http://localhost:8080   (in-memory storage unless
#                                            KAIRO_DATABASE_URL is set)
#   checkout         http://localhost:8081
#   inventory        http://localhost:8082
#   payment          http://localhost:8083
#   notifications    http://localhost:8084
#   frontend (opt-in) http://localhost:5173  - only with -Frontend
#
# The API is started in demo mode with the seeded development project and
# the documented development API key `kairo-dev-key`, which is also the
# key the demo services use to ingest spans - so traces from real
# checkouts appear in the API immediately. This key is a development
# credential only; never use it outside a local demo.
#
# Usage:
#   .\scripts\run-local.ps1 [-Frontend]
#
# Press Ctrl-C to stop everything. Logs go to .kairo-run\*.log.
param([switch]$Frontend)
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    # Fall back to well-known install locations before giving up.
    foreach ($candidate in @("$env:ProgramFiles\Go\bin", "$env:LOCALAPPDATA\Programs\Go\bin", "$env:USERPROFILE\go\bin")) {
        if (Test-Path (Join-Path $candidate 'go.exe')) { $env:PATH = "$candidate;$env:PATH"; break }
    }
}
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw 'Go 1.23+ is required (https://go.dev/dl/)'
}

$LogDir = Join-Path $RepoRoot '.kairo-run'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$processes = @()

function Wait-Healthy([string]$Name, [string]$Url) {
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $r = Invoke-RestMethod -Uri $Url -TimeoutSec 2
            if ($r.status -eq 'ok') { Write-Host "    $Name is healthy"; return }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    throw "$Name did not become healthy at $Url; see $LogDir\$Name.log"
}

function Start-Tracked([string]$File, [string[]]$Args, [hashtable]$Env, [string]$Name) {
    $psi = @{
        FilePath               = $File
        ArgumentList           = $Args
        WorkingDirectory       = $RepoRoot
        RedirectStandardOutput = (Join-Path $LogDir "$Name.log")
        RedirectStandardError  = (Join-Path $LogDir "$Name.err.log")
        PassThru               = $true
        NoNewWindow            = $true
    }
    $old = @{}
    foreach ($k in $Env.Keys) { $old[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $Env[$k]) }
    try { $p = Start-Process @psi } finally {
        foreach ($k in $Env.Keys) { [Environment]::SetEnvironmentVariable($k, $old[$k]) }
    }
    $script:processes += $p
    return $p
}

try {
    Write-Host '==> Building Kairo API and demo services'
    go build -o (Join-Path $LogDir 'kairo-api.exe') ./cmd/kairo-api
    go build -o (Join-Path $LogDir 'checkout.exe') ./services/checkout
    go build -o (Join-Path $LogDir 'inventory.exe') ./services/inventory
    go build -o (Join-Path $LogDir 'payment.exe') ./services/payment
    go build -o (Join-Path $LogDir 'notifications.exe') ./services/notifications

    $apiPort = 8080
    Write-Host "==> Starting Kairo API on http://localhost:$apiPort (demo mode, seeded dev project)"
    Start-Tracked (Join-Path $LogDir 'kairo-api.exe') @() @{
        KAIRO_ENV         = if ($env:KAIRO_ENV) { $env:KAIRO_ENV } else { 'development' }
        KAIRO_HTTP_ADDR   = ":$apiPort"
        KAIRO_DEMO_MODE   = 'true'
        KAIRO_SEED_DEMO   = 'true'
        KAIRO_DATABASE_URL = if ($env:KAIRO_DATABASE_URL) { $env:KAIRO_DATABASE_URL } else { '' }
        KAIRO_CHECKOUT_URL = 'http://localhost:8081'
    } 'api' | Out-Null
    Wait-Healthy 'api' "http://localhost:$apiPort/healthz"

    $svcEnv = @{ KAIRO_ENDPOINT = "http://localhost:$apiPort/v1/traces"; KAIRO_API_KEY = 'kairo-dev-key' }
    Write-Host '==> Starting demo services'
    Start-Tracked (Join-Path $LogDir 'inventory.exe') @() ($svcEnv + @{ PORT = '8082' }) 'inventory' | Out-Null
    Start-Tracked (Join-Path $LogDir 'payment.exe') @() ($svcEnv + @{ PORT = '8083' }) 'payment' | Out-Null
    Start-Tracked (Join-Path $LogDir 'notifications.exe') @() ($svcEnv + @{ PORT = '8084' }) 'notifications' | Out-Null
    Start-Tracked (Join-Path $LogDir 'checkout.exe') @() ($svcEnv + @{
        PORT = '8081'; INVENTORY_URL = 'http://localhost:8082'
        PAYMENT_URL = 'http://localhost:8083'; NOTIFICATION_URL = 'http://localhost:8084'
    }) 'checkout' | Out-Null

    Wait-Healthy 'inventory' 'http://localhost:8082/healthz'
    Wait-Healthy 'payment' 'http://localhost:8083/healthz'
    Wait-Healthy 'notifications' 'http://localhost:8084/healthz'
    Wait-Healthy 'checkout' 'http://localhost:8081/healthz'

    $projectId = ''
    try {
        $projects = Invoke-RestMethod -Uri "http://localhost:$apiPort/api/v1/projects" `
            -Headers @{ 'X-Admin-Token' = if ($env:KAIRO_ADMIN_TOKEN) { $env:KAIRO_ADMIN_TOKEN } else { 'kairo-dev-admin' } }
        $items = if ($projects -is [array]) { $projects } else { $projects.projects }
        if ($items -and $items.Count -gt 0) { $projectId = $items[0].id }
    } catch { }

    Write-Host '==> Generating one checkout so a real trace exists'
    try {
        Invoke-RestMethod -Method POST -Uri 'http://localhost:8081/checkout' `
            -ContentType 'application/json' -Body '{"items": 2}' | Out-Null
    } catch {
        Write-Host "    (checkout failed - check $LogDir\checkout.log; the stack is still up)"
    }

    if ($Frontend) {
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw '-Frontend requires npm' }
        Write-Host '==> Starting frontend dev server on http://localhost:5173'
        $env:VITE_DATA_MODE = 'api'
        $env:VITE_API_BASE_URL = "http://localhost:$apiPort"
        Push-Location web
        try {
            npm install --silent | Out-Null
            $p = Start-Process npm -ArgumentList @('run', 'dev') -WorkingDirectory (Get-Location) `
                -RedirectStandardOutput (Join-Path $LogDir 'frontend.log') `
                -RedirectStandardError (Join-Path $LogDir 'frontend.err.log') -PassThru -NoNewWindow
            $processes += $p
        } finally { Pop-Location }
    }

    Write-Host ''
    Write-Host 'Kairo local stack is running:'
    Write-Host "  API:           http://localhost:$apiPort   (health: http://localhost:$apiPort/healthz)"
    Write-Host '  Checkout:      http://localhost:8081  (POST /checkout)'
    Write-Host '  Inventory:     http://localhost:8082  (GET /reserve)'
    Write-Host '  Payment:       http://localhost:8083  (POST /charge)'
    Write-Host '  Notifications: http://localhost:8084  (POST /notify)'
    Write-Host '  Dev API key:   kairo-dev-key (development only)'
    if ($projectId) { Write-Host "  Demo project:  $projectId" }
    if ($Frontend) { Write-Host '  Frontend:      http://localhost:5173' }
    Write-Host "  Logs:          $LogDir\*.log"
    Write-Host ''
    Write-Host 'Press Ctrl-C to stop.'
    while ($true) { Start-Sleep -Seconds 3600 }
} finally {
    Write-Host ''
    Write-Host '==> Stopping Kairo local stack'
    foreach ($p in $processes) {
        if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
}
