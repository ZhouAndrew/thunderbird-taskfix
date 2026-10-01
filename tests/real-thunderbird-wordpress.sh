#!/usr/bin/env bash
set -euo pipefail

TB_VERSION="${1:-153.1.0esr}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
TB_PID=""
XVFB_PID=""
REPORT_PID=""
WM_PID=""

cleanup() {
  set +e
  [[ -n "$TB_PID" ]] && kill "$TB_PID" 2>/dev/null || true
  [[ -n "$XVFB_PID" ]] && kill "$XVFB_PID" 2>/dev/null || true
  [[ -n "$REPORT_PID" ]] && kill "$REPORT_PID" 2>/dev/null || true
  [[ -n "$WM_PID" ]] && kill "$WM_PID" 2>/dev/null || true
  docker rm -f caldav-tb-wp-web caldav-tb-wp-db 2>/dev/null || true
  docker volume rm caldav-tb-wp-data 2>/dev/null || true
  docker network rm caldav-tb-wp-net 2>/dev/null || true
  if [[ -n "${ACCEPTANCE_ARTIFACT_DIR:-}" ]]; then
    mkdir -p "$ACCEPTANCE_ARTIFACT_DIR"
    for candidate in "$TMP/report.json" "$TMP/thunderbird.stdout" "$TMP/thunderbird.stderr" "$TMP/wordpress-web.log" "$TMP/wordpress-db.log" "$TMP/xvfb.log" "$TMP/openbox.log"; do
      [[ -f "$candidate" ]] && cp "$candidate" "$ACCEPTANCE_ARTIFACT_DIR/" || true
    done
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "== Start isolated real WordPress =="
docker network create caldav-tb-wp-net >/dev/null
docker volume create caldav-tb-wp-data >/dev/null

docker run -d --name caldav-tb-wp-db \
  --network caldav-tb-wp-net \
  -e MARIADB_DATABASE=wordpress \
  -e MARIADB_USER=wordpress \
  -e MARIADB_PASSWORD=wordpress \
  -e MARIADB_ROOT_PASSWORD=root \
  mariadb:11.4 >/dev/null

for _ in $(seq 1 120); do
  if docker exec caldav-tb-wp-db mariadb-admin ping -uroot -proot --silent >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec caldav-tb-wp-db mariadb-admin ping -uroot -proot --silent

docker run -d --name caldav-tb-wp-web \
  --network caldav-tb-wp-net \
  -p 8080:80 \
  -v caldav-tb-wp-data:/var/www/html \
  -e WORDPRESS_DB_HOST=caldav-tb-wp-db:3306 \
  -e WORDPRESS_DB_USER=wordpress \
  -e WORDPRESS_DB_PASSWORD=wordpress \
  -e WORDPRESS_DB_NAME=wordpress \
  -e "WORDPRESS_CONFIG_EXTRA=define('WP_ENVIRONMENT_TYPE','local');" \
  wordpress:latest >/dev/null

for _ in $(seq 1 120); do
  if docker exec caldav-tb-wp-web test -f /var/www/html/wp-config.php; then
    break
  fi
  sleep 1
done
docker exec caldav-tb-wp-web test -f /var/www/html/wp-config.php

WPCLI=(docker run --rm --network caldav-tb-wp-net -v caldav-tb-wp-data:/var/www/html -e WORDPRESS_DB_HOST=caldav-tb-wp-db:3306 -e WORDPRESS_DB_USER=wordpress -e WORDPRESS_DB_PASSWORD=wordpress -e WORDPRESS_DB_NAME=wordpress wordpress:cli)
"${WPCLI[@]}" --path=/var/www/html core install \
  --url=http://localhost:8080 \
  --title="Thunderbird WordPress Acceptance" \
  --admin_user=wp_user \
  --admin_password=admin-test-only \
  --admin_email=acceptance@example.test \
  --skip-email >/dev/null

for _ in $(seq 1 120); do
  if curl -fsS http://localhost:8080/wp-json/ >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS http://localhost:8080/wp-json/ >/dev/null
docker exec caldav-tb-wp-web chown -R www-data:www-data /var/www/html
"${WPCLI[@]}" --path=/var/www/html rewrite structure '/%postname%/' --hard >/dev/null
"${WPCLI[@]}" --path=/var/www/html rewrite flush --hard >/dev/null
APP_PASS="$("${WPCLI[@]}" --path=/var/www/html user application-password create wp_user "Thunderbird CI" --porcelain)"
test -n "$APP_PASS"
WP_AUTH="$(printf 'wp_user:%s' "$APP_PASS" | base64 -w0)"
curl -fsS \
  -H "Authorization: Basic $WP_AUTH" \
  "http://localhost:8080/wp-json/wp/v2/users/me?context=edit" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("id")==1 and d.get("slug")=="wp_user", d'
echo "PASS: real WordPress + real Application Password prepared"

echo "== Build production and instrumented XPI =="
chmod +x "$ROOT/packaging/build-xpi.sh"
"$ROOT/packaging/build-xpi.sh" "$TMP/base.xpi"
python3 "$ROOT/tests/check-xpi.py" "$TMP/base.xpi"
mkdir -p "$TMP/addon"
(cd "$TMP/addon" && unzip -q "$TMP/base.xpi")

python3 - "$TMP/addon" "$APP_PASS" <<'PY'
from pathlib import Path
import json
import sys

root = Path(sys.argv[1])
app_password = sys.argv[2]
manifest_path = root / "manifest.json"
manifest = json.loads(manifest_path.read_text())
permissions = manifest.setdefault("permissions", [])
report_host = "http://127.0.0.1/*"
if report_host not in permissions:
    permissions.append(report_host)
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

tools = root / "tools.js"
tools.write_text(tools.read_text() + r'''

const __WP_ACCEPTANCE_REPORT = "http://127.0.0.1:8766";
async function __wpAcceptPost(path, payload = {}) {
  await fetch(__WP_ACCEPTANCE_REPORT + path, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
  });
}
async function __wpAcceptWaitReceipt(action, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await AssistantStorage.getLastReceipt();
    if (receipt?.action === action) return receipt;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("timeout waiting for " + action);
}
async function __runRealWordPressAcceptance() {
  await new Promise(resolve => setTimeout(resolve, 1000));
  $("wp-url").value = "http://localhost:8080";
  $("wp-user").value = "wp_user";
  $("wp-password").value = __WP_APP_PASSWORD__;

  const quick = $("wp-quick");
  quick.style.position = "fixed";
  quick.style.left = "24px";
  quick.style.top = "24px";
  quick.style.zIndex = "999999";
  quick.focus();
  quick.addEventListener("click", () => {
    void __wpAcceptPost("/quick-clicked");
  }, {once: true});
  const quickRect = quick.getBoundingClientRect();
  await __wpAcceptPost("/quick-geometry", {
    innerScreenX: window.mozInnerScreenX,
    innerScreenY: window.mozInnerScreenY,
    x: quickRect.x,
    y: quickRect.y,
    width: quickRect.width,
    height: quickRect.height,
  });
  await __wpAcceptPost("/quick-ready");

  const quickResult = await __wpAcceptWaitReceipt("connection.wordpress-quick");
  if (!quickResult.success) {
    throw new Error("quick test failed: " + (quickResult.summary || JSON.stringify(quickResult)));
  }
  if (!(await browser.permissions.contains({origins: ["http://localhost:8080/*"]}))) {
    throw new Error("optional WordPress host permission was not granted");
  }

  const full = $("wp-full");
  full.style.position = "fixed";
  full.style.left = "24px";
  full.style.top = "24px";
  full.style.zIndex = "999999";
  full.focus();
  const fullRect = full.getBoundingClientRect();
  await __wpAcceptPost("/full-geometry", {
    innerScreenX: window.mozInnerScreenX,
    innerScreenY: window.mozInnerScreenY,
    x: fullRect.x,
    y: fullRect.y,
    width: fullRect.width,
    height: fullRect.height,
  });
  await __wpAcceptPost("/full-ready");

  const fullResult = await __wpAcceptWaitReceipt("connection.wordpress-full-write", 45000);
  if (!fullResult.success) {
    throw new Error("full test failed: " + (fullResult.summary || JSON.stringify(fullResult)));
  }
  if (!fullResult.steps.some(step => step.name === "update + read-back TEST post")) {
    throw new Error("full test did not verify post update read-back");
  }
  if (!fullResult.steps.some(step => step.name === "read TEST media")) {
    throw new Error("full test did not verify media read-back");
  }

  await __wpAcceptPost("/report", {
    ok: true,
    quick: true,
    permissionGranted: true,
    fullWrite: true,
    cleanup: true,
  });
}
setTimeout(() => {
  __runRealWordPressAcceptance().catch(async error => {
    await __wpAcceptPost("/report", {
      ok: false,
      error: (error?.message || String(error)) + (error?.stack ? "\n" + error.stack : ""),
    });
  });
}, 500);
'''.replace("__WP_APP_PASSWORD__", json.dumps(app_password)) + "\n")

background = root / "background.js"
background.write_text(background.read_text() + r'''
setTimeout(() => {
  browser.windows.create({
    url: browser.runtime.getURL("tools.html#wordpress"),
    type: "popup",
    width: 900,
    height: 700,
  });
}, 1500);
''' + "\n")
PY

(cd "$TMP/addon" && zip -qr "$TMP/acceptance.xpi" .)

echo "== Start acceptance report endpoint =="
cat >"$TMP/report_server.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys

root = Path(sys.argv[1])
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length)
        name = self.path.strip("/") or "unknown"
        if name == "report":
            (root / "report.json").write_bytes(data)
        else:
            (root / name).write_bytes(data)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
    def log_message(self, *_args):
        pass

HTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
PY
python3 "$TMP/report_server.py" "$TMP" >/dev/null 2>&1 &
REPORT_PID=$!

echo "== Download official Thunderbird $TB_VERSION =="
curl -fL --retry 3 --retry-delay 2 \
  "https://archive.mozilla.org/pub/thunderbird/releases/$TB_VERSION/linux-x86_64/en-US/thunderbird-$TB_VERSION.tar.xz" \
  -o "$TMP/thunderbird.tar.xz"
tar -xJf "$TMP/thunderbird.tar.xz" -C "$TMP"

PROFILE="$TMP/profile"
mkdir -p "$PROFILE/extensions"
EXT_ID='ZhouAndrew.thunderbird-taskfix-lab@addons.thunderbird.net'
cp "$TMP/acceptance.xpi" "$PROFILE/extensions/$EXT_ID.xpi"
cat >"$PROFILE/user.js" <<'EOF'
user_pref("app.update.enabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("xpinstall.signatures.required", false);
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("mailnews.start_page.override_url", "about:blank");
user_pref("mailnews.start_page.url", "about:blank");
EOF

echo "== Start real Thunderbird under Xvfb =="
Xvfb :99 -screen 0 1280x1024x24 >"$TMP/xvfb.log" 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
sleep 0.5
openbox --sm-disable >"$TMP/openbox.log" 2>&1 &
WM_PID=$!
sleep 0.5
kill -0 "$WM_PID"
"$TMP/thunderbird/thunderbird" -no-remote -profile "$PROFILE" >"$TMP/thunderbird.stdout" 2>"$TMP/thunderbird.stderr" &
TB_PID=$!

for _ in $(seq 1 300); do
  [[ -f "$TMP/quick-ready" ]] && break
  sleep 0.1
done
[[ -f "$TMP/quick-ready" ]] || { echo "Tools did not become ready"; exit 1; }

echo "== Native keypress: start permissions.request from a real user event =="
WIN="$(xdotool search --onlyvisible --name 'CalDAV Assistant.*工具' | tail -n1 || true)"
if [[ -z "$WIN" ]]; then
  WIN="$(xdotool search --onlyvisible --pid "$TB_PID" | tail -n1)"
fi
test -n "$WIN"
echo "WordPress tools popup window: $WIN"
xdotool getwindowgeometry "$WIN" || true

# The acceptance copy fixes wp-quick at left:24px/top:24px in a popup window.
# This is a real X mouse event, so Thunderbird's user-activation bookkeeping
# sees the same kind of click as a person pressing the button.
# Firefox exposes the exact content viewport origin through mozInnerScreenX/Y.
# Use that plus the real DOM button rectangle, then issue a native absolute X click.
# This avoids guessing title-bar/frame sizes and still satisfies the user-gesture gate.
read CLICK_X CLICK_Y < <(python3 - "$TMP/quick-geometry" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
print(
    round(d["innerScreenX"] + d["x"] + d["width"]/2),
    round(d["innerScreenY"] + d["y"] + d["height"]/2),
)
PY
)
echo "wp-quick absolute click: $CLICK_X,$CLICK_Y"
xdotool mousemove "$CLICK_X" "$CLICK_Y" click 1
for _ in $(seq 1 50); do
  [[ -f "$TMP/quick-clicked" ]] && break
  sleep 0.1
done
[[ -f "$TMP/quick-clicked" ]] || { echo "Native click did not reach wp-quick"; exit 1; }
sleep 1
# Approve Thunderbird's optional host-permission doorhanger.
xdotool key Return

for _ in $(seq 1 300); do
  [[ -f "$TMP/full-ready" ]] && break
  [[ -s "$TMP/report.json" ]] && break
  sleep 0.1
done
if [[ -s "$TMP/report.json" && ! -f "$TMP/full-ready" ]]; then
  cat "$TMP/report.json"
  exit 1
fi
[[ -f "$TMP/full-ready" ]] || { echo "Quick WordPress acceptance did not complete"; exit 1; }

echo "== Native mouse click: run real full WordPress write/read/update/media/delete =="
read FULL_X FULL_Y < <(python3 - "$TMP/full-geometry" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
print(
    round(d["innerScreenX"] + d["x"] + d["width"]/2),
    round(d["innerScreenY"] + d["y"] + d["height"]/2),
)
PY
)
echo "wp-full absolute click: $FULL_X,$FULL_Y"
xdotool mousemove "$FULL_X" "$FULL_Y" click 1

for _ in $(seq 1 600); do
  [[ -s "$TMP/report.json" ]] && break
  sleep 0.1
done
[[ -s "$TMP/report.json" ]] || { echo "No acceptance report"; exit 1; }

python3 - "$TMP/report.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
assert data.get("ok") is True, data
for key in ("quick", "permissionGranted", "fullWrite", "cleanup"):
    assert data.get(key) is True, (key, data)
print("REAL THUNDERBIRD + REAL WORDPRESS APPLICATION PASSWORD ACCEPTANCE: PASS")
PY

docker logs caldav-tb-wp-web >"$TMP/wordpress-web.log" 2>&1 || true
docker logs caldav-tb-wp-db >"$TMP/wordpress-db.log" 2>&1 || true
