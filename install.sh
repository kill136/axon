#!/bin/bash
# ============================================
# Claude Code Open - One-Click Install Script
# GitHub:  curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.sh | bash
# China:   curl -fsSL https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.sh | bash
# ============================================
set -e

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

REPO_URL_GITHUB="https://github.com/kill136/claude-code-open.git"
REPO_URL_GITEE="https://gitee.com/lubanbbs/claude-code-open.git"
REPO_URL=""  # Will be set by detect_repo_url()
DOCKER_IMAGE="wbj66/claude-code-open:latest"
INSTALL_DIR="$HOME/.claude-code-open"
NODE_MAJOR_REQUIRED=18
NODE_MAJOR_MAX=22  # LTS; native modules may lack prebuilds for newer versions
NODE_HEAP_MB=3072  # Node.js max heap size for npm install (prevents OOM on low-memory devices)
MIN_TOTAL_MB=2048  # Minimum required memory (RAM + swap); auto-creates swap if below

print_banner() {
    echo -e "${CYAN}"
    echo '  ╔═══════════════════════════════════════════╗'
    echo '  ║        Claude Code Open Installer         ║'
    echo '  ║     github.com/kill136/claude-code-open   ║'
    echo '  ╚═══════════════════════════════════════════╝'
    echo -e "${NC}"
}

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# --- Detect OS & Architecture ---
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    case "$OS" in
        Linux*)  PLATFORM="linux" ;;
        Darwin*) PLATFORM="macos" ;;
        *)       error "Unsupported OS: $OS. Use Windows install.ps1 instead." ;;
    esac
    info "Platform: $PLATFORM ($ARCH)"
}

# --- Detect best repo URL (GitHub vs Gitee for China) ---
detect_repo_url() {
    # If user explicitly set REPO_URL env var, respect it
    if [ -n "$REPO_URL" ]; then
        info "Using user-specified repo: $REPO_URL"
        return
    fi

    info "Detecting network connectivity..."

    # Check if curl is available (might not be on minimal systems)
    if ! command -v curl &> /dev/null; then
        warn "curl not found, defaulting to Gitee mirror (safer for China users)"
        REPO_URL="$REPO_URL_GITEE"
        return
    fi

    # Try GitHub with a short timeout (3 seconds)
    if curl -fsSL --connect-timeout 3 --max-time 5 "https://github.com" -o /dev/null 2>/dev/null; then
        REPO_URL="$REPO_URL_GITHUB"
        success "GitHub accessible, using GitHub source"
    else
        warn "GitHub not accessible (likely in China), switching to Gitee mirror"
        REPO_URL="$REPO_URL_GITEE"
        success "Using Gitee mirror: $REPO_URL_GITEE"
    fi
}

# --- Detect Linux package manager ---
detect_pkg_manager() {
    if [ "$PLATFORM" != "linux" ]; then
        PKG_MGR=""
        return
    fi
    if command -v dnf &> /dev/null; then
        PKG_MGR="dnf"
    elif command -v yum &> /dev/null; then
        PKG_MGR="yum"
    elif command -v apt-get &> /dev/null; then
        PKG_MGR="apt"
    elif command -v pacman &> /dev/null; then
        PKG_MGR="pacman"
    elif command -v apk &> /dev/null; then
        PKG_MGR="apk"
    else
        PKG_MGR=""
    fi
}

# --- Generic package install helper ---
pkg_install() {
    local packages="$*"
    case "$PKG_MGR" in
        dnf)    sudo dnf install -y $packages ;;
        yum)    sudo yum install -y $packages ;;
        apt)    sudo apt-get update -qq && sudo apt-get install -y $packages ;;
        pacman) sudo pacman -S --noconfirm $packages ;;
        apk)    sudo apk add $packages ;;
        *)      return 1 ;;
    esac
}

# ============================================
# Dependency checks & auto-install
# ============================================

# --- Git ---
ensure_git() {
    if command -v git &> /dev/null; then
        success "Git detected"
        return
    fi

    warn "Git not found, installing..."
    if [ "$PLATFORM" = "linux" ]; then
        pkg_install git || error "Failed to install git. Run: sudo $PKG_MGR install git"
    elif [ "$PLATFORM" = "macos" ]; then
        # xcode-select installs git
        xcode-select --install 2>/dev/null || true
        until command -v git &>/dev/null; do sleep 3; done
    fi
    success "Git installed"
}

# --- C++ Build Tools ---
# NOTE: C++ build tools and Python are only needed as fallback.
# All native modules (node-pty, better-sqlite3, leveldown, tree-sitter)
# ship prebuilt binaries. node-gyp compilation only triggers if prebuild
# download fails (unusual arch/OS, or network issues).

ensure_build_tools() {
    local need_install=false
    if ! command -v g++ &> /dev/null && ! command -v c++ &> /dev/null && ! command -v clang++ &> /dev/null; then
        need_install=true
    fi
    if ! command -v make &> /dev/null; then
        need_install=true
    fi

    if [ "$need_install" = false ]; then
        success "C++ build tools detected"
        return
    fi

    warn "C++ build tools not found, attempting to install (optional, needed only if prebuilt binaries unavailable)..."
    if [ "$PLATFORM" = "linux" ]; then
        case "$PKG_MGR" in
            dnf)    pkg_install gcc-c++ make || true ;;
            yum)    pkg_install gcc-c++ make || true ;;
            apt)    pkg_install build-essential || true ;;
            pacman) pkg_install base-devel || true ;;
            apk)    pkg_install build-base python3 || true ;;
            *)      warn "Cannot auto-install build tools. If npm install fails, install g++ and make manually." ;;
        esac
    elif [ "$PLATFORM" = "macos" ]; then
        xcode-select --install 2>/dev/null || true
        # Don't block waiting - xcode-select may already be installed
        sleep 2
    fi

    if command -v g++ &> /dev/null || command -v c++ &> /dev/null || command -v clang++ &> /dev/null; then
        success "C++ build tools installed"
    else
        warn "C++ build tools not available. Installation will continue (prebuilt binaries should work)."
    fi
}

# --- Python (optional, needed by node-gyp as fallback) ---
ensure_python() {
    if command -v python3 &> /dev/null; then
        success "Python3 detected ($(python3 --version 2>&1))"
        return
    fi
    if command -v python &> /dev/null; then
        local pyver
        pyver=$(python --version 2>&1)
        if echo "$pyver" | grep -q "Python 3"; then
            success "Python detected ($pyver)"
            return
        fi
    fi

    warn "Python3 not found. Attempting to install (optional, needed only if prebuilt binaries unavailable)..."
    if [ "$PLATFORM" = "linux" ]; then
        case "$PKG_MGR" in
            dnf)    pkg_install python3 || true ;;
            yum)    pkg_install python3 || true ;;
            apt)    pkg_install python3 || true ;;
            pacman) pkg_install python || true ;;
            apk)    pkg_install python3 || true ;;
            *)      warn "Cannot auto-install Python3." ;;
        esac
    elif [ "$PLATFORM" = "macos" ]; then
        if command -v brew &> /dev/null; then
            brew install python@3 || true
        fi
        # macOS usually has python3 via Xcode CLT
    fi

    if command -v python3 &> /dev/null || command -v python &> /dev/null; then
        success "Python3 installed"
    else
        warn "Python3 not available. Installation will continue (prebuilt binaries should work)."
    fi
}

# --- Memory check & swap creation (prevents OOM during npm install) ---
ensure_memory_for_npm() {
    if [ "$PLATFORM" = "macos" ]; then
        # macOS manages swap automatically, skip
        success "macOS: swap managed by system"
        return
    fi

    if ! command -v free &>/dev/null; then
        warn "Cannot detect memory (free command not found), skipping swap check"
        return
    fi

    local total_ram_mb total_swap_mb total_mb
    total_ram_mb=$(free -m | awk '/^Mem:/{print $2}')
    total_swap_mb=$(free -m | awk '/^Swap:/{print $2}')
    total_mb=$((total_ram_mb + total_swap_mb))
    info "Memory: ${total_ram_mb}MB RAM + ${total_swap_mb}MB swap = ${total_mb}MB total"

    if [ "$total_mb" -ge "$MIN_TOTAL_MB" ]; then
        success "Memory sufficient for npm install"
        return
    fi

    local swap_needed_mb=$((MIN_TOTAL_MB - total_mb + 512))
    warn "Total memory (${total_mb}MB) < ${MIN_TOTAL_MB}MB, creating ${swap_needed_mb}MB swap..."

    if [ -f /swapfile ] && swapon --show | grep -q /swapfile; then
        warn "/swapfile already active, skipping"
        return
    fi

    if [ "$(id -u)" -eq 0 ] || sudo -n true 2>/dev/null; then
        sudo swapoff /swapfile 2>/dev/null || true
        sudo rm -f /swapfile
        if sudo fallocate -l "${swap_needed_mb}M" /swapfile 2>/dev/null || \
           sudo dd if=/dev/zero of=/swapfile bs=1M count="$swap_needed_mb" status=progress; then
            sudo chmod 600 /swapfile
            sudo mkswap /swapfile
            sudo swapon /swapfile
            success "Created and enabled ${swap_needed_mb}MB swap"
        else
            warn "Failed to create swap. npm install may fail on low-memory devices."
        fi
    else
        warn "No sudo access, cannot create swap. npm install may fail on low-memory devices."
        warn "Fix: sudo fallocate -l ${swap_needed_mb}M /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
    fi
}

# --- Node.js ---
ensure_node() {
    if command -v node &> /dev/null; then
        local ver
        ver=$(node -v | sed 's/v//')
        local major
        major=$(echo "$ver" | cut -d. -f1)
        if [ "$major" -ge "$NODE_MAJOR_REQUIRED" ] && [ "$major" -le "$NODE_MAJOR_MAX" ]; then
            success "Node.js v$ver detected"
            return
        elif [ "$major" -gt "$NODE_MAJOR_MAX" ]; then
            warn "Node.js v$ver is too new (max supported: v${NODE_MAJOR_MAX}.x LTS). Native modules may lack prebuilt binaries."
            warn "Will install Node.js v22 LTS..."
        else
            warn "Node.js v$ver found, but >= $NODE_MAJOR_REQUIRED required. Upgrading..."
        fi
    else
        warn "Node.js not found, installing..."
    fi

    if [ "$PLATFORM" = "linux" ]; then
        install_node_linux
    elif [ "$PLATFORM" = "macos" ]; then
        install_node_macos
    fi

    # Reload PATH
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        export NVM_DIR="$HOME/.nvm"
        . "$NVM_DIR/nvm.sh"
    fi
    export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
    hash -r  # Refresh command cache

    # Verify
    if command -v node &> /dev/null; then
        success "Node.js $(node -v) installed"
    else
        error "Node.js installation failed. Please install Node.js >= $NODE_MAJOR_REQUIRED manually: https://nodejs.org/"
    fi
}

install_node_linux() {
    # Strategy 1: NodeSource repo (works on dnf/yum/apt)
    if [ "$PKG_MGR" = "apt" ]; then
        info "Installing Node.js via NodeSource (apt)..."
        if ! command -v curl &> /dev/null; then
            pkg_install curl ca-certificates
        fi
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
        return
    fi

    if [ "$PKG_MGR" = "dnf" ] || [ "$PKG_MGR" = "yum" ]; then
        info "Installing Node.js via NodeSource (rpm)..."
        if ! command -v curl &> /dev/null; then
            pkg_install curl
        fi
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
        sudo $PKG_MGR install -y nodejs
        return
    fi

    if [ "$PKG_MGR" = "pacman" ]; then
        info "Installing Node.js via pacman..."
        pkg_install nodejs npm
        return
    fi

    if [ "$PKG_MGR" = "apk" ]; then
        info "Installing Node.js via apk..."
        pkg_install nodejs npm
        return
    fi

    # Fallback: nvm
    install_node_via_nvm
}

install_node_macos() {
    # Strategy 1: Homebrew
    if command -v brew &> /dev/null; then
        info "Installing Node.js via Homebrew..."
        brew install node@22
        brew link --overwrite node@22
        return
    fi

    # Strategy 2: Official installer via pkg
    info "Installing Node.js via official installer..."
    local node_pkg="node-v22.14.0-darwin-${ARCH}.tar.gz"
    if [ "$ARCH" = "arm64" ]; then
        node_pkg="node-v22.14.0-darwin-arm64.tar.gz"
    else
        node_pkg="node-v22.14.0-darwin-x64.tar.gz"
    fi

    local tmp_dir
    tmp_dir=$(mktemp -d)
    curl -fsSL "https://nodejs.org/dist/v22.14.0/$node_pkg" -o "$tmp_dir/$node_pkg"
    tar xzf "$tmp_dir/$node_pkg" -C "$tmp_dir"
    local extracted
    extracted=$(ls -d "$tmp_dir"/node-v22.* | head -1)
    sudo cp -r "$extracted"/* /usr/local/
    rm -rf "$tmp_dir"
}

install_node_via_nvm() {
    info "Installing Node.js via nvm (fallback)..."
    if ! command -v curl &> /dev/null; then
        pkg_install curl || error "curl is required but cannot be installed"
    fi
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    # shellcheck source=/dev/null
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    nvm install 22
    nvm use 22
}

# ============================================
# Desktop shortcuts
# ============================================

create_update_and_start_script() {
    info "Creating auto-update startup script..."

    cat > "$INSTALL_DIR/update-and-start.sh" << 'STARTER_EOF'
#!/bin/bash
# ============================================
# Claude Code Open - Auto-Update & Start
# This script pulls latest code before starting
# ============================================
# Note: no "set -e" here — update failures should not prevent startup

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="$HOME/.claude-code-open"

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }

echo -e "${CYAN}"
echo '  ╔═══════════════════════════════════════════╗'
echo '  ║   Claude Code Open - Auto Update & Start  ║'
echo '  ╚═══════════════════════════════════════════╝'
echo -e "${NC}"

cd "$INSTALL_DIR"

# --- Auto-update from git ---
NEED_REBUILD=false
NEED_FRONTEND_REBUILD=false

if [ -d ".git" ]; then
    info "Checking for updates..."

    # Save current commit hash
    OLD_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

    # Discard local changes (protect .node portable directory)
    git checkout -- . 2>/dev/null || true
    git clean -fd --exclude=.node 2>/dev/null || true

    # Pull latest code
    if git pull origin private_web_ui 2>/dev/null; then
        NEW_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

        if [ "$OLD_HASH" != "$NEW_HASH" ]; then
            success "Updated: ${OLD_HASH:0:8} -> ${NEW_HASH:0:8}"

            # Check what changed to decide rebuild scope
            CHANGED_FILES=$(git diff --name-only "$OLD_HASH" "$NEW_HASH" 2>/dev/null || echo "")

            # Check if package.json changed (need npm install)
            if echo "$CHANGED_FILES" | grep -q "package.json"; then
                NEED_REBUILD=true
            fi

            # Check if frontend files changed
            if echo "$CHANGED_FILES" | grep -q "src/web/client/"; then
                NEED_FRONTEND_REBUILD=true
            fi

            # Check if any TypeScript source changed (need tsc build)
            if echo "$CHANGED_FILES" | grep -q "\.ts$\|\.tsx$"; then
                NEED_REBUILD=true
            fi
        else
            success "Already up to date"
        fi
    else
        warn "Git pull failed (network issue?), starting with current version..."
    fi
else
    warn "Not a git repository, skipping update"
fi

# --- Incremental rebuild if needed ---
if [ "$NEED_REBUILD" = true ]; then
    info "Source code changed, rebuilding..."

    # Auto-detect China network and set npm mirror
    if git remote get-url origin 2>/dev/null | grep -qi 'gitee'; then
        npm config set registry https://registry.npmmirror.com
    fi

    # Check if package.json changed
    if echo "$CHANGED_FILES" | grep -qE "^package\.json$|^package-lock\.json$"; then
        info "Dependencies changed, running npm install..."
        NODE_OPTIONS="--max-old-space-size=3072" npm install 2>&1 | tail -5 || {
            echo "[WARN] npm install failed, retrying without optional..."
            NODE_OPTIONS="--max-old-space-size=3072" npm install --no-optional 2>&1 | tail -5
        }
    fi

    # Rebuild frontend if needed
    if [ "$NEED_FRONTEND_REBUILD" = true ]; then
        info "Frontend changed, rebuilding..."
        pushd src/web/client > /dev/null || { warn "Frontend dir not found, skipping..."; NEED_FRONTEND_REBUILD=false; }
        if [ "$NEED_FRONTEND_REBUILD" = true ]; then
            npm install 2>&1 | tail -3
            npm run build 2>&1 | tail -3
            popd > /dev/null
        fi
    fi

    # Rebuild backend
    info "Building backend..."
    npm run build 2>&1 | tail -5

    # Re-link in case bin entries changed
    npm link 2>/dev/null || true

    success "Rebuild complete!"
fi

echo ""
info "Starting Claude Code WebUI..."
echo ""

# --- Start the application ---
export PATH="$HOME/.local/bin:$PATH"
exec claude-web --evolve -H 0.0.0.0 "$@"
STARTER_EOF

    chmod +x "$INSTALL_DIR/update-and-start.sh"
    success "Auto-update startup script created"
}

create_desktop_shortcut_npm() {
    info "Creating desktop shortcut..."

    if [ "$PLATFORM" = "linux" ]; then
        DESKTOP_DIR="$HOME/Desktop"
        if [ ! -d "$DESKTOP_DIR" ]; then
            DESKTOP_DIR="$HOME/桌面"
        fi

        if [ -d "$DESKTOP_DIR" ]; then
            DESKTOP_FILE="$DESKTOP_DIR/claude-code-webui.desktop"
            cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Claude Code WebUI
Comment=Launch Claude Code Web Interface (Auto-Update)
Exec=bash -c '$INSTALL_DIR/update-and-start.sh'
Icon=utilities-terminal
Terminal=true
Categories=Development;Utility;
EOF
            chmod +x "$DESKTOP_FILE"
            success "Desktop shortcut created: $DESKTOP_FILE"
        else
            warn "Desktop directory not found, skipping shortcut creation"
        fi

    elif [ "$PLATFORM" = "macos" ]; then
        DESKTOP_DIR="$HOME/Desktop"
        if [ -d "$DESKTOP_DIR" ]; then
            SHORTCUT_FILE="$DESKTOP_DIR/Claude Code WebUI.command"
            cat > "$SHORTCUT_FILE" << EOF
#!/bin/bash
"$HOME/.claude-code-open/update-and-start.sh" &
APP_PID=\$!
# Wait for server to start and open browser
sleep 3
open http://localhost:3456 2>/dev/null || true
# Bring app to foreground
wait \$APP_PID
EOF
            chmod +x "$SHORTCUT_FILE"
            success "Desktop shortcut created: $SHORTCUT_FILE"
        else
            warn "Desktop directory not found, skipping shortcut creation"
        fi
    fi
}

create_desktop_shortcut_docker() {
    info "Creating desktop shortcut..."

    if [ "$PLATFORM" = "linux" ]; then
        DESKTOP_DIR="$HOME/Desktop"
        if [ ! -d "$DESKTOP_DIR" ]; then
            DESKTOP_DIR="$HOME/桌面"
        fi

        if [ -d "$DESKTOP_DIR" ]; then
            DESKTOP_FILE="$DESKTOP_DIR/claude-code-webui.desktop"
            cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Claude Code WebUI
Comment=Launch Claude Code Web Interface
Exec=bash -c 'cd ~; docker run -it --rm -p 3456:3456 \${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="\$ANTHROPIC_API_KEY"} -v "\$HOME/.claude:/root/.claude" -v "\$(pwd):/workspace" $DOCKER_IMAGE'
Icon=utilities-terminal
Terminal=true
Categories=Development;Utility;
EOF
            chmod +x "$DESKTOP_FILE"
            success "Desktop shortcut created: $DESKTOP_FILE"
        else
            warn "Desktop directory not found, skipping shortcut creation"
        fi

    elif [ "$PLATFORM" = "macos" ]; then
        DESKTOP_DIR="$HOME/Desktop"
        if [ -d "$DESKTOP_DIR" ]; then
            SHORTCUT_FILE="$DESKTOP_DIR/Claude Code WebUI.command"
            cat > "$SHORTCUT_FILE" << EOF
#!/bin/bash
cd ~
echo "Starting Claude Code WebUI..."
echo "Press Ctrl+C to stop the server"
echo ""
# Start server in background and open browser
docker run -it --rm -p 3456:3456 \${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="\$ANTHROPIC_API_KEY"} -v "\$HOME/.claude:/root/.claude" -v "\$(pwd):/workspace" $DOCKER_IMAGE &
DOCKER_PID=\$!
# Wait for server to start and open browser
sleep 3
open http://localhost:3456 2>/dev/null || true
# Bring docker to foreground
wait \$DOCKER_PID
EOF
            chmod +x "$SHORTCUT_FILE"
            success "Desktop shortcut created: $SHORTCUT_FILE"
        else
            warn "Desktop directory not found, skipping shortcut creation"
        fi
    fi
}

# ============================================
# Install methods
# ============================================

install_npm() {
    info "Installing via npm (from source)..."

    # Clone or update repo
    if [ -d "$INSTALL_DIR" ]; then
        if [ -d "$INSTALL_DIR/.git" ]; then
            info "Updating existing installation..."
            cd "$INSTALL_DIR"
            git checkout -- .
            git clean -fd --exclude=.node
            git pull origin private_web_ui
            if [ $? -ne 0 ]; then
                error "Git pull failed. Please check your network connection."
            fi
        else
            warn "Existing directory is not a git repository. Removing and re-installing..."
            rm -rf "$INSTALL_DIR"
            info "Cloning repository..."
            git clone -b private_web_ui "$REPO_URL" "$INSTALL_DIR"
            if [ $? -ne 0 ]; then
                error "Git clone failed. Please check your network connection and try again."
            fi
            cd "$INSTALL_DIR"
        fi
    else
        info "Cloning repository..."
        git clone -b private_web_ui "$REPO_URL" "$INSTALL_DIR"
        if [ $? -ne 0 ]; then
            error "Git clone failed. Please check your network connection and try again."
        fi
        cd "$INSTALL_DIR"
    fi

    # Ensure enough memory for npm install (prevent OOM on low-memory devices)
    ensure_memory_for_npm

    # Auto-detect China network and set npm mirror
    if echo "$REPO_URL" | grep -qi 'gitee'; then
        info "Detected China network, setting npm registry to npmmirror..."
        npm config set registry https://registry.npmmirror.com
    fi

    # Install dependencies
    info "Installing dependencies..."
    NODE_OPTIONS="--max-old-space-size=$NODE_HEAP_MB" npm install || {
        warn "npm install failed, retrying without optional dependencies..."
        NODE_OPTIONS="--max-old-space-size=$NODE_HEAP_MB" npm install --no-optional
    }

    # Build frontend
    info "Building frontend..."
    pushd src/web/client > /dev/null || error "Frontend directory not found"
    npm install || error "Frontend npm install failed"
    npm run build || error "Frontend build failed"
    popd > /dev/null

    # Build backend
    info "Building backend..."
    npm run build

    # Configure npm to use user-level global directory
    info "Configuring npm for user-level installation..."
    NPM_PREFIX="$HOME/.local"
    mkdir -p "$NPM_PREFIX/bin"
    npm config set prefix "$NPM_PREFIX"

    # Remove old installation files if they exist
    if [ -f "$NPM_PREFIX/bin/claude" ] || [ -L "$NPM_PREFIX/bin/claude" ]; then
        warn "Removing existing 'claude' command..."
        rm -f "$NPM_PREFIX/bin/claude"
    fi
    if [ -f "$NPM_PREFIX/bin/claude-web" ] || [ -L "$NPM_PREFIX/bin/claude-web" ]; then
        warn "Removing existing 'claude-web' command..."
        rm -f "$NPM_PREFIX/bin/claude-web"
    fi

    # Global link
    info "Linking globally..."
    npm link

    # Ensure ~/.local/bin is in PATH
    ensure_path_in_shellrc "$HOME/.local/bin"

    # Create auto-update startup script and desktop shortcut
    create_update_and_start_script
    create_desktop_shortcut_npm

    success "Installation complete!"
    echo ""
    echo -e "  ${BOLD}Usage:${NC}"

    if command -v claude &> /dev/null; then
        echo -e "    ${GREEN}claude${NC}                        # Interactive mode"
        echo -e "    ${GREEN}claude \"your prompt\"${NC}           # With prompt"
        echo -e "    ${GREEN}claude -p \"your prompt\"${NC}        # Print mode"
        echo -e "    ${GREEN}claude-web${NC}                    # Start WebUI"
    else
        echo -e "    ${YELLOW}source ~/.bashrc${NC}             # Reload shell config first"
        echo -e "    ${YELLOW}# or open a new terminal${NC}"
        echo -e "    ${GREEN}claude${NC}                        # Then: Interactive mode"
        echo -e "    ${GREEN}claude \"your prompt\"${NC}           # With prompt"
        echo -e "    ${GREEN}claude -p \"your prompt\"${NC}        # Print mode"
        echo -e "    ${GREEN}claude-web${NC}                    # Start WebUI"
    fi

    echo ""
    echo -e "  ${BOLD}Set your API key:${NC}"
    echo -e "    ${YELLOW}export ANTHROPIC_API_KEY=sk-...${NC}"
    echo ""
    echo -e "  ${BOLD}Desktop Shortcut:${NC}"
    echo -e "    A shortcut has been created on your desktop"
    echo -e "    Click it to start Claude Code WebUI"
    echo ""
}

install_docker() {
    info "Installing via Docker..."

    info "Pulling Docker image: $DOCKER_IMAGE"
    docker pull "$DOCKER_IMAGE"

    WRAPPER_DIR="$HOME/.local/bin"
    mkdir -p "$WRAPPER_DIR"
    WRAPPER="$WRAPPER_DIR/claude"

    cat > "$WRAPPER" << 'WRAPPER_EOF'
#!/bin/bash
IMAGE_NAME="wbj66/claude-code-open:latest"
mkdir -p ~/.claude
exec docker run -it --rm \
    ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
    -v "$HOME/.claude:/root/.claude" \
    -v "$(pwd):/workspace" \
    "$IMAGE_NAME" "$@"
WRAPPER_EOF

    chmod +x "$WRAPPER"

    ensure_path_in_shellrc "$WRAPPER_DIR"

    create_desktop_shortcut_docker

    success "Installation complete via Docker!"
    echo ""
    echo -e "  ${BOLD}Usage:${NC}"
    echo -e "    ${GREEN}claude${NC}                        # Interactive mode"
    echo -e "    ${GREEN}claude \"your prompt\"${NC}           # With prompt"
    echo ""
    echo -e "  ${BOLD}Set your API key:${NC}"
    echo -e "    ${YELLOW}export ANTHROPIC_API_KEY=sk-...${NC}"
    echo ""
    echo -e "  ${BOLD}Desktop Shortcut:${NC}"
    echo -e "    A shortcut has been created on your desktop"
    echo -e "    Click it to start Claude Code WebUI"
    echo ""
}

# ============================================
# Helpers
# ============================================

ensure_path_in_shellrc() {
    local dir="$1"
    if [[ ":$PATH:" == *":$dir:"* ]]; then
        return
    fi

    SHELL_RC=""
    if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "/bin/zsh" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ] || [ "$SHELL" = "/bin/bash" ]; then
        SHELL_RC="$HOME/.bashrc"
    fi

    if [ -n "$SHELL_RC" ]; then
        # Avoid duplicate entries
        if ! grep -q 'Claude Code Open' "$SHELL_RC" 2>/dev/null; then
            echo "" >> "$SHELL_RC"
            echo '# Claude Code Open' >> "$SHELL_RC"
            echo "export PATH=\"$dir:\$PATH\"" >> "$SHELL_RC"
        fi
        warn "Added $dir to PATH in $SHELL_RC"
        warn "Run: source $SHELL_RC  (or open a new terminal)"
    else
        warn "Please add $dir to your PATH manually."
    fi
}

# --- Uninstall ---
uninstall() {
    info "Uninstalling Claude Code Open..."

    if [ -d "$INSTALL_DIR" ]; then
        cd "$INSTALL_DIR" && npm unlink 2>/dev/null || true
        rm -rf "$INSTALL_DIR"
        success "Removed source directory"
    fi

    rm -f "$HOME/.local/bin/claude"
    rm -f "$HOME/.local/bin/claude-web"

    if command -v docker &> /dev/null; then
        docker rmi "$DOCKER_IMAGE" 2>/dev/null || true
        success "Removed Docker image"
    fi

    success "Uninstall complete!"
}

# ============================================
# Main
# ============================================

main() {
    print_banner

    # Handle --uninstall flag
    if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "uninstall" ]; then
        uninstall
        exit 0
    fi

    detect_platform
    detect_pkg_manager
    echo ""

    # ---- Auto-install ALL dependencies ----
    info "Checking & installing dependencies..."
    echo ""

    # 1. Git (needed for source install)
    ensure_git

    # 1.5. Detect best repo source (GitHub vs Gitee for China)
    detect_repo_url

    # 2. Build tools (optional, prebuilt binaries usually available)
    ensure_build_tools

    # 2.5. Python (optional, only needed if prebuilt binaries unavailable)
    ensure_python

    # 3. Node.js
    ensure_node

    echo ""

    # ---- Check Docker availability for alternative install ----
    HAS_DOCKER=false
    if command -v docker &> /dev/null; then
        HAS_DOCKER=true
        success "Docker detected (optional)"
    fi

    # ---- Install ----
    if [ "$HAS_DOCKER" = true ]; then
        echo -e "${BOLD}Select installation method:${NC}"
        echo -e "  ${GREEN}1)${NC} npm (from source)  ${CYAN}[recommended]${NC}"
        echo -e "  ${GREEN}2)${NC} Docker"
        echo ""
        if [ -t 0 ] || [ -e /dev/tty ]; then
            read -p "Choice [1]: " choice < /dev/tty
            choice="${choice:-1}"
        else
            warn "Non-interactive mode, defaulting to npm install"
            choice="1"
        fi
        case "$choice" in
            2) install_docker ;;
            *) install_npm ;;
        esac
    else
        install_npm
    fi
}

main "$@"
