#!/bin/bash
# Axon macOS Build Script
# Architecture: Electron shell + embedded Node.js + project code
# Output: Axon.app bundle + .dmg installer
#
# Usage:
#   chmod +x build-macos.sh
#   ./build-macos.sh
#
# Prerequisites:
#   - Node.js installed
#   - npm dependencies installed (npm install)
#   - Project built (npm run build)
#   - Frontend built (cd src/web/client && npm run build)

set -e

echo ""
echo "  Axon macOS Build Script"
echo "  ========================="
echo ""

# ============================================================
# Step 0: Check prerequisites
# ============================================================
echo "[0/8] Checking prerequisites..."

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

RELEASE_DIR="$(pwd)/release/axon-macos"
APP_DIR="$RELEASE_DIR/Axon.app"
CONTENTS_DIR="$APP_DIR/Contents"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
MACOS_DIR="$CONTENTS_DIR/MacOS"
APP_CODE_DIR="$RESOURCES_DIR/app"

# ============================================================
# Step 1: Clean and create directories
# ============================================================
echo "[1/8] Creating release directory..."
rm -rf "$RELEASE_DIR"
mkdir -p "$APP_CODE_DIR"
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# ============================================================
# Step 2: Copy Electron framework
# ============================================================
echo "[2/8] Copying Electron framework..."

ELECTRON_SRC="$(pwd)/node_modules/electron/dist"

# On macOS, Electron ships as Electron.app
if [ -d "$ELECTRON_SRC/Electron.app" ]; then
    # Copy the entire Electron.app structure
    cp -R "$ELECTRON_SRC/Electron.app/" "$APP_DIR/"

    # Rename the main executable
    if [ -f "$MACOS_DIR/Electron" ]; then
        mv "$MACOS_DIR/Electron" "$MACOS_DIR/Axon"
    fi
else
    echo "  ERROR: Electron.app not found in $ELECTRON_SRC"
    echo "  This script must be run on macOS"
    exit 1
fi

# ============================================================
# Step 3: Create Info.plist
# ============================================================
echo "[3/8] Creating Info.plist..."

VERSION=$(node -e "console.log(require('./electron/package.json').version)")

cat > "$CONTENTS_DIR/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Axon</string>
    <key>CFBundleDisplayName</key>
    <string>Axon</string>
    <key>CFBundleIdentifier</key>
    <string>com.axon.desktop</string>
    <key>CFBundleVersion</key>
    <string>$VERSION</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleExecutable</key>
    <string>Axon</string>
    <key>CFBundleIconFile</key>
    <string>icon.icns</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
</dict>
</plist>
PLIST

# ============================================================
# Step 4: Create app icon (.icns)
# ============================================================
echo "[4/8] Creating app icon..."

if [ -f "electron/icon.png" ]; then
    ICONSET_DIR="$(pwd)/release/axon.iconset"
    mkdir -p "$ICONSET_DIR"

    # First convert to sRGB to avoid colorspace issues with iconutil
    ICON_SRC="$(pwd)/release/icon_srgb.png"
    sips -s format png -s formatOptions best electron/icon.png --out "$ICON_SRC" >/dev/null 2>&1

    # Generate icon sizes required for .icns
    for sz in 16 32 64 128 256 512 1024; do
        sips -z $sz $sz "$ICON_SRC" --out "$ICONSET_DIR/tmp_${sz}.png" >/dev/null 2>&1
    done

    # Map to correct iconset filenames
    cp "$ICONSET_DIR/tmp_16.png"   "$ICONSET_DIR/icon_16x16.png"
    cp "$ICONSET_DIR/tmp_32.png"   "$ICONSET_DIR/icon_16x16@2x.png"
    cp "$ICONSET_DIR/tmp_32.png"   "$ICONSET_DIR/icon_32x32.png"
    cp "$ICONSET_DIR/tmp_64.png"   "$ICONSET_DIR/icon_32x32@2x.png"
    cp "$ICONSET_DIR/tmp_128.png"  "$ICONSET_DIR/icon_128x128.png"
    cp "$ICONSET_DIR/tmp_256.png"  "$ICONSET_DIR/icon_128x128@2x.png"
    cp "$ICONSET_DIR/tmp_256.png"  "$ICONSET_DIR/icon_256x256.png"
    cp "$ICONSET_DIR/tmp_512.png"  "$ICONSET_DIR/icon_256x256@2x.png"
    cp "$ICONSET_DIR/tmp_512.png"  "$ICONSET_DIR/icon_512x512.png"
    cp "$ICONSET_DIR/tmp_1024.png" "$ICONSET_DIR/icon_512x512@2x.png"
    rm -f "$ICONSET_DIR"/tmp_*.png "$ICON_SRC"

    if iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/icon.icns" 2>&1; then
        echo "  Created icon.icns"
    else
        echo "  WARNING: iconutil failed, using default Electron icon"
    fi
    rm -rf "$ICONSET_DIR"
else
    echo "  WARNING: electron/icon.png not found, using default icon"
fi

# ============================================================
# Step 5: Embed Node.js
# ============================================================
echo "[5/8] Embedding Node.js $NODE_VERSION..."

NODE_DIR="$RESOURCES_DIR/node"
mkdir -p "$NODE_DIR"
cp "$NODE_EXE" "$NODE_DIR/node"
chmod +x "$NODE_DIR/node"

# ============================================================
# Step 6: Copy application code
# ============================================================
echo "[6/8] Copying application files..."

# package.json
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
# Step 7: Copy and trim node_modules
# ============================================================
echo "[7/8] Copying node_modules (this is slow, please wait)..."

cp -R node_modules "$APP_CODE_DIR/"

echo "  Trimming node_modules..."
TRIMMED=0

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
# Step 8: Create DMG
# ============================================================
echo "[8/8] Creating DMG installer..."

DMG_NAME="Axon-Setup.dmg"
DMG_PATH="$(pwd)/release/$DMG_NAME"

# Remove old DMG if exists
rm -f "$DMG_PATH"

# Create a temporary DMG directory with app and Applications symlink
DMG_STAGING="$(pwd)/release/dmg-staging"
rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING"

# Copy the .app bundle
cp -R "$APP_DIR" "$DMG_STAGING/"

# Create Applications symlink (drag-to-install)
ln -s /Applications "$DMG_STAGING/Applications"

# Create DMG
hdiutil create -volname "Axon" \
    -srcfolder "$DMG_STAGING" \
    -ov -format UDZO \
    "$DMG_PATH"

# Clean up staging
rm -rf "$DMG_STAGING"

# Calculate sizes
APP_SIZE=$(du -sm "$APP_DIR" | cut -f1)
DMG_SIZE=$(du -sm "$DMG_PATH" | cut -f1)

echo ""
echo "  ========================="
echo "  BUILD SUCCESS"
echo "  ========================="
echo ""
echo "  App Bundle : $APP_DIR"
echo "  App Size   : ${APP_SIZE} MB"
echo "  DMG        : $DMG_PATH"
echo "  DMG Size   : ${DMG_SIZE} MB"
echo "  Node.js    : $NODE_VERSION (embedded)"
echo ""
