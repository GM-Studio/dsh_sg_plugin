#!/usr/bin/env bash
# SpecGate 环境一键安装引导（Linux/macOS）：确保可用的 Node >= 20.19 后执行 install-env.mjs。
# 用法：bash scripts/install-env.sh [--check|--json|--only=...|--reinstall|--method=...|--toolchain-dir=...]
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_VERSION_FALLBACK="v22.12.0"
TOOLCHAINS="${SPECGATE_TOOLCHAINS:-$HOME/.specgate/toolchains}"
NODE_DIR="$TOOLCHAINS/node-current"

node_usable() {
  [ -n "${1:-}" ] && [ -x "$1" ] && "$1" -e '
    const v = process.versions.node.split(".").map(Number);
    process.exit(v[0] > 20 || (v[0] === 20 && v[1] >= 19) ? 0 : 1);
  ' >/dev/null 2>&1
}

CANDIDATE=$(command -v node 2>/dev/null || true)
if node_usable "$CANDIDATE"; then
  exec "$CANDIDATE" "$SCRIPT_DIR/install-env.mjs" "$@"
fi
if node_usable "$NODE_DIR/bin/node"; then
  exec "$NODE_DIR/bin/node" "$SCRIPT_DIR/install-env.mjs" "$@"
fi

echo "[SpecGate] 未找到可用 Node（>= 20.19），开始自动准备..."

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
  fi
fi

# 1) 发行版包管理器（尽力而为；版本不达标时回退便携下载）
if [ -n "$SUDO" ] || [ "$(id -u)" -eq 0 ]; then
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -y >/dev/null 2>&1 || true
    $SUDO apt-get install -y nodejs npm >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y nodejs npm >/dev/null 2>&1 || true
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -S --noconfirm nodejs npm >/dev/null 2>&1 || true
  fi
  hash -r 2>/dev/null || true
  CANDIDATE=$(command -v node 2>/dev/null || true)
  if node_usable "$CANDIDATE"; then
    exec "$CANDIDATE" "$SCRIPT_DIR/install-env.mjs" "$@"
  fi
fi

# 2) 便携下载官方 Node（无需 root）
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) NODE_ARCH="x64" ;;
  aarch64 | arm64) NODE_ARCH="arm64" ;;
  *)
    echo "[SpecGate] 不支持的架构：$ARCH；请手动安装 Node >= 20.19。" >&2
    exit 1
    ;;
esac
OS_NAME=$(uname -s)
case "$OS_NAME" in
  Linux) NODE_OS="linux" ;;
  Darwin) NODE_OS="darwin" ;;
  *)
    echo "[SpecGate] 不支持的系统：$OS_NAME" >&2
    exit 1
    ;;
esac
PKG_NAME="node-${NODE_VERSION_FALLBACK}-${NODE_OS}-${NODE_ARCH}"
TARBALL="$TOOLCHAINS/$PKG_NAME.tar.gz"
mkdir -p "$TOOLCHAINS"
URL="https://nodejs.org/dist/${NODE_VERSION_FALLBACK}/${PKG_NAME}.tar.gz"
echo "[SpecGate] 下载 $URL"
if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 2 --connect-timeout 30 -o "$TARBALL" "$URL" || TARBALL=""
elif command -v wget >/dev/null 2>&1; then
  wget -O "$TARBALL" "$URL" || TARBALL=""
else
  echo "[SpecGate] 需要 curl 或 wget 才能自动下载 Node。" >&2
  exit 1
fi
if [ -n "$TARBALL" ] && tar -xzf "$TARBALL" -C "$TOOLCHAINS"; then
  rm -rf "$NODE_DIR"
  mv "$TOOLCHAINS/$PKG_NAME" "$NODE_DIR"
  if node_usable "$NODE_DIR/bin/node"; then
    echo "[SpecGate] 已准备便携 Node：$NODE_DIR/bin/node"
    exec "$NODE_DIR/bin/node" "$SCRIPT_DIR/install-env.mjs" "$@"
  fi
fi
echo "[SpecGate] Node 自动准备失败；请手动安装 Node >= 20.19 后重试。" >&2
exit 1
