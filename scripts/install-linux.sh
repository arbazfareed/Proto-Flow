#!/usr/bin/env bash
# Install ProtoFlow on Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/arbazfareed/Proto-Flow/main/scripts/install-linux.sh | bash
#
# It picks the right package for your system:
#   Debian, Ubuntu, Kali, Linux Mint, Pop!_OS, elementary, Zorin, MX, Deepin…  -> .deb (apt)
#   Fedora, RHEL, Rocky, AlmaLinux, CentOS Stream, openSUSE…                   -> .rpm (dnf / zypper)
#   Anything else (Arch, Manjaro, Void, NixOS, Gentoo…)                        -> AppImage in ~/.local
#
# Options:
#   --appimage        Use the AppImage even where a .deb or .rpm would fit.
#   --version vX.Y.Z  Install that release instead of the latest one.
#   --file PATH       Install a package you already downloaded (.deb, .rpm or .AppImage).
#   --uninstall       Remove ProtoFlow.
#   --help            Show this help.
set -euo pipefail

REPO="arbazfareed/Proto-Flow"
APP_NAME="ProtoFlow"
BINARY_NAME="proto-flow"
LOCAL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/protoflow"
LOCAL_BIN="$HOME/.local/bin"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/protoflow.desktop"

say() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'HELP'
Install ProtoFlow on Linux.

  curl -fsSL https://raw.githubusercontent.com/arbazfareed/Proto-Flow/main/scripts/install-linux.sh | bash

Debian, Ubuntu, Kali, Mint, Pop!_OS and similar get the .deb (apt), Fedora, RHEL,
Rocky, AlmaLinux and openSUSE get the .rpm (dnf / zypper), and every other distro
gets the AppImage in ~/.local.

Options (with curl, pass them after "bash -s --"):
  --appimage        Use the AppImage even where a .deb or .rpm would fit.
  --version vX.Y.Z  Install that release instead of the latest one.
  --file PATH       Install a package you already downloaded (.deb, .rpm or .AppImage).
  --uninstall       Remove ProtoFlow.
  --help            Show this help.
HELP
}

FORCE_APPIMAGE=0
VERSION=""
LOCAL_FILE=""
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --appimage) FORCE_APPIMAGE=1 ;;
    --version) VERSION="${2:?--version needs a value, for example v0.2.0}"; shift ;;
    --file) LOCAL_FILE="${2:?--file needs a path}"; shift ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; elif command -v doas >/dev/null 2>&1; then SUDO="doas"; fi
fi
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; elif [ -n "$SUDO" ]; then $SUDO "$@"; else fail "This step needs root. Install sudo, or run the script as root."; fi
}

# Which package family fits this system: deb, rpm or appimage.
detect_family() {
  local id="" like=""
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    id="${ID:-}"; like="${ID_LIKE:-}"
  fi
  case " $id $like " in
    *" debian "*|*" ubuntu "*|*" kali "*|*" linuxmint "*|*" pop "*|*" elementary "*|*" zorin "*|*" deepin "*|*" mx "*|*" raspbian "*)
      command -v apt-get >/dev/null 2>&1 && { echo deb; return; } ;;
    *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*|*" ol "*|*" amzn "*)
      { command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; } && { echo rpm; return; } ;;
    *" suse "*|*" opensuse "*|*" opensuse-leap "*|*" opensuse-tumbleweed "*|*" sles "*)
      command -v zypper >/dev/null 2>&1 && { echo rpm; return; } ;;
  esac
  echo appimage
}

remove_appimage_install() {
  rm -f "$LOCAL_BIN/$BINARY_NAME" "$DESKTOP_FILE"
  rm -rf "$LOCAL_DIR"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
}

if [ "$UNINSTALL" -eq 1 ]; then
  say "Removing $APP_NAME"
  if command -v dpkg >/dev/null 2>&1 && dpkg -s "$BINARY_NAME" >/dev/null 2>&1; then as_root apt-get remove -y "$BINARY_NAME"; fi
  if command -v rpm >/dev/null 2>&1 && rpm -q "$BINARY_NAME" >/dev/null 2>&1; then
    if command -v dnf >/dev/null 2>&1; then as_root dnf remove -y "$BINARY_NAME"; elif command -v zypper >/dev/null 2>&1; then as_root zypper --non-interactive remove "$BINARY_NAME"; else as_root rpm -e "$BINARY_NAME"; fi
  fi
  remove_appimage_install
  say "$APP_NAME has been removed. Your .pflow project files were not touched."
  exit 0
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ;;
  *) fail "ProtoFlow for Linux is currently built for 64-bit Intel/AMD (x86_64) only; this machine is $ARCH." ;;
esac

if [ -n "$LOCAL_FILE" ]; then
  [ -f "$LOCAL_FILE" ] || fail "File not found: $LOCAL_FILE"
  case "$LOCAL_FILE" in
    *.deb) FAMILY=deb ;; *.rpm) FAMILY=rpm ;; *.AppImage|*.appimage) FAMILY=appimage ;;
    *) fail "--file must be a .deb, .rpm or .AppImage file" ;;
  esac
else
  FAMILY="$(detect_family)"
  [ "$FORCE_APPIMAGE" -eq 1 ] && FAMILY=appimage
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

download() {
  if command -v curl >/dev/null 2>&1; then curl -fL --retry 3 --progress-bar -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q --show-progress -O "$2" "$1"
  else fail "Please install curl or wget first."; fi
}
fetch_text() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"; else wget -qO- "$1"; fi
}

if [ -z "$LOCAL_FILE" ]; then
  case "$FAMILY" in
    deb) PATTERN='_amd64\.deb' ;;
    rpm) PATTERN='\.x86_64\.rpm' ;;
    appimage) PATTERN='_amd64\.AppImage' ;;
  esac
  if [ -n "$VERSION" ]; then API="https://api.github.com/repos/$REPO/releases/tags/$VERSION"; else API="https://api.github.com/repos/$REPO/releases/latest"; fi
  say "Looking up the ${VERSION:-latest} $APP_NAME release"
  RELEASE_JSON="$(fetch_text "$API")" || fail "Could not reach GitHub. Check your internet connection, or download a package from https://github.com/$REPO/releases and use --file."
  URL="$(printf '%s\n' "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"/\1/' | grep -E "$PATTERN\$" | head -n 1 || true)"
  [ -n "$URL" ] || fail "This release has no Linux $FAMILY package yet. See https://github.com/$REPO/releases"
  PACKAGE="$WORK/$(basename "$URL")"
  say "Downloading $(basename "$URL")"
  download "$URL" "$PACKAGE"

  SUMS_URL="$(printf '%s\n' "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*SHA256SUMS-linux\.txt"' | sed 's/.*"\(https[^"]*\)"/\1/' | head -n 1 || true)"
  if [ -n "$SUMS_URL" ] && command -v sha256sum >/dev/null 2>&1; then
    download "$SUMS_URL" "$WORK/SHA256SUMS-linux.txt" >/dev/null 2>&1
    EXPECTED="$(grep " $(basename "$PACKAGE")\$" "$WORK/SHA256SUMS-linux.txt" | cut -d' ' -f1 || true)"
    ACTUAL="$(sha256sum "$PACKAGE" | cut -d' ' -f1)"
    [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$ACTUAL" ] && fail "Checksum mismatch for $(basename "$PACKAGE"); the download may be damaged. Please try again."
    [ -n "$EXPECTED" ] && say "Checksum verified"
  fi
else
  PACKAGE="$(cd "$(dirname "$LOCAL_FILE")" && pwd)/$(basename "$LOCAL_FILE")"
fi

case "$FAMILY" in
  deb)
    say "Installing with apt (this also installs WebKitGTK if it is missing)"
    as_root apt-get update -qq || warn "apt-get update failed; trying the install anyway"
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$PACKAGE"
    ;;
  rpm)
    if command -v dnf >/dev/null 2>&1; then
      say "Installing with dnf"
      as_root dnf install -y "$PACKAGE"
    elif command -v zypper >/dev/null 2>&1; then
      say "Installing with zypper"
      as_root zypper --non-interactive install --allow-unsigned-rpm "$PACKAGE"
    else
      say "Installing with yum"
      as_root yum install -y "$PACKAGE"
    fi
    ;;
  appimage)
    say "Installing the AppImage for your user (no root needed)"
    mkdir -p "$LOCAL_DIR" "$LOCAL_BIN" "$(dirname "$DESKTOP_FILE")"
    install -m 755 "$PACKAGE" "$LOCAL_DIR/ProtoFlow.AppImage"
    # Use the icon packed inside the AppImage for the menu entry (best effort).
    if (cd "$WORK" && "$LOCAL_DIR/ProtoFlow.AppImage" --appimage-extract 'usr/share/icons/hicolor/128x128/apps/*.png' >/dev/null 2>&1); then
      ICON="$(find "$WORK/squashfs-root/usr/share/icons" -type f -name '*.png' 2>/dev/null | head -n 1 || true)"
      [ -n "$ICON" ] && install -m 644 "$ICON" "$LOCAL_DIR/protoflow.png" || true
    fi
    # AppImages need FUSE 2; without it, run them by extracting to a temporary folder.
    cat > "$LOCAL_BIN/$BINARY_NAME" <<LAUNCHER
#!/bin/sh
if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then export APPIMAGE_EXTRACT_AND_RUN=1; fi
exec "$LOCAL_DIR/ProtoFlow.AppImage" "\$@"
LAUNCHER
    chmod 755 "$LOCAL_BIN/$BINARY_NAME"
    cat > "$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=Free, local-first prototyping for apps and websites
Exec=$LOCAL_BIN/$BINARY_NAME %U
Icon=$LOCAL_DIR/protoflow.png
Terminal=false
Categories=Graphics;Development;
MimeType=application/x-protoflow+json;x-scheme-handler/protoflow;
StartupWMClass=ProtoFlow
DESKTOP
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
    case ":$PATH:" in *":$LOCAL_BIN:"*) ;; *) warn "$LOCAL_BIN is not on your PATH; open ProtoFlow from your app menu, or add it to PATH." ;; esac
    ;;
esac

if command -v "$BINARY_NAME" >/dev/null 2>&1 || [ -x "$LOCAL_BIN/$BINARY_NAME" ]; then
  say "$APP_NAME is installed. Open it from your app menu, or run: $BINARY_NAME"
else
  fail "The install finished but the $BINARY_NAME command was not found."
fi
