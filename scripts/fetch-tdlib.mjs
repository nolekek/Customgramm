import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const TD_VERSION = "v1.8.29";

const targetDir = path.resolve(process.cwd(), "bin");
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

async function fetchTdlib() {
  const platform = os.platform();
  const arch = os.arch();

  console.log(`[TDLib Fetcher] Detected platform: ${platform} (${arch})`);

  let archiveName = "";
  let binaryName = "";

  if (platform === "win32") {
    archiveName = "tdlib.native.windows.x86-64.zip";
    binaryName = "tdjson.dll";
  } else if (platform === "linux") {
    archiveName = "tdlib.native.ubuntu-22.04.x86-64.zip";
    binaryName = "libtdjson.so";
  } else if (platform === "darwin") {
    archiveName = "tdlib.native.macos.x86-64.zip";
    binaryName = "libtdjson.dylib";
  } else {
    console.error(`[TDLib Fetcher] Unsupported platform: ${platform}`);
    process.exit(1);
  }

  const finalBinaryPath = path.join(targetDir, binaryName);
  if (fs.existsSync(finalBinaryPath)) {
    console.log(`[TDLib Fetcher] TDLib already exists at: ${finalBinaryPath}`);
    return;
  }

  const url = `https://github.com/ForNeVeR/tdlib.native/releases/download/${TD_VERSION}/${archiveName}`;
  console.log(`[TDLib Fetcher] Downloading from: ${url}...`);

  const tempZip = path.join(targetDir, "tdlib_download.zip");
  const tempExtractDir = path.join(targetDir, "temp_extracted");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download TDLib from ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(tempZip, Buffer.from(arrayBuffer));
  console.log(`[TDLib Fetcher] Downloaded ${(arrayBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB. Extracting...`);

  if (!fs.existsSync(tempExtractDir)) {
    fs.mkdirSync(tempExtractDir, { recursive: true });
  }

  // Use tar to extract
  try {
    execSync(`tar -xf "${tempZip}" -C "${tempExtractDir}"`, { stdio: "inherit" });
  } catch (err) {
    console.error("[TDLib Fetcher] tar extraction failed, trying PowerShell Expand-Archive...", err);
    execSync(`powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${tempExtractDir}' -Force"`, { stdio: "inherit" });
  }

  // Find all .dll / .so / .dylib files recursively in tempExtractDir and move to targetDir
  function copyBinaries(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        copyBinaries(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === ".dll" || ext === ".so" || ext === ".dylib") {
          const dest = path.join(targetDir, entry.name);
          fs.copyFileSync(fullPath, dest);
          console.log(`[TDLib Fetcher] Copied binary: ${entry.name} -> ${dest}`);
        }
      }
    }
  }

  copyBinaries(tempExtractDir);

  // Cleanup
  fs.rmSync(tempZip, { force: true });
  fs.rmSync(tempExtractDir, { recursive: true, force: true });

  console.log(`[TDLib Fetcher] Successfully set up TDLib binaries in ${targetDir}`);
}

fetchTdlib().catch((err) => {
  console.error("[TDLib Fetcher] Error:", err);
  process.exit(1);
});
