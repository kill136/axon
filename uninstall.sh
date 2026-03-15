#!/bin/bash
# ============================================
# Axon - One-Click Uninstall Script
# GitHub:  curl -fsSL https://raw.githubusercontent.com/kill136/axon/private_web_ui/uninstall.sh | bash
# China:   curl -fsSL https://gitee.com/lubanbbs/axon/raw/private_web_ui/uninstall.sh | bash
# ============================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

DOCKER_IMAGE="wbj66/axon:latest"
INSTALL_DIR="${AXON_CONFIG_DIR:-$HOME/.axon}"

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }

echo -e "${CYAN}"
echo '  ╔═══════════════════════════════════════════╗'
echo '  ║           Axon Uninstaller                ║'
echo '  ╚═══════════════════════════════════════════╝'
echo -e "${NC}"

info "Uninstalling Axon from: $INSTALL_DIR"
echo ""

# --- Remove source directory (runs npm unlink first) ---
if [ -d "$INSTALL_DIR" ]; then
    if [ -d "$INSTALL_DIR/.git" ] || [ -f "$INSTALL_DIR/package.json" ]; then
        info "Running npm unlink..."
        (cd "$INSTALL_DIR" && npm unlink 2>/dev/null) || true
    fi
    rm -rf "$INSTALL_DIR"
    success "Removed installation directory: $INSTALL_DIR"
else
    warn "Installation directory not found: $INSTALL_DIR (already removed?)"
fi

# --- Remove CLI binaries ---
for bin in claude claude-web; do
    if [ -f "$HOME/.local/bin/$bin" ] || [ -L "$HOME/.local/bin/$bin" ]; then
        rm -f "$HOME/.local/bin/$bin"
        success "Removed $HOME/.local/bin/$bin"
    fi
done

# --- Remove desktop shortcuts ---
DESKTOP_DIRS=("$HOME/Desktop" "$HOME/桌面")
for desktop in "${DESKTOP_DIRS[@]}"; do
    if [ -f "$desktop/claude-code-webui.desktop" ]; then
        rm -f "$desktop/claude-code-webui.desktop"
        success "Removed desktop shortcut: $desktop/claude-code-webui.desktop"
    fi
    if [ -f "$desktop/Axon WebUI.command" ]; then
        rm -f "$desktop/Axon WebUI.command"
        success "Removed desktop shortcut: $desktop/Axon WebUI.command"
    fi
done

# --- Clean shell rc files (remove Axon PATH and AXON_CONFIG_DIR entries) ---
for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [ -f "$rc" ]; then
        # Remove lines added by Axon installer: the comment and export lines
        if grep -q 'Axon\|AXON_CONFIG_DIR' "$rc" 2>/dev/null; then
            # Use a temp file to filter out Axon-related lines
            tmp=$(mktemp)
            grep -v '^# Axon$\|AXON_CONFIG_DIR\|\.local/bin.*PATH\|PATH.*\.local/bin' "$rc" > "$tmp" || true
            # Also remove blank lines that were inserted before the Axon comment
            # by collapsing multiple consecutive blank lines
            awk 'NF || prev_blank==0 { print; prev_blank=!NF }' "$tmp" > "$rc"
            rm -f "$tmp"
            success "Cleaned Axon entries from $rc"
        fi
    fi
done

# --- Remove Docker image (optional) ---
if command -v docker &> /dev/null; then
    if docker image inspect "$DOCKER_IMAGE" &>/dev/null 2>&1; then
        info "Removing Docker image: $DOCKER_IMAGE"
        docker rmi "$DOCKER_IMAGE" 2>/dev/null || warn "Could not remove Docker image (may be in use)"
        success "Removed Docker image: $DOCKER_IMAGE"
    fi
fi

echo ""
success "Axon has been fully uninstalled!"
echo ""
echo -e "  ${YELLOW}Note:${NC} Open a new terminal for PATH changes to take effect."
echo ""
