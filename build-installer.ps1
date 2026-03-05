# Axon Windows Installer Build Script
# Builds a standard Windows installer (.exe) from source.
#
# Prerequisites:
#   - Node.js installed
#   - npm dependencies installed (npm install)
#   - Project built (npm run build)
#   - Frontend built (cd src/web/client && npm run build)
#   - Inno Setup 6 installed (https://jrsoftware.org/isdl.php)
#
# Usage:
#   .\build-installer.ps1
#
# Output:
#   release\Axon-Setup-<version>.exe

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Axon Windows Installer Build" -ForegroundColor Cyan
Write-Host "  =============================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# Step 1: Check Inno Setup
# ============================================================
Write-Host "[1/4] Checking Inno Setup..." -ForegroundColor Yellow

$isccPaths = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "D:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "D:\Program Files\Inno Setup 6\ISCC.exe"
)

$iscc = $null
foreach ($p in $isccPaths) {
    if (Test-Path $p) {
        $iscc = $p
        break
    }
}

# Also check PATH
if (-not $iscc) {
    $isccCmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($isccCmd) {
        $iscc = $isccCmd.Source
    }
}

if (-not $iscc) {
    Write-Host "  ERROR: Inno Setup 6 not found." -ForegroundColor Red
    Write-Host "  Download from: https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
    Write-Host "  After install, re-run this script." -ForegroundColor Yellow
    exit 1
}
Write-Host "  Found: $iscc" -ForegroundColor Gray

# ============================================================
# Step 2: Generate icon.ico from icon.png
# ============================================================
Write-Host "[2/4] Generating icon.ico..." -ForegroundColor Yellow

$iconPng = Join-Path $PWD "electron\icon.png"
$iconIco = Join-Path $PWD "electron\icon.ico"

if (-not (Test-Path $iconPng)) {
    Write-Host "  ERROR: electron\icon.png not found" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $iconIco)) {
    # Use PowerShell + .NET to convert PNG to ICO
    # This creates a basic ICO with 256x256, 48x48, 32x32, 16x16 sizes
    Add-Type -AssemblyName System.Drawing

    $pngImage = [System.Drawing.Image]::FromFile($iconPng)

    # Create ICO file with multiple sizes
    $sizes = @(256, 48, 32, 16)
    $icoStream = [System.IO.File]::Create($iconIco)
    $writer = New-Object System.IO.BinaryWriter($icoStream)

    # ICO header
    $writer.Write([Int16]0)         # Reserved
    $writer.Write([Int16]1)         # Type: ICO
    $writer.Write([Int16]$sizes.Count) # Number of images

    # We'll write each image as a PNG-in-ICO (modern ICO format)
    $imageDataList = @()
    foreach ($size in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap($pngImage, $size, $size)
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $imageDataList += ,($ms.ToArray())
        $ms.Dispose()
        $bmp.Dispose()
    }

    # ICO directory entries (16 bytes each)
    $offset = 6 + ($sizes.Count * 16) # Header(6) + entries
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $size = $sizes[$i]
        $data = $imageDataList[$i]
        $w = if ($size -eq 256) { 0 } else { $size }
        $h = if ($size -eq 256) { 0 } else { $size }
        $writer.Write([Byte]$w)     # Width (0 = 256)
        $writer.Write([Byte]$h)     # Height (0 = 256)
        $writer.Write([Byte]0)      # Color palette
        $writer.Write([Byte]0)      # Reserved
        $writer.Write([Int16]1)     # Color planes
        $writer.Write([Int16]32)    # Bits per pixel
        $writer.Write([Int32]$data.Length) # Image data size
        $writer.Write([Int32]$offset)     # Offset to image data
        $offset += $data.Length
    }

    # Image data
    foreach ($data in $imageDataList) {
        $writer.Write($data)
    }

    $writer.Close()
    $icoStream.Close()
    $pngImage.Dispose()

    Write-Host "  Generated icon.ico ($($sizes -join ', ') px)" -ForegroundColor Gray
} else {
    Write-Host "  icon.ico already exists, skipping" -ForegroundColor Gray
}

# ============================================================
# Step 3: Build portable version
# ============================================================
Write-Host "[3/4] Building portable version..." -ForegroundColor Yellow

$portableScript = Join-Path $PWD "build-portable.ps1"
if (-not (Test-Path $portableScript)) {
    Write-Host "  ERROR: build-portable.ps1 not found" -ForegroundColor Red
    exit 1
}

# Run portable build
# Note: robocopy inside build-portable.ps1 returns 1-7 for success,
# which PowerShell treats as non-zero. We check the output dir instead.
& $portableScript

$portableDir = Join-Path $PWD "release\axon-portable"
if (-not (Test-Path $portableDir)) {
    Write-Host "  ERROR: release\axon-portable not found after build" -ForegroundColor Red
    exit 1
}

# ============================================================
# Step 4: Run Inno Setup compiler
# ============================================================
Write-Host "[4/4] Compiling installer with Inno Setup..." -ForegroundColor Yellow

$issFile = Join-Path $PWD "installer\axon-setup.iss"
if (-not (Test-Path $issFile)) {
    Write-Host "  ERROR: installer\axon-setup.iss not found" -ForegroundColor Red
    exit 1
}

& $iscc $issFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Inno Setup compilation failed" -ForegroundColor Red
    exit 1
}

# ============================================================
# Done
# ============================================================
$setupExe = Get-ChildItem (Join-Path $PWD "release") -Filter "Axon-Setup-*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

Write-Host ""
Write-Host "  =============================" -ForegroundColor Green
Write-Host "  INSTALLER BUILD SUCCESS" -ForegroundColor Green
Write-Host "  =============================" -ForegroundColor Green
Write-Host ""
if ($setupExe) {
    $sizeMB = "{0:N1} MB" -f ($setupExe.Length / 1MB)
    Write-Host "  Installer : $($setupExe.FullName)" -ForegroundColor White
    Write-Host "  Size      : $sizeMB" -ForegroundColor White
} else {
    Write-Host "  Check release\ directory for the installer" -ForegroundColor White
}
Write-Host ""
