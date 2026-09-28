#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_SLUG="thunderbird-taskfix-clean"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v python3 >/dev/null 2>&1 || die "python3 is required."
command -v cp >/dev/null 2>&1 || die "cp is required."

# Copying a live Thunderbird profile can leave SQLite/WAL files inconsistent.
if pgrep -f '(^|/)(thunderbird|thunderbird-bin)( |$)' >/dev/null 2>&1; then
  die "Thunderbird is running. Close every Thunderbird window/process, then run this installer again."
fi

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

find_default_profile() {
  python3 - "$HOME/.thunderbird/profiles.ini" <<'PY'
from __future__ import annotations

import configparser
import sys
from pathlib import Path

ini = Path(sys.argv[1]).expanduser()
if not ini.is_file():
    raise SystemExit(2)

cfg = configparser.RawConfigParser()
cfg.read(ini, encoding="utf-8")
base = ini.parent

def resolve(path: str, relative: str | None) -> Path:
    p = Path(path).expanduser()
    if relative == "1":
        p = base / p
    return p.resolve()

# Thunderbird's [Install*] Default is the strongest signal for the profile
# currently selected by this installation.
for section in cfg.sections():
    if not section.startswith("Install"):
        continue
    path = cfg.get(section, "Default", fallback="").strip()
    if path:
        p = resolve(path, "1" if not Path(path).is_absolute() else "0")
        if p.is_dir():
            print(p)
            raise SystemExit(0)

# Fallback to the profile explicitly marked Default=1.
for section in cfg.sections():
    if not section.startswith("Profile"):
        continue
    if cfg.get(section, "Default", fallback="0").strip() != "1":
        continue
    path = cfg.get(section, "Path", fallback="").strip()
    if path:
        p = resolve(path, cfg.get(section, "IsRelative", fallback="1").strip())
        if p.is_dir():
            print(p)
            raise SystemExit(0)

# Last fallback: first existing Profile path.
for section in cfg.sections():
    if not section.startswith("Profile"):
        continue
    path = cfg.get(section, "Path", fallback="").strip()
    if path:
        p = resolve(path, cfg.get(section, "IsRelative", fallback="1").strip())
        if p.is_dir():
            print(p)
            raise SystemExit(0)

raise SystemExit(3)
PY
}

SOURCE_DIR="${THUNDERBIRD_DIR:-}"
if [[ -n "$SOURCE_DIR" ]]; then
  SOURCE_DIR="$(readlink -f "$SOURCE_DIR")"
  [[ -x "$SOURCE_DIR/thunderbird" ]] || die "THUNDERBIRD_DIR does not contain an executable thunderbird: $SOURCE_DIR"
else
  SOURCE_DIR="$(find_source_dir)" || die "Could not locate the Linux Mint/DEB Thunderbird installation."
fi

SOURCE_PROFILE="${THUNDERBIRD_PROFILE:-}"
if [[ -n "$SOURCE_PROFILE" ]]; then
  SOURCE_PROFILE="$(readlink -f "$SOURCE_PROFILE")"
  [[ -d "$SOURCE_PROFILE" ]] || die "THUNDERBIRD_PROFILE is not a directory: $SOURCE_PROFILE"
else
  SOURCE_PROFILE="$(find_default_profile)" || die "Could not locate the current Thunderbird profile from ~/.thunderbird/profiles.ini"
fi

VERSION="$(awk -F= '$1 == "Version" {print $2; exit}' "$SOURCE_DIR/application.ini" 2>/dev/null || true)"
[[ -n "$VERSION" ]] || VERSION="unknown"
SAFE_VERSION="$(printf '%s' "$VERSION" | tr -c 'A-Za-z0-9._-' '_')"
TARGET_DIR="$HOME/.local/opt/${APP_SLUG}-${SAFE_VERSION}"
PROFILE_ROOT="$HOME/.local/share/${APP_SLUG}"
PROFILE_DIR="$PROFILE_ROOT/profile"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/$APP_SLUG"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/${APP_SLUG}.desktop"
STAMP="$(date +%Y%m%d-%H%M%S)"

say "Thunderbird TaskFix Clean installer"
say "  Thunderbird source : $SOURCE_DIR"
say "  Thunderbird version: $VERSION"
say "  Data source profile: $SOURCE_PROFILE"
say "  Clean app copy     : $TARGET_DIR"
say "  Clean data copy    : $PROFILE_DIR"
say ""

rm -rf "$TARGET_DIR"
mkdir -p "$(dirname "$TARGET_DIR")" "$PROFILE_ROOT" "$BIN_DIR" "$DESKTOP_DIR"

if [[ -d "$PROFILE_DIR" && -n "$(find "$PROFILE_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  BACKUP_DIR="$PROFILE_ROOT/profile.backup-$STAMP"
  say "[1/5] Preserving previous TaskFix Clean profile as:"
  say "      $BACKUP_DIR"
  mv "$PROFILE_DIR" "$BACKUP_DIR"
fi
mkdir -p "$PROFILE_DIR"

say "[2/5] Creating a clean Thunderbird application copy..."
cp -a --reflink=auto --no-preserve=ownership "$SOURCE_DIR" "$TARGET_DIR"

say "[3/5] Copying your CURRENT Thunderbird profile data into the clean copy..."
cp -a --reflink=auto "$SOURCE_PROFILE/." "$PROFILE_DIR/"
rm -f   "$PROFILE_DIR/lock"   "$PROFILE_DIR/.parentlock"   "$PROFILE_DIR/parent.lock"   "$PROFILE_DIR/SingletonLock"   "$PROFILE_DIR/SingletonCookie"   "$PROFILE_DIR/SingletonSocket" 2>/dev/null || true
rm -rf "$PROFILE_DIR/startupCache" 2>/dev/null || true

cat > "$PROFILE_ROOT/source-profile.txt" <<EOF
Copied at: $(date -Is)
Source profile: $SOURCE_PROFILE
Thunderbird source: $SOURCE_DIR
Thunderbird version: $VERSION
EOF

say "[4/5] Applying ONLY the TaskFix recurring-safe patch..."
python3 "$HERE/patch_omnijar.py" "$TARGET_DIR"

say "[5/5] Installing the clean launcher..."
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
APP="$TARGET_DIR/thunderbird"
PROFILE="$PROFILE_DIR"
exec "\$APP" -no-remote -profile "\$PROFILE" "\$@"
EOF
chmod +x "$LAUNCHER"

ICON="$TARGET_DIR/chrome/icons/default/default128.png"
[[ -f "$ICON" ]] || ICON="thunderbird"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Thunderbird TaskFix Clean $VERSION
Comment=Clean TaskFix Thunderbird with a copied snapshot of your existing profile data
Exec=$LAUNCHER %u
Icon=$ICON
Terminal=false
Categories=Network;Email;
StartupNotify=true
EOF
chmod 0644 "$DESKTOP_FILE"

"$TARGET_DIR/thunderbird" --version || die "The copied Thunderbird executable did not start with --version."
python3 "$HERE/patch_omnijar.py" "$TARGET_DIR" >/dev/null

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

say ""
say "READY."
say "This is a CLEAN side-by-side TaskFix copy WITH YOUR DATA."
say "Original Thunderbird app/profile were not modified."
say ""
say "Launcher:"
say "  $LAUNCHER"
say "Desktop entry:"
say "  Thunderbird TaskFix Clean $VERSION"
say "Copied profile:"
say "  $PROFILE_DIR"
say ""
say "Start it with:"
say "  thunderbird-taskfix-clean"
