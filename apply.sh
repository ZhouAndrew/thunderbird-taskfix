#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_SLUG="thunderbird-taskfix"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v python3 >/dev/null 2>&1 || die "python3 is required."
command -v cp >/dev/null 2>&1 || die "cp is required."

find_source_dir() {
  local candidates=()
  local cmd real d

  if cmd="$(command -v thunderbird 2>/dev/null)"; then
    real="$(readlink -f "$cmd" 2>/dev/null || printf '%s' "$cmd")"
    d="$(dirname "$real")"
    candidates+=("$d")
  fi

  candidates+=(
    "/usr/lib/thunderbird"
    "/usr/lib/thunderbird-esr"
    "/opt/thunderbird"
  )

  if command -v dpkg >/dev/null 2>&1; then
    while IFS= read -r p; do
      [[ -n "$p" ]] && candidates+=("$(dirname "$p")")
    done < <(dpkg -L thunderbird 2>/dev/null | grep -E '/thunderbird$' || true)
  fi

  local seen="|"
  for d in "${candidates[@]}"; do
    [[ -n "$d" ]] || continue
    case "$seen" in *"|$d|"*) continue ;; esac
    seen+="$d|"
    if [[ -x "$d/thunderbird" && -f "$d/application.ini" ]]; then
      printf '%s\n' "$d"
      return 0
    fi
  done
  return 1
}

SOURCE_DIR="${THUNDERBIRD_DIR:-}"
if [[ -n "$SOURCE_DIR" ]]; then
  SOURCE_DIR="$(readlink -f "$SOURCE_DIR")"
  [[ -x "$SOURCE_DIR/thunderbird" ]] || die "THUNDERBIRD_DIR does not contain an executable thunderbird: $SOURCE_DIR"
else
  SOURCE_DIR="$(find_source_dir)" || die "Could not locate the Linux Mint/DEB Thunderbird installation. Re-run as: THUNDERBIRD_DIR=/path/to/thunderbird ./apply.sh"
fi

VERSION="$(awk -F= '$1 == "Version" {print $2; exit}' "$SOURCE_DIR/application.ini" 2>/dev/null || true)"
[[ -n "$VERSION" ]] || VERSION="unknown"
SAFE_VERSION="$(printf '%s' "$VERSION" | tr -c 'A-Za-z0-9._-' '_')"
TARGET_DIR="$HOME/.local/opt/${APP_SLUG}-${SAFE_VERSION}"
PROFILE_DIR="$HOME/.local/share/${APP_SLUG}/profile"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/$APP_SLUG"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/${APP_SLUG}.desktop"

say "Thunderbird TaskFix installer"
say "  Source : $SOURCE_DIR"
say "  Version: $VERSION"
say "  Copy   : $TARGET_DIR"
say ""

# The target directory contains only generated application files; user data is
# deliberately kept in PROFILE_DIR, so refreshing this copy is safe.
rm -rf "$TARGET_DIR"
mkdir -p "$(dirname "$TARGET_DIR")" "$PROFILE_DIR" "$BIN_DIR" "$DESKTOP_DIR"

say "[1/4] Copying Thunderbird so the system package remains untouched..."
cp -a --reflink=auto --no-preserve=ownership "$SOURCE_DIR" "$TARGET_DIR"

say "[2/4] Applying recurring-safe batch Status/Category patch..."
python3 "$HERE/patch_omnijar.py" "$TARGET_DIR"

say "[3/4] Installing an isolated launcher..."
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
APP="$TARGET_DIR/thunderbird"
PROFILE="$PROFILE_DIR"

if [[ "\${1:-}" == "--system-profile" ]]; then
  shift
  # Use the normal Thunderbird profile. Close the distro Thunderbird first;
  # otherwise Mozilla's remote-instance handling can route the launch to the
  # already-running unpatched process.
  exec "\$APP" -no-remote "\$@"
fi

mkdir -p "\$PROFILE"
exec "\$APP" -no-remote -profile "\$PROFILE" "\$@"
EOF
chmod +x "$LAUNCHER"

ICON="$TARGET_DIR/chrome/icons/default/default128.png"
[[ -f "$ICON" ]] || ICON="thunderbird"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Thunderbird TaskFix $VERSION
Comment=Experimental Thunderbird task batch Status/Category and recurring VTODO fix
Exec=$LAUNCHER %u
Icon=$ICON
Terminal=false
Categories=Network;Email;
StartupNotify=true
EOF
chmod 0644 "$DESKTOP_FILE"

say "[4/4] Verifying the copied executable and patched archive..."
"$TARGET_DIR/thunderbird" --version || die "The copied Thunderbird executable did not start with --version."
python3 "$HERE/patch_omnijar.py" "$TARGET_DIR" >/dev/null

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

say ""
say "Installed successfully."
say ""
say "You now have two application copies:"
say "  1. System Thunderbird: $SOURCE_DIR"
say "  2. TaskFix Thunderbird: $TARGET_DIR"
say ""
say "Safe/default launch (separate profile, can run beside the original):"
say "  $APP_SLUG"
say ""
say "A desktop launcher named 'Thunderbird TaskFix $VERSION' was also created."
say "The isolated profile is: $PROFILE_DIR"
say ""
say "To use your existing Thunderbird profile instead, CLOSE the original Thunderbird first, then run:"
say "  $APP_SLUG --system-profile"
say ""
say "This installer does not modify /usr/lib, /usr/bin, APT, or your original Thunderbird profile."
