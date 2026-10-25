# Packaging script for OpenCustom Telegram (Android arm64)
$ErrorActionPreference = "Stop"

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " Packaging OpenCustom Telegram for Android (arm64)" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$RootDir = (Get-Item "$PSScriptRoot\..").FullName
Set-Location $RootDir

# 0. Setup Java and Android environment
$JavaHome = "C:\Users\Admin\scoop\apps\openjdk17\current"
if (Test-Path $JavaHome) {
    $env:JAVA_HOME = $JavaHome
    $env:Path = "$JavaHome\bin;$env:Path"
}
$AndroidHome = "C:\Users\Admin\AppData\Local\Android\Sdk"
if (Test-Path $AndroidHome) {
    $env:ANDROID_HOME = $AndroidHome
    $env:NDK_HOME = "$AndroidHome\ndk\26.1.10909125"
    $ndkBin = "$env:NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin"
    if (Test-Path $ndkBin) {
        $env:Path = "$ndkBin;$env:Path"
        $env:CC_aarch64_linux_android = "$ndkBin\aarch64-linux-android34-clang.cmd"
        $env:CXX_aarch64_linux_android = "$ndkBin\aarch64-linux-android34-clang++.cmd"
        $env:AR_aarch64_linux_android = "$ndkBin\llvm-ar.exe"
        $env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = "$ndkBin\aarch64-linux-android34-clang.cmd"
    }
}

# 1. Build frontend (Vite)
Write-Host "[1/4] Building web frontend (Vite)..." -ForegroundColor Yellow
npm run build

# 2. Build Rust native library for aarch64
Write-Host "[2/4] Building Rust shared library for aarch64-linux-android..." -ForegroundColor Yellow
cargo build --target aarch64-linux-android --release

# Copy native library to jniLibs
$JniDir = "$RootDir\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a"
if (-not (Test-Path $JniDir)) {
    New-Item -ItemType Directory -Force -Path $JniDir | Out-Null
}
Copy-Item "$RootDir\target\aarch64-linux-android\release\libapp_lib.so" -Destination "$JniDir\libapp_lib.so" -Force

# 3. Assemble Release APK via Gradle
Write-Host "[3/4] Assembling Release APK via Gradle..." -ForegroundColor Yellow
Set-Location "$RootDir\src-tauri\gen\android"
cmd /c "gradlew.bat assembleArm64Release"
Set-Location $RootDir

$UnsignedApk = "$RootDir\src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release-unsigned.apk"
if (-not (Test-Path $UnsignedApk)) {
    throw "Gradle build failed: $UnsignedApk does not exist."
}

# 4. Sign APK
Write-Host "[4/4] Signing release APK with apksigner..." -ForegroundColor Yellow
$Keystore = "$RootDir\.data\release.keystore"
if (-not (Test-Path $Keystore)) {
    & "$JavaHome\bin\keytool.exe" -genkey -v -keystore $Keystore -alias opencustom -keyalg RSA -keysize 2048 -validity 10000 -storepass opencustom -keypass opencustom -dname "CN=OpenCustom, OU=Telegram, O=OpenCustom, L=City, S=State, C=US"
}

$ReleasesDir = "$RootDir\releases"
if (-not (Test-Path $ReleasesDir)) {
    New-Item -ItemType Directory -Force -Path $ReleasesDir | Out-Null
}
$SignedApk = "$ReleasesDir\OpenCustomTelegram-android-arm64.apk"
$ApkSigner = "$AndroidHome\build-tools\34.0.0\apksigner.bat"
cmd /c "$ApkSigner sign --ks $Keystore --ks-pass pass:opencustom --out $SignedApk $UnsignedApk"
cmd /c "$ApkSigner verify -v $SignedApk"

$SizeMb = [math]::Round((Get-Item $SignedApk).Length / 1MB, 2)
Write-Host "SUCCESS! Android arm64 release APK created at $SignedApk ($SizeMb MB)" -ForegroundColor Green
