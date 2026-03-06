#!/bin/bash
# Axon Linux Build Script
# Architecture: Electron shell + embedded Node.js + project code
# Output: Axon-Setup.AppImage (single executable, no install needed)
#
# Usage:
#   chmod +x build-linux.sh
#   ./build-linux.sh
#
# Prerequisites:
#   - Node.js installed
#   - npm dependencies installed (npm install)
#   - Project built (npm run build)
#   - Frontend built (cd src/web/client && npm run build)

set -e

echo ""
echo "  Axon Linux Build Script"
echo "  ========================="
echo ""

# ============================================================
# Step 0: Check prerequisites
# ============================================================
echo "[0/7] Checking prerequisites..."

if [ ! -d "node_modules/electron/dist" ]; then
    echo "  ERROR: node_modules/electron/dist not found. Run: npm install"
    exit 1
fi
if [ ! -f "dist/web-cli.js" ]; then
    echo "  ERROR: dist/web-cli.js not found. Run: npm run build"
    exit 1
fi
if [ ! -d "src/web/client/dist" ]; then
    echo "  ERROR: src/web/client/dist not found. Run: cd src/web/client && npm run build"
    exit 1
fi
if [ ! -f "electron/main.cjs" ]; then
    echo "  ERROR: electron/main.cjs not found"
    exit 1
fi

NODE_EXE=$(which node)
if [ -z "$NODE_EXE" ]; then
    echo "  ERROR: Node.js not found in PATH"
    exit 1
fi
NODE_VERSION=$(node -v)
echo "  Node.js: $NODE_VERSION ($NODE_EXE)"
echo "  All prerequisites OK"
echo ""

RELEASE_DIR="$(pwd)/release/axon-linux"
APPDIR="$RELEASE_DIR/Axon.AppDir"

# ============================================================
# Step 1: Clean and create AppDir structure
# ============================================================
echo "[1/7] Creating AppDir structure..."
rm -rf "$RELEASE_DIR"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/lib"
mkdir -p "$APPDIR/usr/share/axon"

# ============================================================
# Step 2: Copy Electron runtime
# ============================================================
echo "[2/7] Copying Electron runtime..."

ELECTRON_SRC="$(pwd)/node_modules/electron/dist"

# Copy Electron binary and libraries
cp "$ELECTRON_SRC/electron" "$APPDIR/usr/bin/axon"
chmod +x "$APPDIR/usr/bin/axon"

# Copy all Electron supporting files (libraries, resources, etc.)
for item in "$ELECTRON_SRC"/*; do
    base=$(basename "$item")
    # Skip the electron binary itself (already copied as 'axon')
    [ "$base" = "electron" ] && continue
    # Skip Electron.app (macOS only artifact)
    [ "$base" = "Electron.app" ] && continue
    if [ -d "$item" ]; then
        cp -R "$item" "$APPDIR/usr/bin/$base"
    else
        cp "$item" "$APPDIR/usr/bin/$base"
    fi
done

# ============================================================
# Step 3: Create AppDir metadata
# ============================================================
echo "[3/7] Creating AppDir metadata..."

VERSION=$(node -e "console.log(require('./electron/package.json').version)")

# AppRun - entry point for AppImage
cat > "$APPDIR/AppRun" << 'APPRUN'
#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
export PATH="$HERE/usr/bin:$PATH"
export LD_LIBRARY_PATH="$HERE/usr/lib:$LD_LIBRARY_PATH"

# Electron needs these
export ELECTRON_IS_DEV=0

# Run Electron with the app
exec "$HERE/usr/bin/axon" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

# Desktop entry
cat > "$APPDIR/axon.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=Axon
Comment=AI Coding Assistant
Exec=axon
Icon=axon
Categories=Development;IDE;
Terminal=false
StartupWMClass=Axon
DESKTOP

# Copy icon
if [ -f "electron/icon.png" ]; then
    cp electron/icon.png "$APPDIR/axon.png"
    # Also put icon in standard location
    mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
    cp electron/icon.png "$APPDIR/usr/share/icons/hicolor/256x256/apps/axon.png"
fi

# ============================================================
# Step 4: Embed Node.js
# ============================================================
echo "[4/7] Embedding Node.js $NODE_VERSION..."

NODE_DIR="$APPDIR/usr/share/axon/node"
mkdir -p "$NODE_DIR"
cp "$NODE_EXE" "$NODE_DIR/node"
chmod +x "$NODE_DIR/node"

# ============================================================
# Step 5: Copy application code
# ============================================================
echo "[5/7] Copying application files..."

APP_CODE_DIR="$APPDIR/usr/share/axon/app"
mkdir -p "$APP_CODE_DIR"

# package.json (Electron entry)
cp electron/package.json "$APP_CODE_DIR/package.json"

# Electron scripts
mkdir -p "$APP_CODE_DIR/electron"
cp electron/main.cjs "$APP_CODE_DIR/electron/"
if [ -f "electron/icon.png" ]; then
    cp electron/icon.png "$APP_CODE_DIR/electron/"
fi

# Backend compiled output
cp -R dist "$APP_CODE_DIR/"

# Frontend build
mkdir -p "$APP_CODE_DIR/src/web/client"
cp -R src/web/client/dist "$APP_CODE_DIR/src/web/client/"

# .env file if exists
if [ -f ".env" ]; then
    cp .env "$APP_CODE_DIR/"
    echo "  Copied .env file"
fi

# ============================================================
# Step 6: Copy and trim node_modules
# ============================================================
echo "[6/7] Copying node_modules (this is slow, please wait)..."

cp -R node_modules "$APP_CODE_DIR/"

echo "  Trimming node_modules..."

# Remove test/docs/example directories
for dir in test tests __tests__ example examples docs doc .github benchmark benchmarks coverage .nyc_output; do
    find "$APP_CODE_DIR/node_modules" -type d -name "$dir" -exec rm -rf {} + 2>/dev/null || true
done

# Remove unnecessary files
find "$APP_CODE_DIR/node_modules" -type f \( \
    -name "*.md" -o -name "*.markdown" -o -name "*.ts" -o -name "*.map" \
    -o -name "*.coffee" -o -name "*.litcoffee" -o -name "*.log" \
    -o -name "CHANGELOG*" -o -name "HISTORY*" -o -name "CHANGES*" \
    -o -name "AUTHORS*" -o -name "CONTRIBUTORS*" \
    \) ! -name "*.d.ts" ! -name "LICENSE*" -delete 2>/dev/null || true

# Remove @types (only needed for TS compilation)
rm -rf "$APP_CODE_DIR/node_modules/@types" 2>/dev/null || true

# Remove typescript compiler
rm -rf "$APP_CODE_DIR/node_modules/typescript" 2>/dev/null || true

# Remove electron package (already used as runtime)
rm -rf "$APP_CODE_DIR/node_modules/electron" 2>/dev/null || true

echo "  node_modules trimmed"

# ============================================================
# Step 7: Create AppImage
# ============================================================
echo "[7/7] Creating AppImage..."

# Set Electron's resources path
# Electron on Linux looks for 'resources/app' relative to the binary
# We need to symlink or set it up correctly
RESOURCES_DIR="$APPDIR/usr/bin/resources"
mkdir -p "$RESOURCES_DIR"

# Create symlink: resources/app -> ../../share/axon/app
ln -sf "../../share/axon/app" "$RESOURCES_DIR/app"

# Download appimagetool if not present
APPIMAGETOOL="$(pwd)/release/appimagetool"
if [ ! -f "$APPIMAGETOOL" ]; then
    echo "  Downloading appimagetool..."
    ARCH=$(uname -m)
    curl -fsSL "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage" -o "$APPIMAGETOOL"
    chmod +x "$APPIMAGETOOL"
fi

# Create the AppImage
APPIMAGE_NAME="Axon-Setup.AppImage"
APPIMAGE_PATH="$(pwd)/release/$APPIMAGE_NAME"
rm -f "$APPIMAGE_PATH"

# appimagetool needs ARCH env var
export ARCH=$(uname -m)

# Try --appimage-extract-and-run first (works in CI without FUSE)
# Fall back to direct execution if available
"$APPIMAGETOOL" --appimage-extract-and-run "$APPDIR" "$APPIMAGE_PATH" 2>&1 || \
    "$APPIMAGETOOL" "$APPDIR" "$APPIMAGE_PATH" 2>&1

# Calculate sizes
APPDIR_SIZE=$(du -sm "$APPDIR" | cut -f1)
APPIMAGE_SIZE=$(du -sm "$APPIMAGE_PATH" | cut -f1)

echo ""
echo "  ========================="
echo "  BUILD SUCCESS"
echo "  ========================="
echo ""
echo "  AppDir     : $APPDIR"
echo "  AppDir Size: ${APPDIR_SIZE} MB"
echo "  AppImage   : $APPIMAGE_PATH"
echo "  AppImage   : ${APPIMAGE_SIZE} MB"
echo "  Node.js    : $NODE_VERSION (embedded)"
echo ""
echo "  Usage: chmod +x $APPIMAGE_NAME && ./$APPIMAGE_NAME"
echo ""
