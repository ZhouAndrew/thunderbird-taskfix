#!/usr/bin/env bash
set -euo pipefail

APP_SLUG="thunderbird-taskfix"
BIN="$HOME/.local/bin/$APP_SLUG"
DESKTOP="$HOME/.local/share/applications/$APP_SLUG.desktop"

rm -f "$BIN" "$DESKTOP"
# Remove generated application copies, but intentionally keep the isolated
# profile because it can contain mail/calendar configuration and user data.
find "$HOME/.local/opt" -maxdepth 1 -type d -name "${APP_SLUG}-*" -print0 2>/dev/null | xargs -0r rm -rf --

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

printf '%s\n' "Removed Thunderbird TaskFix application/launcher."
printf '%s\n' "Kept profile data at: $HOME/.local/share/$APP_SLUG/profile"
printf '%s\n' "Delete that directory manually only if you no longer need its data."
