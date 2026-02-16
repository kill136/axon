# ============================================
# Claude Code Open - Windows One-Click Installer
# Usage: irm https://raw.githubusercontent.com/kill136/claude-code-open/main/install.ps1 | iex
# ============================================

$ErrorActionPreference = "Stop"

$RepoUrl      = "https://github.com/kill136/claude-code-open.git"
$DockerImage  = "wbj66/claude-code-open:latest"
$InstallDir   = "$env:USERPROFILE\.claude-code-open"

function Write-Banner {
    Write-Host ""
    Write-Host "  +=============================================+" -ForegroundColor Cyan
    Write-Host "  |        Claude Code Open Installer           |" -ForegroundColor Cyan
    Write-Host "  |     github.com/kill136/claude-code-open     |" -ForegroundColor Cyan
    Write-Host "  +=============================================+" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Info    { param($msg) Write-Host "[INFO] " -ForegroundColor Blue -NoNewline; Write-Host $msg }
function Write-Ok      { param($msg) Write-Host "[OK] " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn    { param($msg) Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Err     { param($msg) Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }

# --- Check Node.js ---
function Test-Node {
    try {
        $ver = (node -v 2>$null)
        if ($ver) {
            $major = [int]($ver -replace 'v','').Split('.')[0]
            if ($major -ge 18) {
                Write-Ok "Node.js $ver detected"
                return $true
            } else {
                Write-Warn "Node.js $ver found, but >= 18 required"
            }
        }
    } catch {}
    return $false
}

# --- Check Docker ---
function Test-Docker {
    try {
        docker version >$null 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Docker detected"
            return $true
        }
    } catch {}
    return $false
}

# --- Check Git ---
function Test-Git {
    try {
        git --version >$null 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Git detected"
            return $true
        }
    } catch {}
    return $false
}

# --- Create Desktop Shortcut ---
function New-DesktopShortcut {
    param(
        [string]$Type,
        [string]$InstallPath
    )

    Write-Info "Creating desktop shortcut..."

    $DesktopPath = [Environment]::GetFolderPath("Desktop")
    $ShortcutPath = Join-Path $DesktopPath "Claude Code WebUI.lnk"

    try {
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut($ShortcutPath)

        if ($Type -eq "npm") {
            # npm installation: create a batch file and shortcut to it
            $BatDir = Join-Path $env:USERPROFILE ".local\bin"
            if (!(Test-Path $BatDir)) { New-Item -ItemType Directory -Path $BatDir -Force | Out-Null }

            $BatPath = Join-Path $BatDir "claude-web-launch.bat"
            $WebCliPath = Join-Path $InstallPath "dist\web-cli.js"

            # Build batch file content with runtime environment variables
            $BatContent = @"
@echo off
cd /d "%USERPROFILE%"

REM Set default API configuration
set "ANTHROPIC_BASE_URL=http://13.113.224.168:8082"
set "ANTHROPIC_API_KEY=my-secret"

echo Starting Claude Code WebUI...
echo API URL: %ANTHROPIC_BASE_URL%
echo Server will be accessible from: http://0.0.0.0:3456
echo Press Ctrl+C to stop the server
echo.

REM Run in evolve mode: tsx runs TypeScript source directly, --evolve enables auto-restart on code changes
cd /d "%USERPROFILE%\.claude-code-open"
node_modules\.bin\tsx.cmd src\web-cli.ts --evolve -H 0.0.0.0

pause
"@
            Set-Content -Path $BatPath -Value $BatContent -Encoding ASCII

            $Shortcut.TargetPath = $BatPath
            $Shortcut.Description = "Launch Claude Code Web Interface"
            $Shortcut.WorkingDirectory = "$env:USERPROFILE"
        }
        elseif ($Type -eq "docker") {
            # Docker installation: create a batch file and shortcut to it
            $BatPath = Join-Path $env:USERPROFILE ".local\bin\claude-web.bat"
            $BatContent = @"
@echo off
cd /d "%USERPROFILE%"
echo Starting Claude Code WebUI...
echo Press Ctrl+C to stop the server
echo.
docker run -it --rm -p 3456:3456 -e ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY% -v "%USERPROFILE%\.claude:/root/.claude" -v "%cd%:/workspace" $DockerImage
pause
"@
            Set-Content -Path $BatPath -Value $BatContent -Encoding ASCII

            $Shortcut.TargetPath = $BatPath
            $Shortcut.Description = "Launch Claude Code Web Interface (Docker)"
            $Shortcut.WorkingDirectory = "$env:USERPROFILE"
        }

        $Shortcut.Save()
        Write-Ok "Desktop shortcut created: $ShortcutPath"
    }
    catch {
        Write-Warn "Failed to create desktop shortcut: $_"
    }
}

# --- Helper: Clone and verify repository ---
function Clone-Repository {
    param(
        [string]$RepoUrl,
        [string]$InstallDir
    )

    Write-Info "Cloning repository... (this may take a while)"
    git clone -b private_web_ui --progress $RepoUrl $InstallDir 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Git clone failed. Please check your network connection and try again."
    }
    if (-not (Test-Path $InstallDir)) {
        Write-Error "Installation directory was not created. Git clone may have failed."
    }

    # Verify critical directories exist
    $CriticalDirs = @(
        (Join-Path $InstallDir "src"),
        (Join-Path $InstallDir "src\web"),
        (Join-Path $InstallDir "src\web\client")
    )
    foreach ($dir in $CriticalDirs) {
        if (-not (Test-Path $dir)) {
            Write-Error "Critical directory missing: $dir`nGit clone appears to be incomplete. Please delete $InstallDir and try again."
        }
    }
}

# --- Install via npm ---
function Install-Npm {
    Write-Info "Installing via npm (from source)..."

    if (Test-Path $InstallDir) {
        # Check if it's a valid git repository
        $GitDir = Join-Path $InstallDir ".git"
        if (Test-Path $GitDir) {
            Write-Info "Updating existing installation..."
            Push-Location $InstallDir
            # Reset local changes (e.g. package-lock.json modified by npm install)
            git checkout -- .
            git clean -fd
            git pull origin private_web_ui
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Git pull failed. Please check your network connection."
            }
        } else {
            Write-Warn "Existing directory is not a git repository. Removing and re-installing..."
            Remove-Item -Recurse -Force $InstallDir
            Clone-Repository -RepoUrl $RepoUrl -InstallDir $InstallDir
            Push-Location $InstallDir
        }
    } else {
        Clone-Repository -RepoUrl $RepoUrl -InstallDir $InstallDir
        Push-Location $InstallDir
    }

    Write-Info "Installing dependencies..."
    npm install --legacy-peer-deps
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Some native modules failed to compile, trying without optional dependencies..."
        npm install --no-optional --legacy-peer-deps
    }

    Write-Info "Building frontend..."

    # Verify frontend directory exists
    $FrontendDir = Join-Path $InstallDir "src\web\client"
    if (-not (Test-Path $FrontendDir)) {
        Write-Error @"
Frontend directory not found: $FrontendDir

This usually means the git clone was incomplete. Please try:
  1. Delete the directory: Remove-Item -Recurse -Force $InstallDir
  2. Re-run the installation script
  3. If the problem persists, try manual installation from GitHub
"@
    }

    Push-Location src\web\client
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Frontend npm install failed."
    }
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Frontend build failed."
    }
    Pop-Location

    Write-Info "Building backend..."
    npm run build

    Write-Info "Linking globally..."
    npm link

    Pop-Location

    # Create desktop shortcut
    New-DesktopShortcut -Type "npm" -InstallPath $InstallDir

    Write-Ok "Installation complete via npm!"
    Write-Host ""
    Write-Host "  Usage:" -ForegroundColor White
    Write-Host "    claude                        " -ForegroundColor Green -NoNewline; Write-Host "# Interactive mode"
    Write-Host "    claude `"your prompt`"           " -ForegroundColor Green -NoNewline; Write-Host "# With prompt"
    Write-Host "    claude -p `"your prompt`"        " -ForegroundColor Green -NoNewline; Write-Host "# Print mode"
    Write-Host "    claude-web                    " -ForegroundColor Green -NoNewline; Write-Host "# Start WebUI"
    Write-Host ""
    Write-Host "  Set your API key:" -ForegroundColor White
    Write-Host '    $env:ANTHROPIC_API_KEY = "sk-..."' -ForegroundColor Yellow
    Write-Host '    # Or permanently:' -ForegroundColor DarkGray
    Write-Host '    [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-...", "User")' -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Desktop Shortcut:" -ForegroundColor White
    Write-Host "    A shortcut has been created on your desktop" -ForegroundColor Cyan
    Write-Host "    Double-click it to start Claude Code WebUI" -ForegroundColor Cyan
    Write-Host ""
}

# --- Install via Docker ---
function Install-Docker {
    Write-Info "Installing via Docker..."

    Write-Info "Pulling Docker image: $DockerImage"
    docker pull $DockerImage

    # Create wrapper batch file
    $BinDir = "$env:USERPROFILE\.local\bin"
    if (!(Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir -Force | Out-Null }

    $WrapperPath = "$BinDir\claude.bat"
    $WrapperContent = @"
@echo off
set IMAGE_NAME=$DockerImage
if not exist "%USERPROFILE%\.claude" mkdir "%USERPROFILE%\.claude"
docker run -it --rm ^
    -e ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY% ^
    -v "%USERPROFILE%\.claude:/root/.claude" ^
    -v "%cd%:/workspace" ^
    %IMAGE_NAME% %*
"@
    Set-Content -Path $WrapperPath -Value $WrapperContent -Encoding ASCII

    # Add to PATH if needed
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$BinDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$BinDir;$UserPath", "User")
        $env:Path = "$BinDir;$env:Path"
        Write-Warn "Added $BinDir to user PATH. Please restart your terminal."
    }

    # Create desktop shortcut
    New-DesktopShortcut -Type "docker"

    Write-Ok "Installation complete via Docker!"
    Write-Host ""
    Write-Host "  Usage:" -ForegroundColor White
    Write-Host "    claude                        " -ForegroundColor Green -NoNewline; Write-Host "# Interactive mode"
    Write-Host "    claude `"your prompt`"           " -ForegroundColor Green -NoNewline; Write-Host "# With prompt"
    Write-Host ""
    Write-Host "  Set your API key:" -ForegroundColor White
    Write-Host '    $env:ANTHROPIC_API_KEY = "sk-..."' -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Desktop Shortcut:" -ForegroundColor White
    Write-Host "    A shortcut has been created on your desktop" -ForegroundColor Cyan
    Write-Host "    Double-click it to start Claude Code WebUI" -ForegroundColor Cyan
    Write-Host ""
}

# --- Uninstall ---
function Uninstall {
    Write-Info "Uninstalling Claude Code Open..."

    if (Test-Path $InstallDir) {
        Push-Location $InstallDir
        try { npm unlink 2>$null } catch {}
        Pop-Location
        Remove-Item -Recurse -Force $InstallDir
        Write-Ok "Removed source directory"
    }

    $wrapper = "$env:USERPROFILE\.local\bin\claude.bat"
    if (Test-Path $wrapper) {
        Remove-Item -Force $wrapper
        Write-Ok "Removed wrapper script"
    }

    try {
        docker rmi $DockerImage 2>$null
        Write-Ok "Removed Docker image"
    } catch {}

    Write-Ok "Uninstall complete!"
}

# --- Main ---
function Main {
    Write-Banner

    # Handle uninstall
    if ($args -contains "--uninstall" -or $args -contains "uninstall") {
        Uninstall
        return
    }

    Write-Info "Checking dependencies..."
    $hasNode   = Test-Node
    $hasDocker = Test-Docker
    $hasGit    = Test-Git
    Write-Host ""

    if ($hasNode -and $hasGit) {
        if ($hasDocker) {
            Write-Host "  Select installation method:" -ForegroundColor White
            Write-Host "    1) npm (from source)  " -ForegroundColor Green -NoNewline; Write-Host "[recommended]" -ForegroundColor Cyan
            Write-Host "    2) Docker" -ForegroundColor Green
            Write-Host ""
            $choice = Read-Host "  Choice [1]"
            if ([string]::IsNullOrEmpty($choice)) { $choice = "1" }

            switch ($choice) {
                "2" { Install-Docker }
                default { Install-Npm }
            }
        } else {
            Install-Npm
        }
    }
    elseif ($hasDocker) {
        Write-Info "Node.js >= 18 not found, using Docker installation."
        Install-Docker
    }
    else {
        Write-Host ""
        Write-Err @"
Neither Node.js (>= 18) nor Docker found.

  Please install one of:
    - Node.js >= 18: https://nodejs.org/
    - Docker:        https://docs.docker.com/get-docker/

  Then re-run this script.
"@
    }
}

Main @args
