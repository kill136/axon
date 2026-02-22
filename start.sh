#!/bin/bash
# Claude Code Open - WebUI Launcher (for pre-built packages)

set -e

echo ""
echo "  +=============================================+"
echo "  |     Claude Code Open - WebUI                |"
echo "  +=============================================+"
echo ""

# Switch to script directory
cd "$(dirname "$0")"

# Check node
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed."
    echo "        Please install from https://nodejs.org/"
    echo "        Or use install.sh for automatic setup."
    exit 1
fi

echo "[OK] Node.js $(node -v)"

# Check dist
if [ ! -f "dist/web-cli.js" ]; then
    echo "[ERROR] dist/web-cli.js not found."
    echo "        This package may be incomplete."
    exit 1
fi

echo ""
echo "[INFO] Starting Claude Code WebUI..."
echo "[INFO] Open http://localhost:3456 in your browser"
echo "[INFO] Press Ctrl+C to stop the server"
echo ""

node dist/web-cli.js
