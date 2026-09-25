#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.3.0~lab1}"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUTDIR="$HERE/dist"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/DEBIAN" "$ROOT/usr/bin" "$ROOT/usr/lib/thunderbird-taskfix-lab/patches" "$ROOT/usr/share/applications" "$OUTDIR"

cat > "$ROOT/DEBIAN/control" <<EOF
Package: thunderbird-taskfix-lab
Version: $VERSION
Section: mail
Priority: optional
Architecture: all
Depends: python3, coreutils
Maintainer: Thunderbird TaskFix Lab <noreply@example.invalid>
Description: Experimental isolated Thunderbird task batch-fix build
 Installs an independent launcher and patch resources for Thunderbird TaskFix Lab.
 The system Thunderbird and any existing stable thunderbird-taskfix installation
 are left untouched. On first launch, a private patched application copy is
 created under the current user's ~/.local/opt directory with its own profile.
EOF

cat > "$ROOT/usr/bin/thunderbird-taskfix-lab" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
APP_SLUG="thunderbird-taskfix-lab"
RESOURCE_DIR="/usr/lib/thunderbird-taskfix-lab"
PROFILE_DIR="$HOME/.local/share/$APP_SLUG/profile"
OPT_DIR="$HOME/.local/opt"
PACKAGE_VERSION="__PACKAGE_VERSION__"

say(){ printf '%s\n' "$*"; }
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }

find_source_dir() {
  local candidates=() cmd real d p seen="|"
  if cmd="$(command -v thunderbird 2>/dev/null)"; then
    real="$(readlink -f "$cmd" 2>/dev/null || printf '%s' "$cmd")"
    candidates+=("$(dirname "$real")")
  fi
  candidates+=("/usr/lib/thunderbird" "/usr/lib/thunderbird-esr" "/opt/thunderbird")
  if command -v dpkg >/dev/null 2>&1; then
    while IFS= read -r p; do [[ -n "$p" ]] && candidates+=("$(dirname "$p")"); done < <(dpkg -L thunderbird 2>/dev/null | grep -E '/thunderbird$' || true)
    while IFS= read -r p; do [[ -n "$p" ]] && candidates+=("$(dirname "$p")"); done < <(dpkg -L thunderbird-esr 2>/dev/null | grep -E '/thunderbird$' || true)
  fi
  for d in "${candidates[@]}"; do
    [[ -n "$d" ]] || continue
    case "$seen" in *"|$d|"*) continue ;; esac
    seen+="$d|"
    if [[ -x "$d/thunderbird" && -f "$d/application.ini" ]]; then printf '%s\n' "$d"; return 0; fi
  done
  return 1
}

SOURCE_DIR="${THUNDERBIRD_DIR:-}"
if [[ -n "$SOURCE_DIR" ]]; then
  SOURCE_DIR="$(readlink -f "$SOURCE_DIR")"
  [[ -x "$SOURCE_DIR/thunderbird" ]] || die "THUNDERBIRD_DIR does not contain an executable thunderbird: $SOURCE_DIR"
else
  SOURCE_DIR="$(find_source_dir)" || die "Could not locate Thunderbird. Install Thunderbird first, or set THUNDERBIRD_DIR=/path/to/thunderbird."
fi

VERSION="$(awk -F= '$1 == "Version" {print $2; exit}' "$SOURCE_DIR/application.ini" 2>/dev/null || true)"
[[ -n "$VERSION" ]] || VERSION="unknown"
SAFE_VERSION="$(printf '%s' "$VERSION" | tr -c 'A-Za-z0-9._-' '_')"
TARGET_DIR="$OPT_DIR/${APP_SLUG}-${SAFE_VERSION}"
MARKER="$TARGET_DIR/.taskfix-lab-build"
EXPECTED_MARKER="package=$PACKAGE_VERSION\nsource=$SOURCE_DIR\nversion=$VERSION"

case "${1:-}" in
  --remove-local)
    find "$OPT_DIR" -maxdepth 1 -type d -name "${APP_SLUG}-*" -print0 2>/dev/null | xargs -0r rm -rf --
    say "Removed TaskFix Lab application copies."
    say "Kept Lab profile: $PROFILE_DIR"
    exit 0
    ;;
  --about)
    say "Thunderbird TaskFix Lab $PACKAGE_VERSION"
    say "System source : $SOURCE_DIR"
    say "Lab app       : $TARGET_DIR"
    say "Lab profile   : $PROFILE_DIR"
    exit 0
    ;;
  --rebuild)
    rm -rf "$TARGET_DIR"; shift
    ;;
esac

needs_build=1
if [[ -x "$TARGET_DIR/thunderbird" && -f "$MARKER" ]] && [[ "$(cat "$MARKER")" == "$EXPECTED_MARKER" ]]; then needs_build=0; fi

if [[ $needs_build -eq 1 ]]; then
  mkdir -p "$OPT_DIR" "$PROFILE_DIR"
  tmp="$(mktemp -d "$OPT_DIR/.thunderbird-taskfix-lab.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  say "Preparing isolated Thunderbird TaskFix Lab $VERSION..."
  cp -a --reflink=auto --no-preserve=ownership "$SOURCE_DIR/." "$tmp/"
  python3 "$RESOURCE_DIR/patch_omnijar.py" "$tmp"
  printf '%b\n' "$EXPECTED_MARKER" > "$tmp/.taskfix-lab-build"
  rm -rf "$TARGET_DIR"
  mv "$tmp" "$TARGET_DIR"
  trap - EXIT
fi

mkdir -p "$PROFILE_DIR"
if [[ "${1:-}" == "--system-profile" ]]; then
  shift
  exec "$TARGET_DIR/thunderbird" -no-remote "$@"
fi
exec "$TARGET_DIR/thunderbird" -no-remote -profile "$PROFILE_DIR" "$@"
EOF
sed -i "s/__PACKAGE_VERSION__/$VERSION/" "$ROOT/usr/bin/thunderbird-taskfix-lab"
chmod 0755 "$ROOT/usr/bin/thunderbird-taskfix-lab"

cp "$HERE/patch_omnijar.py" "$ROOT/usr/lib/thunderbird-taskfix-lab/"
cp "$HERE"/patches/* "$ROOT/usr/lib/thunderbird-taskfix-lab/patches/"
chmod 0755 "$ROOT/usr/lib/thunderbird-taskfix-lab/patch_omnijar.py"
chmod 0644 "$ROOT/usr/lib/thunderbird-taskfix-lab/patches/"*

cat > "$ROOT/usr/share/applications/thunderbird-taskfix-lab.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Thunderbird TaskFix Lab
Comment=Experimental isolated Thunderbird task batch-fix build
Exec=thunderbird-taskfix-lab %u
Icon=thunderbird
Terminal=false
Categories=Network;Email;
StartupNotify=true
EOF

find "$ROOT" -type d -exec chmod g-s {} +
dpkg-deb --root-owner-group --build "$ROOT" "$OUTDIR/thunderbird-taskfix-lab_${VERSION}_all.deb"
echo "$OUTDIR/thunderbird-taskfix-lab_${VERSION}_all.deb"
