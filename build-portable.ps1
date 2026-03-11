# Axon Electron Portable Packaging Script
# Architecture: Electron shell + embedded standard Node.js + project code
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Axon Electron Portable Packaging Script" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# Step 0: Check prerequisites
# ============================================================
Write-Host "[0/9] Checking prerequisites..." -ForegroundColor Yellow

if (-not (Test-Path "node_modules\electron\dist")) {
    Write-Host "  ERROR: node_modules\electron\dist not found. Run: npm install" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "dist\web-cli.js")) {
    Write-Host "  ERROR: dist\web-cli.js not found. Run: npm run build" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "src\web\client\dist")) {
    Write-Host "  ERROR: src\web\client\dist not found. Run: cd src\web\client && npm run build" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "electron\main.cjs")) {
    Write-Host "  ERROR: electron\main.cjs not found" -ForegroundColor Red
    exit 1
}

$nodeExePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExePath) {
    Write-Host "  ERROR: Node.js not found in PATH" -ForegroundColor Red
    exit 1
}
$nodeVersion = node -v
Write-Host "  Node.js: $nodeVersion ($nodeExePath)" -ForegroundColor Gray
Write-Host "  All prerequisites OK" -ForegroundColor Green
Write-Host ""

$releaseDir = Join-Path $PWD "release\axon-portable"
$appDir = Join-Path $releaseDir "resources\app"

# ============================================================
# Step 1: Clean and create directories
# ============================================================
Write-Host "[1/9] Creating release directory..." -ForegroundColor Yellow
if (Test-Path $releaseDir) {
    Remove-Item -Recurse -Force $releaseDir
}
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

# ============================================================
# Step 2: Copy Electron runtime
# ============================================================
Write-Host "[2/9] Copying Electron runtime..." -ForegroundColor Yellow
$electronSrc = Join-Path $PWD "node_modules\electron\dist"
Copy-Item -Recurse -Force (Join-Path $electronSrc "*") $releaseDir

# ============================================================
# Step 3: Embed Node.js
# ============================================================
Write-Host "[3/9] Embedding Node.js $nodeVersion..." -ForegroundColor Yellow
$nodeDir = Join-Path $releaseDir "node"
New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
Copy-Item -Force $nodeExePath (Join-Path $nodeDir "node.exe")

# ============================================================
# Step 4: Copy package.json
# ============================================================
Write-Host "[4/9] Copying package.json..." -ForegroundColor Yellow
Copy-Item -Force "electron\package.json" (Join-Path $appDir "package.json")

# ============================================================
# Step 5: Copy electron scripts
# ============================================================
Write-Host "[5/9] Copying electron scripts..." -ForegroundColor Yellow
$electronAppDir = Join-Path $appDir "electron"
New-Item -ItemType Directory -Path $electronAppDir -Force | Out-Null
Copy-Item -Force "electron\main.cjs" $electronAppDir
Copy-Item -Force "electron\preload.cjs" $electronAppDir
if (Test-Path "electron\icon.png") {
    Copy-Item -Force "electron\icon.png" $electronAppDir
}

# ============================================================
# Step 6: Copy compiled backend + frontend
# ============================================================
Write-Host "[6/9] Copying application files..." -ForegroundColor Yellow

# Backend compiled output
Copy-Item -Recurse -Force "dist" $appDir

# Frontend build (preserve directory structure: src/web/client/dist)
$clientDir = Join-Path $appDir "src\web\client"
New-Item -ItemType Directory -Path $clientDir -Force | Out-Null
Copy-Item -Recurse -Force "src\web\client\dist" $clientDir

# AXON.md default template (ensures iron rules are active out-of-the-box)
# Generate from template instead of copying project-specific AXON.md
$axonMdDst = Join-Path $appDir "AXON.md"
node -e "import('./dist/rules/index.js').then(m => process.stdout.write(m.createClaudeMdTemplate()))" > $axonMdDst 2>$null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $axonMdDst) -or (Get-Item $axonMdDst).Length -eq 0) {
    # Fallback: copy project AXON.md if template generation fails
    if (Test-Path "AXON.md") {
        Copy-Item -Force "AXON.md" $axonMdDst
    }
}
Write-Host "  Generated default AXON.md template" -ForegroundColor Gray

# .env file — generate a safe template without secrets
# NEVER copy the real .env (contains OAuth secrets, bot tokens, etc.)
$envTemplate = @"
# Axon Configuration
# Fill in your own credentials if needed

# GitHub OAuth App (optional, for GitHub integration)
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=

# Google OAuth (optional)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Feishu/Lark (optional)
# FEISHU_APP_ID=
# FEISHU_APP_SECRET=

# Slack (optional)
# SLACK_BOT_TOKEN=
"@
$envTemplate | Out-File -Encoding utf8 (Join-Path $appDir ".env.example")
Write-Host "  Created .env.example template (secrets excluded)" -ForegroundColor Gray

# Vendored ripgrep binary (required for Grep tool)
$rgVersion = "14.1.0"
$rgArch = "x86_64"
$rgVendorDir = Join-Path $appDir "vendor\ripgrep\x64-win32"
$rgExePath = Join-Path $rgVendorDir "rg.exe"

if (-not (Test-Path $rgExePath)) {
    Write-Host "  Downloading ripgrep $rgVersion..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path $rgVendorDir -Force | Out-Null

    $rgZipName = "ripgrep-$rgVersion-$rgArch-pc-windows-msvc.zip"
    $rgDownloadUrl = "https://github.com/BurntSushi/ripgrep/releases/download/$rgVersion/$rgZipName"
    $rgTmpZip = Join-Path $env:TEMP $rgZipName

    try {
        Invoke-WebRequest -Uri $rgDownloadUrl -OutFile $rgTmpZip -UseBasicParsing
        $rgTmpDir = Join-Path $env:TEMP "rg-extract-$rgVersion"
        Expand-Archive -Path $rgTmpZip -DestinationPath $rgTmpDir -Force
        # rg.exe is inside a subdirectory named like ripgrep-14.1.0-x86_64-pc-windows-msvc/
        $rgBin = Get-ChildItem -Path $rgTmpDir -Recurse -Filter "rg.exe" | Select-Object -First 1
        if ($rgBin) {
            Copy-Item -Force $rgBin.FullName $rgExePath
            Write-Host "  ripgrep $rgVersion installed to vendor/" -ForegroundColor Gray
        } else {
            Write-Host "  WARNING: rg.exe not found in archive" -ForegroundColor Yellow
        }
        Remove-Item -Recurse -Force $rgTmpDir -ErrorAction SilentlyContinue
        Remove-Item -Force $rgTmpZip -ErrorAction SilentlyContinue
    } catch {
        Write-Host "  WARNING: Failed to download ripgrep: $_" -ForegroundColor Yellow
        Write-Host "  Grep tool will require system ripgrep (rg) in PATH" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ripgrep already vendored" -ForegroundColor Gray
}

# ============================================================
# Step 7: Copy node_modules (slowest step)
# ============================================================
Write-Host "[7/9] Copying node_modules (this is slow, please wait)..." -ForegroundColor Yellow

$nmSrc = Join-Path $PWD "node_modules"
$nmDst = Join-Path $appDir "node_modules"

# Use robocopy for speed, exclude electron dist to save space
$xdElectron = Join-Path $nmSrc "electron\dist"
$xdCache = Join-Path $nmSrc ".cache"

robocopy $nmSrc $nmDst /E /NFL /NDL /NJH /NJS /NC /NS /NP /XD $xdElectron $xdCache

if ($LASTEXITCODE -le 7) {
    Write-Host "  node_modules copied successfully" -ForegroundColor Gray
} else {
    Write-Host "  robocopy issue ($LASTEXITCODE), trying Copy-Item..." -ForegroundColor Yellow
    Copy-Item -Recurse -Force "node_modules" $appDir
}

# ============================================================
# Step 8: Trim node_modules to reduce size
# ============================================================
Write-Host "[8/9] Trimming node_modules..." -ForegroundColor Yellow

$trimmedSize = 0

# Remove devDependencies' test/doc/example directories
$junkDirs = @("test", "tests", "__tests__", "example", "examples", "docs", "doc", ".github", "benchmark", "benchmarks", "coverage", ".nyc_output")
foreach ($dir in $junkDirs) {
    $found = Get-ChildItem -Path $nmDst -Directory -Recurse -Filter $dir -ErrorAction SilentlyContinue
    foreach ($d in $found) {
        $s = (Get-ChildItem -Recurse $d.FullName -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $trimmedSize += $s
        Remove-Item -Recurse -Force $d.FullName -ErrorAction SilentlyContinue
    }
}

# Remove unnecessary file types
$junkExtensions = @("*.md", "*.markdown", "*.ts", "*.map", "*.d.ts.map", "*.coffee", "*.litcoffee", "*.log", "*.txt", "CHANGELOG*", "HISTORY*", "CHANGES*", "AUTHORS*", "CONTRIBUTORS*")
foreach ($ext in $junkExtensions) {
    $found = Get-ChildItem -Path $nmDst -Recurse -Filter $ext -File -ErrorAction SilentlyContinue
    foreach ($f in $found) {
        # Don't delete .d.ts files (needed at runtime for some packages) or README that might be license
        $name = $f.Name
        if ($name -match "\.d\.ts$" -and $name -notmatch "\.d\.ts\.map$") { continue }
        if ($name -eq "LICENSE" -or $name -eq "LICENSE.md") { continue }
        $trimmedSize += $f.Length
        Remove-Item -Force $f.FullName -ErrorAction SilentlyContinue
    }
}

# Remove dev-only packages (not needed at runtime)
$devOnlyPkgs = @(
    "@types",
    "typescript",
    "electron",
    "electron-builder",
    "electron-winstaller",
    "app-builder-bin",
    "app-builder-lib",
    "dmg-builder",
    "7zip-bin",
    "@yao-pkg",
    "vitest",
    "vite",
    "vite-node",
    "@vitejs",
    "@vitest",
    "tsx",
    "esbuild",
    "@esbuild",
    "jsdom",
    "ink-testing-library",
    "postject",
    "@rollup",
    "rollup",
    "@anthropic-ai\claude-code",
    "highlight.js",
    "react-dom",
    "@babel",
    "nock",
    "acorn",
    "source-map-support",
    "builder-util",
    "builder-util-runtime",
    "config-file-ts",
    "isbinaryfile"
)
foreach ($pkg in $devOnlyPkgs) {
    $pkgDir = Join-Path $nmDst $pkg
    if (Test-Path $pkgDir) {
        $s = (Get-ChildItem -Recurse $pkgDir -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $trimmedSize += $s
        Remove-Item -Recurse -Force $pkgDir -ErrorAction SilentlyContinue
        Write-Host "  Removed $pkg/" -ForegroundColor Gray
    }
}

# Remove .vite cache directories
Get-ChildItem -Path $nmDst -Directory -Recurse -Filter ".vite-*" -ErrorAction SilentlyContinue | ForEach-Object {
    $s = (Get-ChildItem -Recurse $_.FullName -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $trimmedSize += $s
    Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
    Write-Host "  Removed $($_.Name)" -ForegroundColor Gray
}

# Remove native addon build artifacts (obj, Release/obj, build/Release except .node files)
Get-ChildItem -Path $nmDst -Recurse -Filter "*.obj" -File -ErrorAction SilentlyContinue | ForEach-Object {
    $trimmedSize += $_.Length
    Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue
}
Get-ChildItem -Path $nmDst -Recurse -Filter "*.pdb" -File -ErrorAction SilentlyContinue | ForEach-Object {
    $trimmedSize += $_.Length
    Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue
}

# Remove prebuilds for non-Windows platforms
Get-ChildItem -Path $nmDst -Recurse -Directory -Filter "prebuilds" -ErrorAction SilentlyContinue | ForEach-Object {
    Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -match "^(linux|darwin|android)" 
    } | ForEach-Object {
        $s = (Get-ChildItem -Recurse $_.FullName -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $trimmedSize += $s
        Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
    }
}

# Clean up monaco-editor: only keep min vs full (saves ~35MB)
$monacoMin = Join-Path $nmDst "monaco-editor\min"
$monacoFull = Join-Path $nmDst "monaco-editor\dev"
if (Test-Path $monacoFull) {
    $s = (Get-ChildItem -Recurse $monacoFull -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $trimmedSize += $s
    Remove-Item -Recurse -Force $monacoFull -ErrorAction SilentlyContinue
    Write-Host "  Removed monaco-editor/dev" -ForegroundColor Gray
}
$monacoEsm = Join-Path $nmDst "monaco-editor\esm"
if (Test-Path $monacoEsm) {
    $s = (Get-ChildItem -Recurse $monacoEsm -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $trimmedSize += $s
    Remove-Item -Recurse -Force $monacoEsm -ErrorAction SilentlyContinue
    Write-Host "  Removed monaco-editor/esm" -ForegroundColor Gray
}

$trimmedMB = "{0:N0} MB" -f ($trimmedSize / 1MB)
Write-Host "  Freed $trimmedMB" -ForegroundColor Gray

# ============================================================
# Step 9: Rename and finalize
# ============================================================
Write-Host "[9/9] Finalizing..." -ForegroundColor Yellow

$electronExe = Join-Path $releaseDir "electron.exe"
if (Test-Path $electronExe) {
    Rename-Item $electronExe "Axon.exe"
    Write-Host "  Renamed electron.exe -> Axon.exe" -ForegroundColor Gray
}

# Calculate total size
$size = (Get-ChildItem -Recurse $releaseDir | Measure-Object -Property Length -Sum).Sum / 1MB
$sizeStr = "{0:N0} MB" -f $size

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "  BUILD SUCCESS" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Location : $releaseDir" -ForegroundColor White
Write-Host "  Size     : $sizeStr" -ForegroundColor White
Write-Host "  Node.js  : $nodeVersion (embedded)" -ForegroundColor White
Write-Host ""
$axonExe = Join-Path $releaseDir "Axon.exe"
Write-Host "  Run: $axonExe" -ForegroundColor Cyan
Write-Host ""

exit 0
