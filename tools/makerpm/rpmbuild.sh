#!/bin/bash
# Copyright (c) 2021 ABLECLOUD Co. Ltd
# 이 파일은 rpmbuild를 이용하여 ablestack-cockpit-plugin을 빌드하는 스크립트입니다.
# 최초 작성일 : 2026. 1. 5

set -euo pipefail

# 이 스크립트(ablestack.spec)의 실제 위치
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 사용법: ./rpmbuild.sh <VER> <REL> [BUILD_PATH] [--source-only]
SOURCE_ONLY=0
if [ "${4:-}" = "--source-only" ]; then
  SOURCE_ONLY=1
  set -- "$1" "$2" "$3"
elif [ "${3:-}" = "--source-only" ]; then
  SOURCE_ONLY=1
  set -- "$1" "$2"
fi
if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "Usage: $0 <VER> <REL> [BUILD_PATH] [--source-only]"
  echo "  예) $0 v4.5.1 251208 ."
  exit 1
fi

VER="$1"   # 예: v4.5.1
REL="$2"   # 예: 251208

# 빌드 기준 경로 (cockpit-plugin-ablestack 루트)
if [ -z "${3:-}" ]; then
  BUILD_PATH="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  BUILD_PATH="$3"
fi
BUILD_PATH="$(cd "$BUILD_PATH" && pwd)"

# spec Name 과 맞춤
NAME="ablecube"
TOP_DIR="${ABLESTACK_RPM_TOPDIR:-$BUILD_PATH/rpmbuild}"
mkdir -p "$TOP_DIR"
TOP_DIR="$(cd "$TOP_DIR" && pwd)"
SPEC_PATH="$SCRIPT_DIR/ablestack.spec"

echo "BUILD_LAYOUT = ablecube-and-agent-v1"
echo "SPEC_PATH    = $SPEC_PATH"
# Fail before building with an old, main-package-only spec from another checkout.
if ! grep -Eq '^%package[[:space:]]+agent[[:space:]]*$' "$SPEC_PATH" ||
   ! grep -Eq '^%files[[:space:]]+agent[[:space:]]*$' "$SPEC_PATH" ||
   ! grep -Eq '^Requires:[[:space:]]+ablecube-agent[[:space:]]*=' "$SPEC_PATH"; then
  echo "Outdated RPM spec: ablecube-agent subpackage/dependency is missing: $SPEC_PATH" >&2
  echo "Copy the updated tools/makerpm directory and tools/node-agent sources to this build server." >&2
  exit 1
fi
for required_source in agent.py client.py config.py cli.py transfer.py operations.py provision.py query_helpers.py remote_session.py management_firewall.py \
    node_setup.py cluster_enrollment.py agent.json install.json install-bundle.sh bootstrap-vm.sh \
    node-remote node-copy node-setup cube-agent.service cube-agent-setup.service \
    cube-agent-setup.path 90-cube-agent-setup; do
  if [ ! -f "$BUILD_PATH/tools/node-agent/$required_source" ]; then
    echo "Missing agent source: $BUILD_PATH/tools/node-agent/$required_source" >&2
    exit 1
  fi
done
if [ "$SOURCE_ONLY" -eq 0 ]; then
  for build_tool in rpmbuild rpm; do
    if ! command -v "$build_tool" >/dev/null 2>&1; then
      echo "$build_tool command not found. Install rpm and rpm-build first." >&2
      exit 1
    fi
  done
fi

echo "BUILD_PATH = $BUILD_PATH"
echo "VER        = $VER"
echo "REL        = $REL"
echo "NAME       = $NAME"
echo "TOP_DIR    = $TOP_DIR"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$SPEC_PATH"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$SPEC_PATH"
fi

# rpmbuild 디렉터리 구조 생성
mkdir -p "$TOP_DIR"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

# 매번 비어 있는 작업 디렉터리를 사용해 이전 빌드의 삭제된 파일이 섞이지 않게 한다.
SOURCE_STAGE="$(mktemp -d "$TOP_DIR/SOURCES/.${NAME}-${VER}.XXXXXX")"
trap 'rm -rf -- "$SOURCE_STAGE"' EXIT
SOURCE_PATH="$SOURCE_STAGE/${NAME}-${VER}"
mkdir -p "$SOURCE_PATH"

# VM 작업 파일(SSH 키, XML, ISO), 중첩 빌드 결과와 설정 백업은 배포하지 않는다.
tar -C "$BUILD_PATH" \
  --exclude='tools/vmconfig' \
  --exclude='tools/makerpm/rpmbuild' \
  --exclude='tools/node-agent/ablecube-agent.rpm' \
  --exclude='tools/properties/*.cube-agent.json*' \
  --exclude='tools/properties/.cube-setup-*' \
  --exclude='.DS_Store' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='*.rpmnew' \
  --exclude='*.rpmsave' \
  --exclude='*.rpmorig' \
  -cf - README.md node_modules images main.html manifest.json sample shell src tools python \
    index.html index.js main-glue.html main-glue-no-permission.html \
  | tar -C "$SOURCE_PATH" -xf -

mkdir -p "$SOURCE_PATH/tools/vmconfig"
if [ -f "$BUILD_PATH/tools/vmconfig/readme.md" ]; then
  cp -p "$BUILD_PATH/tools/vmconfig/readme.md" "$SOURCE_PATH/tools/vmconfig/"
fi

# Source0: %{name}-%{version}.tar.gz 생성
tar -czf "$TOP_DIR/SOURCES/${NAME}-${VER}.tar.gz" \
  -C "$SOURCE_STAGE" "${NAME}-${VER}"

# spec 파일 복사 (스크립트와 같은 디렉터리에서 가져옴)
cp -f "$SPEC_PATH" "$TOP_DIR/SPECS/"
if [ "$SOURCE_ONLY" -eq 1 ]; then
  echo "Source archive prepared: $TOP_DIR/SOURCES/${NAME}-${VER}.tar.gz"
  exit 0
fi

# Always check this build's fresh output, never a previous RPM with the same release.
mkdir -p "$SOURCE_STAGE/bootstrap/RPMS" "$SOURCE_STAGE/bootstrap/SRPMS" \
  "$SOURCE_STAGE/RPMS" "$SOURCE_STAGE/SRPMS"
verify_package() {
  local package_path="$1" package_name="$2" package_arch="$3" actual
  if [ ! -f "$package_path" ]; then
    echo "Required RPM was not produced by this build: $package_path" >&2
    exit 1
  fi
  actual=$(rpm -qp --qf '%{NAME}|%{VERSION}-%{RELEASE}|%{ARCH}' "$package_path")
  if [ "$actual" != "$package_name|$VER-$REL|$package_arch" ]; then
    echo "Unexpected RPM metadata: $package_path ($actual)" >&2
    exit 1
  fi
}

# rpmbuild 실행
cd "$BUILD_PATH"
rpmbuild -bb "$TOP_DIR/SPECS/ablestack.spec" \
  --define "_topdir $TOP_DIR" \
  --define "_rpmdir $SOURCE_STAGE/bootstrap/RPMS" \
  --define "_srcrpmdir $SOURCE_STAGE/bootstrap/SRPMS" \
  --define "version ${VER}" \
  --define "release ${REL}" \
  --target x86_64 \
  --nocheck

# Seed VM cloud-init with the matching agent RPM, without credentials or a package
# repository dependency inside the new VM. The second pass packages that artifact
# in ablecube only; the agent subpackage does not contain another RPM.
AGENT_RPM="$SOURCE_STAGE/bootstrap/RPMS/noarch/${NAME}-agent-${VER}-${REL}.noarch.rpm"
verify_package "$AGENT_RPM" "${NAME}-agent" noarch
install -m 0644 "$AGENT_RPM" "$SOURCE_PATH/tools/node-agent/ablecube-agent.rpm"
tar -czf "$TOP_DIR/SOURCES/${NAME}-${VER}.tar.gz" \
  -C "$SOURCE_STAGE" "${NAME}-${VER}"
rpmbuild -ba "$TOP_DIR/SPECS/ablestack.spec" \
  --define "_topdir $TOP_DIR" \
  --define "_rpmdir $SOURCE_STAGE/RPMS" \
  --define "_srcrpmdir $SOURCE_STAGE/SRPMS" \
  --define "version ${VER}" \
  --define "release ${REL}" \
  --target x86_64 \
  --nocheck

MAIN_RPM="$SOURCE_STAGE/RPMS/x86_64/${NAME}-${VER}-${REL}.x86_64.rpm"
AGENT_RPM="$SOURCE_STAGE/RPMS/noarch/${NAME}-agent-${VER}-${REL}.noarch.rpm"
verify_package "$MAIN_RPM" "$NAME" x86_64
verify_package "$AGENT_RPM" "${NAME}-agent" noarch
MAIN_REQUIRES=$(rpm -qp --requires "$MAIN_RPM")
if ! printf '%s\n' "$MAIN_REQUIRES" | grep -Fxq "${NAME}-agent = ${VER}-${REL}"; then
  echo "The generated ablecube RPM does not require the matching ablecube-agent RPM." >&2
  exit 1
fi
AGENT_FILES=$(rpm -qpl "$AGENT_RPM")
if ! printf '%s\n' "$AGENT_FILES" | grep -Fxq /usr/lib/systemd/system/cube-agent.service; then
  echo "The generated ablecube-agent RPM does not contain cube-agent.service." >&2
  exit 1
fi
mkdir -p "$TOP_DIR/RPMS/x86_64" "$TOP_DIR/RPMS/noarch"
install -m 0644 "$MAIN_RPM" "$TOP_DIR/RPMS/x86_64/"
install -m 0644 "$AGENT_RPM" "$TOP_DIR/RPMS/noarch/"
for source_rpm in "$SOURCE_STAGE/SRPMS/"*.src.rpm; do
  if [ -f "$source_rpm" ]; then
    install -m 0644 "$source_rpm" "$TOP_DIR/SRPMS/"
  fi
done

echo
echo "빌드 완료!"
echo "검증한 RPM 2개:"
echo "  $TOP_DIR/RPMS/x86_64/${NAME}-${VER}-${REL}.x86_64.rpm"
echo "  $TOP_DIR/RPMS/noarch/${NAME}-agent-${VER}-${REL}.noarch.rpm"

