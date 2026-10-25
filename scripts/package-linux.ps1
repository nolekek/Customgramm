# Packaging script for OpenCustom Telegram (Linux x64)
$ErrorActionPreference = "Stop"

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " Packaging OpenCustom Telegram for Linux x64" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$RootDir = (Get-Item "$PSScriptRoot\..").FullName
Set-Location $RootDir

$ReleasesDir = "$RootDir\releases"
$DistDir = "$ReleasesDir\OpenCustomTelegram-linux-x64"
Write-Host "Assembling Linux release in $DistDir..." -ForegroundColor Yellow

if (Test-Path $DistDir) {
    Remove-Item -Recurse -Force $DistDir
}
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

$BinarySource = "$RootDir\target\release\app"
if (-not (Test-Path $BinarySource)) {
    throw "Build failed: $BinarySource does not exist."
}

Copy-Item $BinarySource -Destination "$DistDir\OpenCustomTelegram"
Copy-Item "$RootDir\.data\libtdjson.so" -Destination "$DistDir\"
Copy-Item -Recurse "$RootDir\themes" -Destination "$DistDir\themes"
Copy-Item "$RootDir\AI_THEME_PROMPT.md" -Destination "$DistDir\"

$RunScript = @'
#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"
chmod +x ./OpenCustomTelegram
export LD_LIBRARY_PATH="$DIR:$LD_LIBRARY_PATH"
exec ./OpenCustomTelegram "$@"
'@
[System.IO.File]::WriteAllText("$DistDir\run.sh", $RunScript.Replace("`r`n", "`n"))

$Readme = @'
===================================================
 OpenCustom Telegram Desktop Client (Linux x64)
===================================================

How to Run:
```bash
chmod +x OpenCustomTelegram run.sh
./run.sh
# or directly:
export LD_LIBRARY_PATH=".:$LD_LIBRARY_PATH"
./OpenCustomTelegram
```

Features Included:
- Deep HTML & CSS Customization Engine
- 3 Pre-installed Themes: Tokyo Night, Modern Dark, Cyberpunk Glass HUD
- Drag-and-drop .zip theme installer & live hot-reload
- Ghost Mode: read without read marks & hide typing status
- Local AI Assistant (OpenAI-compatible & Gemini API)

All dependencies (TDLib libtdjson.so) are bundled in this folder.
'@
[System.IO.File]::WriteAllText("$DistDir\README.txt", $Readme.Replace("`r`n", "`n"))

Write-Host "Creating releases\OpenCustomTelegram-linux-x64.tar.gz..." -ForegroundColor Yellow
wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/Admin/TelegramRape/TelegramFullOpenCustom/releases && chmod +x OpenCustomTelegram-linux-x64/OpenCustomTelegram OpenCustomTelegram-linux-x64/run.sh && tar -czf OpenCustomTelegram-linux-x64.tar.gz OpenCustomTelegram-linux-x64"

$TarGz = "$ReleasesDir\OpenCustomTelegram-linux-x64.tar.gz"
if (Test-Path $TarGz) {
    $SizeMb = [math]::Round((Get-Item $TarGz).Length / 1MB, 2)
    Write-Host "SUCCESS! Linux release archive created at $TarGz ($SizeMb MB)" -ForegroundColor Green
} else {
    throw "Failed to create tar.gz archive."
}
