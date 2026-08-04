$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "WAW Desk"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# Dead Vite "hot" file makes the desk a blank white page — always remove it for icon launches
$hot = Join-Path $Root "public\hot"
if (Test-Path $hot) {
    Remove-Item $hot -Force -ErrorAction SilentlyContinue
}

$Log = Join-Path $Root "waw-desk-start.log"
function Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Add-Content -Path $Log -Value $line
    Write-Host $msg
}

"" | Set-Content $Log
Log "========================================"
Log " WAW Karaoke Desk"
Log "========================================"
Log ""

$DockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$PhpExe = "C:\xampp\php\php.exe"
if (-not (Test-Path $PhpExe)) { $PhpExe = "php" }

function Test-DockerReady {
    try {
        & docker info 1>$null 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# --- 1) Docker ---
Log "[1/4] Checking Docker..."
if (-not (Test-DockerReady)) {
    Log "      Docker is off - starting Docker Desktop..."
    if (-not (Test-Path $DockerExe)) {
        Log "ERROR: Docker Desktop not found."
        Log "Install Docker Desktop once, then try again."
        Read-Host "Press Enter to close"
        exit 1
    }
    Start-Process -FilePath $DockerExe | Out-Null
    Log "      Waiting for Docker (can take 1-2 minutes)..."
    $ok = $false
    for ($i = 1; $i -le 90; $i++) {
        Start-Sleep -Seconds 2
        if (Test-DockerReady) {
            $ok = $true
            break
        }
        Write-Host ("      still waiting... {0}/90" -f $i)
    }
    if (-not $ok) {
        Log "ERROR: Docker did not start in time."
        Log "Open Docker Desktop, wait until Engine is running, then click WAW Desk again."
        Read-Host "Press Enter to close"
        exit 1
    }
}
Log "      Docker is ready."

# --- 2) Database ---
Log "[2/4] Starting database..."
$exists = $false
try {
    & docker inspect waw-postgres 1>$null 2>$null
    $exists = ($LASTEXITCODE -eq 0)
} catch {
    $exists = $false
}

if (-not $exists) {
    Log "      Creating database container (first time)..."
    & docker run -d --name waw-postgres `
        -e POSTGRES_USER=waw `
        -e POSTGRES_PASSWORD=waw123 `
        -e POSTGRES_DB=karaoke_scheduler `
        -p 5432:5432 `
        postgres:16
    if ($LASTEXITCODE -ne 0) {
        Log "ERROR: Could not create database container."
        Read-Host "Press Enter to close"
        exit 1
    }
} else {
    & docker start waw-postgres 1>$null 2>$null
}

$pgOk = $false
for ($i = 1; $i -le 45; $i++) {
    & docker exec waw-postgres pg_isready -U waw 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
        $pgOk = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $pgOk) {
    Log "ERROR: Database not ready."
    Read-Host "Press Enter to close"
    exit 1
}
Log "      Database is ready."

# --- 3) PHP server ---
Log "[3/4] Starting desk server..."
try {
    & $PhpExe -v 1>$null 2>$null
} catch {
    Log "ERROR: PHP not found at $PhpExe"
    Read-Host "Press Enter to close"
    exit 1
}

$listening = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    $serverBat = Join-Path $Root "start-waw-server.bat"
    Start-Process -FilePath $env:ComSpec -ArgumentList "/c `"$serverBat`"" -WindowStyle Minimized
    $up = $false
    for ($i = 1; $i -le 30; $i++) {
        Start-Sleep -Seconds 1
        $listening = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
        if ($listening) {
            $up = $true
            break
        }
    }
    if (-not $up) {
        Log "ERROR: Server did not start on port 8000."
        Read-Host "Press Enter to close"
        exit 1
    }
}
Log "      Server is ready."

# --- 4) Browser ---
Log "[4/4] Opening dashboard..."
Start-Process "http://127.0.0.1:8000/login"

Log ""
Log "SUCCESS - login page should open."
Log "You can close this window."
Start-Sleep -Seconds 4
