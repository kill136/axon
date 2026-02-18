# ============================================
# Claude Code Open - Windows One-Click Installer
#
# Method 1 - Batch file (recommended, no policy issues):
#   Double-click install.bat, or in cmd:
#     curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.bat -o install.bat && install.bat
#
# Method 2 - PowerShell (irm pipe, bypasses execution policy):
#   irm https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.ps1 | iex
#
# Method 3 - PowerShell (explicit bypass):
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# China mirrors (Gitee):
#   curl -fsSL https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.bat -o install.bat && install.bat
#   irm https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.ps1 | iex
# ============================================

$ErrorActionPreference = "Stop"

$RepoUrlGithub = "https://github.com/kill136/claude-code-open.git"
$RepoUrlGitee  = "https://gitee.com/lubanbbs/claude-code-open.git"
$RepoUrl       = ""  # Will be set by Detect-RepoUrl
$DockerImage   = "wbj66/claude-code-open:latest"
$InstallDir    = "$env:USERPROFILE\.claude-code-open"
$NodeMajorRequired = 18
$NodeMajorMax = 22  # LTS; native modules may lack prebuilds for newer versions

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

# --- Refresh PATH from registry (pick up newly installed programs) ---
function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path    = "$machinePath;$userPath"
}

# --- Detect best repo URL (GitHub vs Gitee for China) ---
function Detect-RepoUrl {
    if ($script:RepoUrl) {
        Write-Info "Using user-specified repo: $script:RepoUrl"
        return
    }

    Write-Info "Detecting network connectivity..."
    try {
        $response = Invoke-WebRequest -Uri "https://github.com" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        $script:RepoUrl = $script:RepoUrlGithub
        Write-Ok "GitHub accessible, using GitHub source"
    } catch {
        Write-Warn "GitHub not accessible (likely in China), switching to Gitee mirror"
        $script:RepoUrl = $script:RepoUrlGitee
        Write-Ok "Using Gitee mirror: $script:RepoUrlGitee"
    }
}

# --- Check if winget is available ---
function Test-Winget {
    try {
        winget --version >$null 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# --- Check Node.js ---
function Test-Node {
    try {
        $ver = (node -v 2>$null)
        if ($ver) {
            $major = [int]($ver -replace 'v','').Split('.')[0]
            if ($major -ge $script:NodeMajorRequired -and $major -le $script:NodeMajorMax) {
                Write-Ok "Node.js $ver detected"
                return $true
            } elseif ($major -gt $script:NodeMajorMax) {
                Write-Warn "Node.js $ver detected, but version is too new (max supported: v$($script:NodeMajorMax).x LTS). Native modules may lack prebuilt binaries."
                Write-Warn "Will download Node.js v22 LTS portable version (won't affect your system Node.js)..."
            } else {
                Write-Warn "Node.js $ver found, but >= $script:NodeMajorRequired required"
            }
        }
    } catch {}
    return $false
}

# --- Auto-install Node.js ---
function Install-Node {
    # Check if a local portable Node.js already exists
    $localNodeDir = Join-Path $script:InstallDir ".node"
    $localNode = Join-Path $localNodeDir "node.exe"
    if (Test-Path $localNode) {
        $env:Path = "$localNodeDir;$env:Path"
        if (Test-Node) { return }
    }

    # Check if system has a Node.js that's too new (e.g. v24)
    # In that case, NEVER use MSI/winget — it would uninstall the existing version
    # and kill the current PowerShell process. Use portable zip instead.
    $systemNodeTooNew = $false
    try {
        $ver = (node -v 2>$null)
        if ($ver) {
            $major = [int]($ver -replace 'v','').Split('.')[0]
            if ($major -gt $script:NodeMajorMax) {
                $systemNodeTooNew = $true
            }
        }
    } catch {}

    if (-not $systemNodeTooNew) {
        Write-Warn "Node.js not found or version too low, installing..."

        # Strategy 1: winget (only when no conflicting Node.js exists)
        if (Test-Winget) {
            Write-Info "Installing Node.js v22 LTS via winget..."
            winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
            if ($LASTEXITCODE -eq 0) {
                Refresh-Path
                if (Test-Node) { return }
            }
            Write-Warn "winget install completed but node not found in PATH, trying direct download..."
        }

        # Strategy 2: Direct MSI download (only when no conflicting Node.js exists)
        $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
        $nodeVersion = "22.14.0"
        $msiFile = "node-v$nodeVersion-$arch.msi"
        $msiPath = Join-Path $env:TEMP $msiFile

        $nodeUrls = @(
            "https://nodejs.org/dist/v$nodeVersion/$msiFile",
            "https://npmmirror.com/mirrors/node/v$nodeVersion/$msiFile"
        )

        $downloaded = $false
        foreach ($url in $nodeUrls) {
            Write-Info "Downloading Node.js v$nodeVersion from $url ..."
            try {
                Invoke-WebRequest -Uri $url -OutFile $msiPath -UseBasicParsing -TimeoutSec 30
                $downloaded = $true
                break
            } catch {
                Write-Warn "Download failed from $url, trying next source..."
            }
        }

        if ($downloaded) {
            Write-Info "Installing Node.js v$nodeVersion (this may take a minute)..."
            $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
            if ($isAdmin) {
                Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -NoNewWindow
            } else {
                Write-Info "Requesting administrator privileges for Node.js installation..."
                Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -Verb RunAs
            }
            Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
            Refresh-Path
            if (Test-Node) { return }
        }
    }

    # Strategy 3: Portable zip (safe fallback, never conflicts with existing Node.js)
    # Used when: system Node is too new, or MSI/winget failed
    Write-Info "Downloading Node.js v22 LTS portable version..."
    Install-NodePortable
    if (Test-Node) { return }

    Write-Err @"
Failed to install Node.js automatically.

  Please install Node.js v22 LTS manually:
    https://nodejs.org/

  Then re-run this script.
"@
}

# --- Install Node.js as portable zip (no MSI, no conflict) ---
function Install-NodePortable {
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $nodeVersion = "22.14.0"
    $zipFile = "node-v$nodeVersion-win-$arch.zip"
    $zipPath = Join-Path $env:TEMP $zipFile

    $nodeUrls = @(
        "https://nodejs.org/dist/v$nodeVersion/$zipFile",
        "https://npmmirror.com/mirrors/node/v$nodeVersion/$zipFile"
    )

    $downloaded = $false
    foreach ($url in $nodeUrls) {
        Write-Info "Downloading $zipFile from $url ..."
        try {
            Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 120
            $downloaded = $true
            break
        } catch {
            Write-Warn "Download failed from $url, trying next source..."
        }
    }

    if (-not $downloaded) {
        Write-Warn "Failed to download Node.js portable zip."
        return
    }

    $localNodeDir = Join-Path $script:InstallDir ".node"
    if (Test-Path $localNodeDir) { Remove-Item -Recurse -Force $localNodeDir }

    Write-Info "Extracting Node.js portable to $localNodeDir ..."
    # Create parent dir if install dir doesn't exist yet
    if (-not (Test-Path $script:InstallDir)) {
        New-Item -ItemType Directory -Path $script:InstallDir -Force | Out-Null
    }
    $extractDir = Join-Path $env:TEMP "node-extract-$"
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    # Zip contains a folder like node-v22.14.0-win-x64/, move it to .node
    $innerDir = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
    Move-Item -Path $innerDir.FullName -Destination $localNodeDir -Force
    Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

    # Prepend to PATH for current session
    $env:Path = "$localNodeDir;$env:Path"
    Write-Ok "Node.js portable extracted to $localNodeDir"
}

# --- Check Python (optional, only needed if prebuilt binaries unavailable) ---
# NOTE: All native modules (node-pty, better-sqlite3, leveldown, tree-sitter)
# ship prebuilt binaries. Python/C++ are only needed as fallback for node-gyp
# compilation when prebuild download fails (unusual arch/OS or network issues).
function Test-Python {
    try {
        $ver = (python --version 2>&1)
        if ($ver -match "Python 3\.") {
            Write-Ok "Python detected ($ver)"
            return $true
        }
    } catch {}
    try {
        $ver = (python3 --version 2>&1)
        if ($ver -match "Python 3\.") {
            Write-Ok "Python3 detected ($ver)"
            return $true
        }
    } catch {}
    return $false
}

# --- Auto-install Python (optional, non-blocking) ---
function Install-Python {
    Write-Warn "Python3 not found. Attempting to install (optional, needed only if prebuilt binaries unavailable)..."

    # Strategy 1: winget
    if (Test-Winget) {
        Write-Info "Installing Python via winget..."
        winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements --silent 2>$null
        if ($LASTEXITCODE -eq 0) {
            Refresh-Path
            if (Test-Python) { return }
        }
        Write-Warn "winget install did not succeed, trying direct download..."
    }

    # Strategy 2: Direct download (try official first, then China mirror)
    $arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "" }
    $pyVersion = "3.12.8"
    $pyFile = if ($arch) { "python-$pyVersion-$arch.exe" } else { "python-$pyVersion.exe" }
    $pyPath = Join-Path $env:TEMP $pyFile

    $pyUrls = @(
        "https://www.python.org/ftp/python/$pyVersion/$pyFile",
        "https://registry.npmmirror.com/-/binary/python/$pyVersion/$pyFile"
    )

    $downloaded = $false
    foreach ($url in $pyUrls) {
        Write-Info "Downloading Python v$pyVersion from $url ..."
        try {
            Invoke-WebRequest -Uri $url -OutFile $pyPath -UseBasicParsing -TimeoutSec 60
            $downloaded = $true
            break
        } catch {
            Write-Warn "Download failed from $url, trying next source..."
        }
    }

    if ($downloaded) {
        try {
            Write-Info "Installing Python v$pyVersion (this may take a minute)..."
            Start-Process $pyPath -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0" -Wait -NoNewWindow
            Remove-Item $pyPath -Force -ErrorAction SilentlyContinue
            Refresh-Path
            if (Test-Python) { return }
        } catch {
            Write-Warn "Python installation failed: $_"
        }
    }

    Write-Warn "Python3 not available. Installation will continue (prebuilt binaries should work)."
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

# --- Auto-install Git ---
function Install-Git {
    Write-Warn "Git not found, installing..."

    # Strategy 1: winget
    if (Test-Winget) {
        Write-Info "Installing Git via winget..."
        winget install Git.Git --accept-source-agreements --accept-package-agreements --silent
        if ($LASTEXITCODE -eq 0) {
            Refresh-Path
            if (Test-Git) { return }
        }
        Write-Warn "winget install completed but git not found in PATH, trying direct download..."
    }

    # Strategy 2: Direct download (try multiple sources)
    $gitInstallerPath = Join-Path $env:TEMP "git-installer.exe"

    # Git for Windows uses different naming: Git-2.47.1.2-64-bit.exe
    # npmmirror uses: Git-2.47.1.2-64-bit.exe
    # We try npmmirror first (faster in China), then GitHub
    $gitVersion = "2.47.1.2"
    $arch = if ([Environment]::Is64BitOperatingSystem) { "64-bit" } else { "32-bit" }
    $gitFile = "Git-$gitVersion-$arch.exe"

    $gitUrls = @(
        "https://registry.npmmirror.com/-/binary/git-for-windows/v$gitVersion.windows.1/$gitFile",
        "https://github.com/git-for-windows/git/releases/download/v$gitVersion.windows.1/$gitFile"
    )

    $downloaded = $false
    foreach ($url in $gitUrls) {
        Write-Info "Downloading Git from $url ..."
        try {
            Invoke-WebRequest -Uri $url -OutFile $gitInstallerPath -UseBasicParsing -TimeoutSec 60
            $downloaded = $true
            break
        } catch {
            Write-Warn "Download failed from $url, trying next source..."
        }
    }

    if ($downloaded) {
        Write-Info "Installing Git (this may take a minute)..."
        $gitArgs = "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS=`"icons,ext\reg\shellhere,assoc,assoc_sh`""
        $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        if ($isAdmin) {
            Start-Process $gitInstallerPath -ArgumentList $gitArgs -Wait -NoNewWindow
        } else {
            Write-Info "Requesting administrator privileges for Git installation..."
            Start-Process $gitInstallerPath -ArgumentList $gitArgs -Wait -Verb RunAs
        }
        Remove-Item $gitInstallerPath -Force -ErrorAction SilentlyContinue
        Refresh-Path
        if (Test-Git) { return }
    }

    Write-Err @"
Failed to install Git automatically.

  Please install Git manually:
    https://git-scm.com/download/win

  Then re-run this script.
"@
}

# --- Create Auto-Update Startup Script ---
function New-UpdateAndStartScript {
    param([string]$InstallPath)

    Write-Info "Creating auto-update startup script..."

    $ScriptPath = Join-Path $InstallPath "update-and-start.bat"
    $ScriptContent = @"
@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo.
echo   +=============================================+
echo   ^|   Claude Code Open - Auto Update ^& Start   ^|
echo   +=============================================+
echo.

set "INSTALL_DIR=%USERPROFILE%\.claude-code-open"
cd /d "%INSTALL_DIR%"

REM --- Use portable Node.js if available ---
if exist "%INSTALL_DIR%\.node\node.exe" (
    set "PATH=%INSTALL_DIR%\.node;%PATH%"
    echo [OK] Using portable Node.js from .node\
)

REM --- Check for updates ---
set "NEED_REBUILD=0"
set "NEED_FRONTEND_REBUILD=0"

if exist ".git" (
    echo [INFO] Checking for updates...

    REM Save current commit hash
    for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "OLD_HASH=%%i"

    REM Discard local changes
    git checkout -- . >nul 2>&1
    git clean -fd >nul 2>&1

    REM Pull latest code
    git pull origin private_web_ui >nul 2>&1
    if !errorlevel! neq 0 (
        echo [WARN] Git pull failed ^(network issue?^), starting with current version...
        goto :start_app
    )

    for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "NEW_HASH=%%i"

    if "!OLD_HASH!" neq "!NEW_HASH!" (
        echo [OK] Updated: !OLD_HASH:~0,8! -^> !NEW_HASH:~0,8!

        REM Check what changed
        for /f "tokens=*" %%f in ('git diff --name-only !OLD_HASH! !NEW_HASH! 2^>nul') do (
            echo %%f | findstr /i "package.json" >nul && set "NEED_REBUILD=1"
            echo %%f | findstr /i "src\\web\\client\\" >nul && set "NEED_FRONTEND_REBUILD=1"
            echo %%f | findstr /i "\.ts$ \.tsx$" >nul && set "NEED_REBUILD=1"
        )
    ) else (
        echo [OK] Already up to date
    )
) else (
    echo [WARN] Not a git repository, skipping update
)

REM --- Incremental rebuild if needed ---
if "!NEED_REBUILD!" == "1" (
    echo [INFO] Source code changed, rebuilding...

    echo [INFO] Installing dependencies...
    call npm install >nul 2>&1

    if "!NEED_FRONTEND_REBUILD!" == "1" (
        echo [INFO] Frontend changed, rebuilding...
        cd /d "%INSTALL_DIR%\src\web\client"
        call npm install >nul 2>&1
        call npm run build >nul 2>&1
        cd /d "%INSTALL_DIR%"
    )

    echo [INFO] Building backend...
    call npm run build >nul 2>&1

    REM Re-link in case bin entries changed
    call npm link >nul 2>&1

    echo [OK] Rebuild complete!
)

:start_app
echo.
echo [INFO] Starting Claude Code WebUI...
echo.

REM --- Start the application ---
cd /d "%INSTALL_DIR%"
node_modules\.bin\tsx.cmd src\web-cli.ts --evolve -H 0.0.0.0

pause
"@
    Set-Content -Path $ScriptPath -Value $ScriptContent -Encoding ASCII
    Write-Ok "Auto-update startup script created: $ScriptPath"
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
            # npm installation: shortcut points to auto-update script
            $UpdateScript = Join-Path $InstallPath "update-and-start.bat"

            $Shortcut.TargetPath = $UpdateScript
            $Shortcut.Description = "Launch Claude Code Web Interface (Auto-Update)"
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

    # Link globally using npm's default prefix
    # On Windows, Node.js MSI sets default prefix to %APPDATA%\npm and adds it to PATH
    # We use the default prefix to avoid PATH issues; if custom prefix is needed, we handle it
    Write-Info "Linking globally..."
    npm link
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "npm link failed, trying with --force..."
        npm link --force
    }

    # Determine where npm placed the global .cmd files
    # On Windows, npm global bin = prefix root (not prefix/bin)
    $NpmGlobalDir = (npm config get prefix 2>$null)
    if ($NpmGlobalDir) {
        $NpmGlobalDir = $NpmGlobalDir.Trim()
        # Ensure this directory is in user PATH
        $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
        $AllPath = "$MachinePath;$UserPath"
        if ($AllPath -notlike "*$NpmGlobalDir*") {
            [Environment]::SetEnvironmentVariable("Path", "$NpmGlobalDir;$UserPath", "User")
            $env:Path = "$NpmGlobalDir;$env:Path"
            Write-Ok "Added $NpmGlobalDir to user PATH."
        }
    }

    Pop-Location

    # Create auto-update startup script and desktop shortcut
    New-UpdateAndStartScript -InstallPath $InstallDir
    New-DesktopShortcut -Type "npm" -InstallPath $InstallDir

    Write-Ok "Installation complete via npm!"
    Write-Host ""
    Write-Host "  IMPORTANT: Please open a NEW terminal window for PATH changes to take effect!" -ForegroundColor Yellow
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

    Write-Info "Checking & installing dependencies..."
    Write-Host ""

    # 1. Git (needed for source install) - auto-install if missing
    if (-not (Test-Git)) {
        Install-Git
    }

    # 2. Detect best repo source (GitHub vs Gitee for China)
    Detect-RepoUrl

    # 3. Node.js - auto-install if missing
    if (-not (Test-Node)) {
        Install-Node
    }

    # 4. Python (optional, only needed if prebuilt binaries unavailable)
    if (-not (Test-Python)) {
        Install-Python
    }

    # 5. Check Docker availability (optional)
    $hasDocker = Test-Docker

    Write-Host ""

    # --- Install ---
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

Main @args
