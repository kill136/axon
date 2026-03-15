# ============================================
# Axon - Windows One-Click Uninstaller
#
# Method 1 - PowerShell (irm pipe):
#   irm https://raw.githubusercontent.com/kill136/axon/private_web_ui/uninstall.ps1 | iex
#
# Method 2 - Batch file:
#   uninstall.bat
#
# China mirrors (Gitee):
#   irm https://gitee.com/lubanbbs/axon/raw/private_web_ui/uninstall.ps1 | iex
# ============================================

$ErrorActionPreference = "Continue"

$DockerImage = "wbj66/axon:latest"
$InstallDir  = if ($env:AXON_CONFIG_DIR) { $env:AXON_CONFIG_DIR } else { "$env:USERPROFILE\.axon" }

function Write-Info  { param($msg) Write-Host "[INFO] " -ForegroundColor Blue  -NoNewline; Write-Host $msg }
function Write-Ok    { param($msg) Write-Host "[OK] "   -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn  { param($msg) Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $msg }

Write-Host ""
Write-Host "  +=============================================+" -ForegroundColor Cyan
Write-Host "  |           Axon Uninstaller                  |" -ForegroundColor Cyan
Write-Host "  +=============================================+" -ForegroundColor Cyan
Write-Host ""

Write-Info "Uninstalling Axon from: $InstallDir"
Write-Host ""

# --- Remove source directory (runs npm unlink first) ---
if (Test-Path $InstallDir) {
    $packageJson = Join-Path $InstallDir "package.json"
    if (Test-Path $packageJson) {
        Write-Info "Running npm unlink..."
        Push-Location $InstallDir
        try { npm.cmd unlink 2>$null } catch {}
        Pop-Location
    }
    Remove-Item -Recurse -Force $InstallDir
    Write-Ok "Removed installation directory: $InstallDir"
} else {
    Write-Warn "Installation directory not found: $InstallDir (already removed?)"
}

# --- Remove CLI wrapper scripts ---
$binDir = "$env:USERPROFILE\.local\bin"
foreach ($file in @("claude.bat", "claude-web-start.bat", "claude-web.bat")) {
    $path = Join-Path $binDir $file
    if (Test-Path $path) {
        Remove-Item -Force $path
        Write-Ok "Removed $path"
    }
}

# --- Remove desktop shortcut ---
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Axon WebUI.lnk"
if (Test-Path $shortcutPath) {
    Remove-Item -Force $shortcutPath
    Write-Ok "Removed desktop shortcut: $shortcutPath"
}

# --- Remove PATH entry from user environment ---
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -like "*$binDir*") {
    $newPath = ($userPath -split ';' | Where-Object { $_ -ne $binDir -and $_ -ne "" }) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Ok "Removed $binDir from user PATH"
}

# Also check for npm global dir that may have been added
$npmGlobalDir = try { (npm.cmd config get prefix 2>$null).Trim() } catch { "" }
if ($npmGlobalDir -and $userPath -like "*$npmGlobalDir*") {
    $newPath = ($userPath -split ';' | Where-Object { $_ -ne $npmGlobalDir -and $_ -ne "" }) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Ok "Removed npm global dir from user PATH: $npmGlobalDir"
}

# --- Remove AXON_CONFIG_DIR from user environment ---
$axonConfigDir = [Environment]::GetEnvironmentVariable("AXON_CONFIG_DIR", "User")
if ($axonConfigDir) {
    [Environment]::SetEnvironmentVariable("AXON_CONFIG_DIR", $null, "User")
    Write-Ok "Removed AXON_CONFIG_DIR from user environment variables"
}

# --- Remove Docker image (optional) ---
try {
    $dockerAvailable = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
    if ($dockerAvailable) {
        $imageExists = docker image inspect $DockerImage 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Removing Docker image: $DockerImage"
            docker rmi $DockerImage 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "Removed Docker image: $DockerImage"
            } else {
                Write-Warn "Could not remove Docker image (may be in use)"
            }
        }
    }
} catch {}

Write-Host ""
Write-Ok "Axon has been fully uninstalled!"
Write-Host ""
Write-Host "  Note: Open a new terminal for PATH changes to take effect." -ForegroundColor Yellow
Write-Host ""
