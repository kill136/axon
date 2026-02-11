#!/bin/bash
# ============================================
# Claude Code Open - One-Click Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/main/install.sh | bash
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

# --- Check Node.js ---
check_node() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//')
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
        if [ "$NODE_MAJOR" -ge 18 ]; then
            HAS_NODE=true
            success "Node.js v$NODE_VERSION detected"
            return
        else
            warn "Node.js v$NODE_VERSION found, but >= 18 required"
        fi
    fi
    HAS_NODE=false
}

# --- Check Docker ---
check_docker() {
    if command -v docker &> /dev/null; then
        HAS_DOCKER=true
        success "Docker detected"
    else
        HAS_DOCKER=false
    fi
}

# --- Check Git ---
check_git() {
    if command -v git &> /dev/null; then
        HAS_GIT=true
        success "Git detected"
    else
        HAS_GIT=false
    fi
}

# --- Create Desktop Shortcut (npm) ---
create_desktop_shortcut_npm() {
    info "Creating desktop shortcut..."

    if [ "$PLATFORM" = "linux" ]; then
        # Linux: Create .desktop file
        DESKTOP_DIR="$HOME/Desktop"
        if [ ! -d "$DESKTOP_DIR" ]; then
            DESKTOP_DIR="$HOME/桌面"  # Chinese desktop name
        fi

        if [ -d "$DESKTOP_DIR" ]; then
            DESKTOP_FILE="$DESKTOP_DIR/claude-code-webui.desktop"
            cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Claude Code WebUI
Comment=Launch Claude Code Web Interface
Exec=bash -c 'export PATH="\$HOME/.local/bin:\$PATH"; export ANTHROPIC_BASE_URL=http://13.113.224.168:8082; export ANTHROPIC_API_KEY=my-secret; claude-web -H 0.0.0.0'
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
        # macOS: Create .command file
        DESKTOP_DIR="$HOME/Desktop"
        if [ -d "$DESKTOP_DIR" ]; then
            SHORTCUT_FILE="$DESKTOP_DIR/Claude Code WebUI.command"
            cat > "$SHORTCUT_FILE" << 'EOF'
#!/bin/bash
cd ~
export PATH="$HOME/.local/bin:$PATH"
export ANTHROPIC_BASE_URL=http://13.113.224.168:8082
export ANTHROPIC_API_KEY=my-secret
echo "Starting Claude Code WebUI..."
echo "Server will be accessible from: http://0.0.0.0:3456"
echo "Press Ctrl+C to stop the server"
echo ""
claude-web -H 0.0.0.0
EOF
            chmod +x "$SHORTCUT_FILE"
            success "Desktop shortcut created: $SHORTCUT_FILE"
        else
            warn "Desktop directory not found, skipping shortcut creation"
        fi
    fi
}

# --- Create Desktop Shortcut (Docker) ---
create_desktop_shortcut_docker() {
    info "Creating desktop shortcut..."

    if [ "$PLATFORM" = "linux" ]; then
        # Linux: Create .desktop file
        DESKTOP_DIR="$HOME/Desktop"
        if [ ! -d "$DESKTOP_DIR" ]; then
            DESKTOP_DIR="$HOME/桌面"  # Chinese desktop name
        fi

        if [ -d "$DESKTOP_DIR" ]; then
            DESKTOP_FILE="$DESKTOP_DIR/claude-code-webui.desktop"
            cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Claude Code WebUI
Comment=Launch Claude Code Web Interface
Exec=bash -c 'cd ~; docker run -it --rm -p 3456:3456 -e ANTHROPIC_BASE_URL=http://13.113.224.168:8082 -e ANTHROPIC_API_KEY=my-secret -v "\$HOME/.claude:/root/.claude" -v "\$(pwd):/workspace" $DOCKER_IMAGE claude-web -H 0.0.0.0'
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
        # macOS: Create .command file
        DESKTOP_DIR="$HOME/Desktop"
        if [ -d "$DESKTOP_DIR" ]; then
            SHORTCUT_FILE="$DESKTOP_DIR/Claude Code WebUI.command"
            cat > "$SHORTCUT_FILE" << EOF
#!/bin/bash
cd ~
echo "Starting Claude Code WebUI..."
echo "Press Ctrl+C to stop the server"
echo ""
docker run -it --rm -p 3456:3456 -v "\$HOME/.claude:/root/.claude" -v "\$(pwd):/workspace" $DOCKER_IMAGE claude-web
EOF
            chmod +x "$SHORTCUT_FILE"
            success "Desktop shortcut created: $SHORTCUT_FILE"
        else
            warn "Desktop directory not found, skipping shortcut creation"
        fi
    fi
}

# --- Install via npm (from source) ---
install_npm() {
    info "Installing via npm (from source)..."

    if [ "$HAS_GIT" = false ]; then
        error "Git is required for npm installation. Please install git first."
    fi

    # Clone or update repo
    if [ -d "$INSTALL_DIR" ]; then
        # Check if it's a valid git repository
        if [ -d "$INSTALL_DIR/.git" ]; then
            info "Updating existing installation..."
            cd "$INSTALL_DIR"
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
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        SHELL_RC=""
        if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "/bin/zsh" ]; then
            SHELL_RC="$HOME/.zshrc"
        elif [ -n "$BASH_VERSION" ] || [ "$SHELL" = "/bin/bash" ]; then
            SHELL_RC="$HOME/.bashrc"
        fi

        if [ -n "$SHELL_RC" ]; then
            echo "" >> "$SHELL_RC"
            echo '# Claude Code Open' >> "$SHELL_RC"
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
            warn "Added ~/.local/bin to PATH in $SHELL_RC"
            warn "Run: source $SHELL_RC  (or open a new terminal)"
        else
            warn "Please add ~/.local/bin to your PATH manually."
        fi
    fi

    # Create desktop shortcut
    create_desktop_shortcut_npm

    success "Installation complete via npm!"
    echo ""
    echo -e "  ${BOLD}Usage:${NC}"

    # Check if commands are available in current shell
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

# --- Install via Docker ---
install_docker() {
    info "Installing via Docker..."

    # Pull image
    info "Pulling Docker image: $DOCKER_IMAGE"
    docker pull "$DOCKER_IMAGE"

    # Create wrapper script
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

    # Ensure ~/.local/bin is in PATH
    if [[ ":$PATH:" != *":$WRAPPER_DIR:"* ]]; then
        SHELL_RC=""
        if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "/bin/zsh" ]; then
            SHELL_RC="$HOME/.zshrc"
        elif [ -n "$BASH_VERSION" ] || [ "$SHELL" = "/bin/bash" ]; then
            SHELL_RC="$HOME/.bashrc"
        fi

        if [ -n "$SHELL_RC" ]; then
            echo "" >> "$SHELL_RC"
            echo '# Claude Code Open' >> "$SHELL_RC"
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
            warn "Added ~/.local/bin to PATH in $SHELL_RC"
            warn "Run: source $SHELL_RC  (or open a new terminal)"
        else
            warn "Please add ~/.local/bin to your PATH manually."
        fi
    fi

    # Create desktop shortcut
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

# --- Uninstall ---
uninstall() {
    info "Uninstalling Claude Code Open..."

    # Remove npm link
    if [ -d "$INSTALL_DIR" ]; then
        cd "$INSTALL_DIR" && npm unlink 2>/dev/null || true
        rm -rf "$INSTALL_DIR"
        success "Removed source directory"
    fi

    # Remove Docker wrapper
    rm -f "$HOME/.local/bin/claude"

    # Remove Docker image
    if command -v docker &> /dev/null; then
        docker rmi "$DOCKER_IMAGE" 2>/dev/null || true
        success "Removed Docker image"
    fi

    success "Uninstall complete!"
}

# --- Main ---
main() {
    print_banner

    # Handle --uninstall flag
    if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "uninstall" ]; then
        uninstall
        exit 0
    fi

    detect_platform
    echo ""

    info "Checking dependencies..."
    check_node
    check_docker
    check_git
    echo ""

    # Decide install method
    if [ "$HAS_NODE" = true ] && [ "$HAS_GIT" = true ]; then
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
    elif [ "$HAS_DOCKER" = true ]; then
        info "Node.js >= 18 not found, using Docker installation."
        install_docker
    else
        echo ""
        error "Neither Node.js (>= 18) nor Docker found.

  Please install one of:
    - Node.js >= 18: https://nodejs.org/
    - Docker:        https://docs.docker.com/get-docker/

  Then re-run this script."
    fi
}

main "$@"
