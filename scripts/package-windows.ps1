# Packaging script for OpenCustom Telegram (Windows x64)
$ErrorActionPreference = "Stop"

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " Packaging OpenCustom Telegram for Windows x64" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$RootDir = (Get-Item "$PSScriptRoot\..").FullName
Set-Location $RootDir

# 1. Build frontend
Write-Host "[1/4] Building web frontend (Vite)..." -ForegroundColor Yellow
npm run build

# 2. Build Rust release binary
Write-Host "[2/4] Compiling OpenCustom Telegram (release)..." -ForegroundColor Yellow
cargo build --release -p app

$BinarySource = "$RootDir\target\release\app.exe"
if (-not (Test-Path $BinarySource)) {
    throw "Build failed: $BinarySource does not exist."
}

# 3. Assemble distribution folder
$ReleasesDir = "$RootDir\releases"
$DistDir = "$ReleasesDir\OpenCustomTelegram-windows-x64"
Write-Host "[3/4] Assembling release folder in $DistDir..." -ForegroundColor Yellow
if (Test-Path $DistDir) {
    Remove-Item -Recurse -Force $DistDir
}
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

Copy-Item $BinarySource -Destination "$DistDir\OpenCustomTelegram.exe"
Copy-Item "$RootDir\.data\tdjson.dll" -Destination "$DistDir\"
if (Test-Path "$RootDir\.data\libcrypto-3-x64.dll") { Copy-Item "$RootDir\.data\libcrypto-3-x64.dll" -Destination "$DistDir\" }
if (Test-Path "$RootDir\.data\libssl-3-x64.dll") { Copy-Item "$RootDir\.data\libssl-3-x64.dll" -Destination "$DistDir\" }
if (Test-Path "$RootDir\.data\z.dll") { Copy-Item "$RootDir\.data\z.dll" -Destination "$DistDir\" }

# Copy themes and documentation
Copy-Item -Recurse "$RootDir\themes" -Destination "$DistDir\themes"
Copy-Item "$RootDir\AI_THEME_PROMPT.md" -Destination "$DistDir\"

$Readme = @'
=====================================================
 OpenCustom Telegram Desktop Client (Windows x64)
=====================================================

How to Run:
Double-click `OpenCustomTelegram.exe` to start the client.

Features Included:
- Deep HTML & CSS Customization Engine
- 3 Pre-installed Themes: Tokyo Night, Modern Dark, Cyberpunk Glass HUD
- Drag-and-drop .zip theme installer & live hot-reload
- Ghost Mode: read without read marks & hide typing status
- Local AI Assistant (OpenAI-compatible & Gemini API)

All dependencies (TDLib tdjson.dll, OpenSSL) are bundled in this folder.
'@
Set-Content -Path "$DistDir\README.txt" -Value $Readme

# 4. Create ZIP archive
Write-Host "[4/4] Creating releases\OpenCustomTelegram-windows-x64.zip..." -ForegroundColor Yellow
$ZipPath = "$ReleasesDir\OpenCustomTelegram-windows-x64.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path "$DistDir\*" -DestinationPath $ZipPath

$SizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host "SUCCESS! Windows release archive created at $ZipPath ($SizeMb MB)" -ForegroundColor Green
