#!/bin/bash
# Build Diplo as a single RPM, without agent or React packaging.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ONLY=0
if [ "${4:-}" = --source-only ]; then
    SOURCE_ONLY=1
    set -- "$1" "$2" "$3"
elif [ "${3:-}" = --source-only ]; then
    SOURCE_ONLY=1
    set -- "$1" "$2"
fi
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo "Usage: $0 <VER> <REL> [BUILD_PATH] [--source-only]" >&2
    exit 1
fi
VER="$1"
REL="$2"
BUILD_PATH="${3:-$SCRIPT_DIR/../..}"
BUILD_PATH="$(cd "$BUILD_PATH" && pwd)"
NAME=ablecube
TOP_DIR="${ABLESTACK_RPM_TOPDIR:-$BUILD_PATH/rpmbuild}"
mkdir -p "$TOP_DIR"
TOP_DIR="$(cd "$TOP_DIR" && pwd)"
if [ ! -f "$BUILD_PATH/tools/makerpm/properties_config.py" ]; then
    echo "Missing property merge helper: $BUILD_PATH/tools/makerpm/properties_config.py" >&2
    exit 1
fi
if [ "$SOURCE_ONLY" -eq 0 ] && ! command -v rpmbuild >/dev/null 2>&1; then
    echo "rpmbuild command not found. Install rpm-build first." >&2
    exit 1
fi
mkdir -p "$TOP_DIR"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}
SOURCE_STAGE="$(mktemp -d "$TOP_DIR/SOURCES/.${NAME}-${VER}.XXXXXX")"
trap 'rm -rf -- "$SOURCE_STAGE"' EXIT
mkdir -p "$SOURCE_STAGE/${NAME}-${VER}"
tar -C "$BUILD_PATH" \
    --exclude='tools/vmconfig' \
    --exclude='tools/makerpm/rpmbuild' \
    --exclude='tools/makerpm/property-defaults' \
    --exclude='tools/properties/*.cube-agent.json*' \
    --exclude='tools/properties/.cube-setup-*' \
    --exclude='tools/properties/.properties-merge-*' \
    --exclude='.DS_Store' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='*.rpmnew' --exclude='*.rpmsave' --exclude='*.rpmorig' \
    -cf - README.md node_modules images main.html manifest.json sample shell src tools python \
    index.html index.js main-glue.html main-glue-no-permission.html \
    | tar -C "$SOURCE_STAGE/${NAME}-${VER}" -xf -
mkdir -p "$SOURCE_STAGE/${NAME}-${VER}/tools/vmconfig"
if [ -f "$BUILD_PATH/tools/vmconfig/readme.md" ]; then
    cp -p "$BUILD_PATH/tools/vmconfig/readme.md" "$SOURCE_STAGE/${NAME}-${VER}/tools/vmconfig/"
fi
tar -czf "$TOP_DIR/SOURCES/${NAME}-${VER}.tar.gz" -C "$SOURCE_STAGE" "${NAME}-${VER}"
cp -f "$SCRIPT_DIR/ablestack.spec" "$TOP_DIR/SPECS/"
if [ "$SOURCE_ONLY" -eq 1 ]; then
    echo "Source archive prepared: $TOP_DIR/SOURCES/${NAME}-${VER}.tar.gz"
    exit 0
fi
cd "$BUILD_PATH"
rpmbuild -ba "$TOP_DIR/SPECS/ablestack.spec" \
    --define "_topdir $TOP_DIR" --define "version $VER" --define "release $REL" \
    --target x86_64 --nocheck
echo "RPM build completed: $TOP_DIR/RPMS/x86_64/${NAME}-${VER}-${REL}.x86_64.rpm"
