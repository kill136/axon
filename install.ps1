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

# --- Chromium Browser (required for Browser Control feature) ---
# Extensions.loadUnpacked CDP command requires Chrome/Edge/Brave 120+
$BrowserMinVersion = 120

function Get-BrowserVersion {
    param([string]$ExePath)
    try {
        $verInfo = (Get-Item $ExePath).VersionInfo
        if ($verInfo.ProductVersion) {
            return $verInfo.ProductVersion
        }
    } catch {}
    return $null
}

function Test-Browser {
    # Windows Chromium-based browser candidates (in priority order)
    $candidates = @(
        @{ Kind = "Chrome";   Paths = @(
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
        )},
        @{ Kind = "Edge";     Paths = @(
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
        )},
        @{ Kind = "Brave";    Paths = @(
            "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
            "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe"
        )},
        @{ Kind = "Chromium"; Paths = @(
            "$env:ProgramFiles\Chromium\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Chromium\Application\chrome.exe"
        )}
    )

    foreach ($browser in $candidates) {
        foreach ($p in $browser.Paths) {
            if (Test-Path $p) {
                $ver = Get-BrowserVersion $p
                if ($ver) {
                    $major = [int]($ver.Split('.')[0])
                    if ($major -ge $script:BrowserMinVersion) {
                        Write-Ok "$($browser.Kind) $ver detected (Browser Control ready)"
                        return $true
                    } else {
                        Write-Warn "$($browser.Kind) $ver detected, but Browser Control requires version >= $script:BrowserMinVersion"
                        Write-Warn "Please update your browser for Browser Control feature to work"
                        return $true  # Browser exists, just old
                    }
                } else {
                    Write-Ok "$($browser.Kind) detected at $p (version unknown, Browser Control may work)"
                    return $true
                }
            }
        }
    }

    return $false
}

function Install-Browser {
    Write-Warn "No Chromium-based browser found (Chrome/Edge/Brave/Chromium)"
    Write-Warn "Browser Control feature requires a Chromium-based browser"

    # On Windows, Edge is usually pre-installed. If it's missing, try installing Chrome via winget.
    if (Test-Winget) {
        Write-Info "Installing Google Chrome via winget..."
        winget install Google.Chrome --accept-source-agreements --accept-package-agreements --silent 2>$null
        if ($LASTEXITCODE -eq 0) {
            Refresh-Path
            if (Test-Browser) { return }
        }
        Write-Warn "winget install did not succeed."
    }

    # Fallback: direct download
    $chromeInstaller = Join-Path $env:TEMP "chrome-installer.exe"
    $chromeUrl = "https://dl.google.com/chrome/install/GoogleChromeStandaloneEnterprise64.msi"
    Write-Info "Downloading Google Chrome from $chromeUrl ..."
    try {
        Invoke-WebRequest -Uri $chromeUrl -OutFile $chromeInstaller -UseBasicParsing -TimeoutSec 120
        if (Test-Path $chromeInstaller) {
            Write-Info "Installing Google Chrome..."
            $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
            if ($isAdmin) {
                Start-Process msiexec.exe -ArgumentList "/i `"$chromeInstaller`" /quiet /norestart" -Wait -NoNewWindow
            } else {
                Write-Info "Requesting administrator privileges for Chrome installation..."
                Start-Process msiexec.exe -ArgumentList "/i `"$chromeInstaller`" /quiet /norestart" -Wait -Verb RunAs
            }
            Remove-Item $chromeInstaller -Force -ErrorAction SilentlyContinue
            Refresh-Path
            if (Test-Browser) { return }
        }
    } catch {
        Write-Warn "Chrome download failed: $_"
    }

    Write-Warn "Browser installation failed. Browser Control feature will not work."
    Write-Warn "Please install Chrome manually: https://www.google.com/chrome/"
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

    # Git for Windows version naming:
    #   GitHub release tag: v2.47.1.windows.1, file: Git-2.47.1-64-bit.exe
    #   npmmirror mirrors GitHub releases with the same structure
    # IMPORTANT: Use a version that exists on BOTH sources. Patch releases
    # (e.g. 2.47.1.2) may not be mirrored on npmmirror.
    $gitVersion = "2.47.1"
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

# --- Create launcher script (OUTSIDE git repo, never affected by git operations) ---
function New-LauncherScript {
    param([string]$InstallPath)

    Write-Info "Creating launcher script..."

    $LauncherDir = Join-Path $env:USERPROFILE ".local\bin"
    if (-not (Test-Path $LauncherDir)) { New-Item -ItemType Directory -Path $LauncherDir -Force | Out-Null }
    $LauncherPath = Join-Path $LauncherDir "claude-web-start.bat"

    # This launcher lives outside git repo, so git operations never break it
    $LauncherContent = @'
@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo.
echo   +=============================================+
echo   ^|       Claude Code Open - WebUI              ^|
echo   +=============================================+
echo.

set "INSTALL_DIR=%USERPROFILE%\.claude-code-open"

if not exist "%INSTALL_DIR%" (
    echo [ERROR] Installation directory not found: %INSTALL_DIR%
    echo         Please run the installer first.
    goto :error_exit
)
cd /d "%INSTALL_DIR%"

REM --- Determine which node.exe to use ---
REM Priority 1: portable Node.js in .node/ (always wins if present)
if exist "%INSTALL_DIR%\.node\node.exe" (
    set "NODE_EXE=%INSTALL_DIR%\.node\node.exe"
    echo [OK] Using portable Node.js
    goto :node_ready
)

REM Priority 2: system Node.js if version is compatible (v18-v22)
call :check_system_node
if defined NODE_EXE goto :node_ready

REM Priority 3: no compatible node found — download portable
echo [WARN] No compatible Node.js found, downloading portable v22 LTS...
call :install_node_portable
if !errorlevel! neq 0 goto :error_exit
set "NODE_EXE=%INSTALL_DIR%\.node\node.exe"

:node_ready
for /f "tokens=*" %%v in ('"!NODE_EXE!" -v 2^>nul') do echo [OK] Node.js %%v

REM --- Auto-update from git ---
echo.
echo [INFO] Checking for updates...
cd /d "%INSTALL_DIR%"

REM Check if it's a git repository
if exist "%INSTALL_DIR%\.git" (
    REM Discard local changes (protect .node portable directory)
    git checkout -- . 2>nul
    git clean -fd --exclude=.node 2>nul
    
    REM Pull latest code
    git pull origin private_web_ui 2>nul
    if !errorlevel! equ 0 (
        echo [OK] Code updated
        
        REM Auto-detect China network and set npm mirror
        for /f "tokens=*" %%u in ('git remote get-url origin 2^>nul') do set "GIT_ORIGIN=%%u"
        echo !GIT_ORIGIN! | findstr /i "gitee" >nul
        if !errorlevel! equ 0 (
            echo [INFO] Detected China network, setting npm registry...
            "!NODE_EXE!" "%INSTALL_DIR%\node_modules\npm\bin\npm-cli.js" config set registry https://registry.npmmirror.com 2>&1
        )
        
        REM Simple rebuild strategy: always rebuild after pull
        echo [INFO] Rebuilding dependencies...
        "!NODE_EXE!" "%INSTALL_DIR%\node_modules\npm\bin\npm-cli.js" install --legacy-peer-deps 2>&1 | findstr /v /c:"npm WARN"
        
        echo [INFO] Building backend...
        "!NODE_EXE!" "%INSTALL_DIR%\node_modules\npm\bin\npm-cli.js" run build 2>&1 | findstr /v /c:"npm WARN"
        
        echo [OK] Rebuild complete
    ) else (
        echo [WARN] Git pull failed, starting with current version...
    )
) else (
    echo [WARN] Not a git repository, skipping update
)

echo.
echo [INFO] Starting Claude Code WebUI...
echo.

REM Use node.exe directly to invoke tsx (bypass .cmd shim which may use wrong node)
"!NODE_EXE!" "%INSTALL_DIR%\node_modules\tsx\dist\cli.mjs" "%INSTALL_DIR%\src\web-cli.ts" --evolve -H 0.0.0.0

if !errorlevel! neq 0 (
    echo.
    echo [ERROR] Application exited with error code !errorlevel!
    goto :error_exit
)
goto :end

:check_system_node
set "NODE_EXE="
where node >nul 2>&1
if !errorlevel! neq 0 exit /b 0
REM Get major version: "v22.14.0" -> powershell extracts reliably
for /f "tokens=*" %%v in ('powershell -NoProfile -Command "(node -v).TrimStart('v').Split('.')[0]" 2^>nul') do set "SYS_NODE_MAJOR=%%v"
if not defined SYS_NODE_MAJOR exit /b 0
if !SYS_NODE_MAJOR! lss 18 (
    echo [WARN] System Node.js v!SYS_NODE_MAJOR! is too old, need v18-v22
    exit /b 0
)
if !SYS_NODE_MAJOR! gtr 22 (
    echo [WARN] System Node.js v!SYS_NODE_MAJOR! is too new, need v18-v22
    exit /b 0
)
REM System node is compatible — use its full path to bypass shim issues
for /f "tokens=*" %%p in ('where node') do (
    set "NODE_EXE=%%p"
    goto :found_sys_node
)
:found_sys_node
echo [OK] Using system Node.js v!SYS_NODE_MAJOR!
exit /b 0

:install_node_portable
set "NODE_VER=22.14.0"
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (set "NODE_ARCH=x64") else (set "NODE_ARCH=x86")
set "NODE_ZIP=node-v%NODE_VER%-win-%NODE_ARCH%.zip"
set "NODE_DIR=%INSTALL_DIR%\.node"
set "DL_PATH=%TEMP%\%NODE_ZIP%"

set "URL1=https://nodejs.org/dist/v%NODE_VER%/%NODE_ZIP%"
set "URL2=https://npmmirror.com/mirrors/node/v%NODE_VER%/%NODE_ZIP%"

echo [INFO] Downloading %NODE_ZIP% ...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%URL1%' -OutFile '%DL_PATH%' -UseBasicParsing -TimeoutSec 60; exit 0 } catch { try { Invoke-WebRequest -Uri '%URL2%' -OutFile '%DL_PATH%' -UseBasicParsing -TimeoutSec 60; exit 0 } catch { exit 1 } }"
if !errorlevel! neq 0 (
    echo [ERROR] Failed to download Node.js.
    exit /b 1
)

echo [INFO] Extracting...
if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%"
powershell -NoProfile -Command "Expand-Archive -Path '%DL_PATH%' -DestinationPath '%TEMP%\node-extract' -Force; $d = Get-ChildItem '%TEMP%\node-extract' -Directory | Select-Object -First 1; Move-Item $d.FullName '%NODE_DIR%' -Force; Remove-Item '%TEMP%\node-extract' -Recurse -Force -ErrorAction SilentlyContinue"
del "%DL_PATH%" >nul 2>&1

if not exist "%NODE_DIR%\node.exe" (
    echo [ERROR] Node.js extraction failed.
    exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"
echo [OK] Node.js portable installed
exit /b 0

:error_exit
echo.
echo Press any key to exit...
pause >nul
exit /b 1

:end
pause
'@
    Set-Content -Path $LauncherPath -Value $LauncherContent -Encoding ASCII
    Write-Ok "Launcher created: $LauncherPath"
    return $LauncherPath
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
            $LauncherPath = Join-Path $env:USERPROFILE ".local\bin\claude-web-start.bat"
            $Shortcut.TargetPath = $LauncherPath
            $Shortcut.Description = "Launch Claude Code Web Interface"
            $Shortcut.WorkingDirectory = "$env:USERPROFILE"
        }
        elseif ($Type -eq "docker") {
            $BatPath = Join-Path $env:USERPROFILE ".local\bin\claude-web.bat"
            $BatContent = @"
@echo off
cd /d "%USERPROFILE%"
echo Starting Claude Code WebUI...
echo Press Ctrl+C to stop the server
echo.
if defined ANTHROPIC_API_KEY (set "API_KEY_FLAG=-e ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY%") else (set "API_KEY_FLAG=")
docker run -it --rm -p 3456:3456 %API_KEY_FLAG% -v "%USERPROFILE%\.claude:/root/.claude" -v "%cd%:/workspace" $DockerImage
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
            git clean -fd --exclude=.node
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

    # Auto-detect China network and set npm mirror
    if ($script:RepoUrl -like '*gitee*') {
        Write-Info "Detected China network, setting npm registry to npmmirror..."
        npm config set registry https://registry.npmmirror.com
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
    New-LauncherScript -InstallPath $InstallDir
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
if defined ANTHROPIC_API_KEY (set "API_KEY_FLAG=-e ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY%") else (set "API_KEY_FLAG=")
docker run -it --rm ^
    %API_KEY_FLAG% ^
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

    # 5. Browser (optional, needed for Browser Control feature)
    if (-not (Test-Browser)) {
        Install-Browser
    }

    # 6. Check Docker availability (optional)
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
