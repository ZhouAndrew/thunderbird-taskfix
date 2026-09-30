#!/usr/bin/env bash
set -euo pipefail

TB_VERSION="${1:-153.0.2esr}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
TB_PID=""
RADICALE_PID=""
REPORT_PID=""

cleanup() {
  set +e
  [[ -n "$TB_PID" ]] && kill "$TB_PID" 2>/dev/null || true
  [[ -n "$REPORT_PID" ]] && kill "$REPORT_PID" 2>/dev/null || true
  [[ -n "$RADICALE_PID" ]] && kill "$RADICALE_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "== Build production XPI =="
chmod +x "$ROOT/packaging/build-xpi.sh"
"$ROOT/packaging/build-xpi.sh" "$TMP/base.xpi"
python3 "$ROOT/tests/check-xpi.py" "$TMP/base.xpi"

echo "== Build test-instrumented XPI =="
mkdir -p "$TMP/addon"
(
  cd "$TMP/addon"
  unzip -q "$TMP/base.xpi"
)
python3 - "$TMP/addon" <<'PY'
from pathlib import Path
import json
import sys

root = Path(sys.argv[1])
manifest_path = root / "manifest.json"
manifest = json.loads(manifest_path.read_text())
permissions = manifest.setdefault("permissions", [])
host = "http://127.0.0.1/*"
if host not in permissions:
    permissions.append(host)
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

acceptance = r'''
const __ACCEPTANCE_REPORT = "http://127.0.0.1:8765/report";
let __acceptanceStage = "startup";

function __acceptanceAssert(condition, message) {
  if (!condition) throw new Error(message);
}

function __acceptanceDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function __acceptanceReport(payload) {
  await fetch(__ACCEPTANCE_REPORT, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
  });
}

async function __waitForAcceptanceCalendar() {
  for (let attempt = 0; attempt < 120; attempt++) {
    const calendars = await browser.ThunderbirdCalDAV.listCalendars();
    const calendar = calendars.find(item => item.id === "acceptance-calendar");
    if (calendar && !calendar.disabled) {
      const tasks = await browser.ThunderbirdCalDAV.listTasks(calendar.id);
      if (tasks.some(task => task.id === "seed-task")) {
        return calendar;
      }
    }
    await __acceptanceDelay(250);
  }
  throw new Error("Timed out waiting for Thunderbird CalDAV provider to load seed VTODO");
}

async function __runRealAcceptance() {
  __acceptanceStage = "spaces-query";
  const spaces = await browser.spaces.query({
    isSelfOwned: true,
    name: "thunderbird_caldav_lab",
  });
  __acceptanceAssert(spaces.length === 1, "Thunderbird CalDAV Space was not created");

  __acceptanceStage = "workspace-open";
  const workspaceTab = await browser.tabs.create({
    url: browser.runtime.getURL("workspace.html"),
  });
  __acceptanceAssert(Boolean(workspaceTab?.id), "Workspace tab could not be opened");
  await __acceptanceDelay(800);

  __acceptanceStage = "wait-calendar-seed";
  const calendar = await __waitForAcceptanceCalendar();
  __acceptanceAssert(calendar.type === "caldav", "Configured calendar is not CalDAV");
  __acceptanceAssert(!calendar.readOnly, "Configured CalDAV calendar became read-only");
  __acceptanceAssert(calendar.supportsTasks, "CalDAV calendar does not support VTODO");
  __acceptanceAssert(calendar.supportsEvents, "CalDAV calendar does not support VEVENT");

  __acceptanceStage = "list-seed-task";
  let tasks = await browser.ThunderbirdCalDAV.listTasks(calendar.id);
  __acceptanceAssert(
    tasks.some(task => task.id === "seed-task" && task.title === "Seed task from Radicale"),
    "Seed VTODO was not read through Thunderbird"
  );

  __acceptanceStage = "create-task";
  const createdTask = await browser.ThunderbirdCalDAV.createTask(calendar.id, {
    title: "Runtime Task",
    due: "2026-10-05",
    status: "NEEDS-ACTION",
    priority: 5,
    categories: ["Acceptance", "Direct"],
    description: "Created by real Thunderbird 153 acceptance",
  });
  __acceptanceAssert(createdTask.id, "Created task has no UID");
  __acceptanceAssert(createdTask.due?.icalString === "20261005", "Task due date was not preserved");

  __acceptanceStage = "update-task";
  const updatedTask = await browser.ThunderbirdCalDAV.updateTask(calendar.id, createdTask.id, {
    title: "Runtime Task Updated",
    status: "IN-PROCESS",
    percentComplete: 40,
    priority: 1,
    due: "2026-10-06",
    categories: ["Acceptance", "Updated"],
  });
  __acceptanceAssert(updatedTask.status === "IN-PROCESS", "Task status update failed");
  __acceptanceAssert(updatedTask.percentComplete === 40, "Task progress update failed");
  __acceptanceAssert(updatedTask.priority === 1, "Task priority update failed");

  __acceptanceStage = "complete-task";
  const completedTask = await browser.ThunderbirdCalDAV.updateTask(calendar.id, createdTask.id, {
    status: "COMPLETED",
  });
  __acceptanceAssert(completedTask.completed, "Task completion failed");
  __acceptanceAssert(completedTask.status === "COMPLETED", "Completed task status mismatch");

  tasks = await browser.ThunderbirdCalDAV.listTasks(calendar.id);
  __acceptanceAssert(
    tasks.some(task => task.id === createdTask.id && task.status === "COMPLETED"),
    "Completed task was not re-read from Thunderbird"
  );

  __acceptanceStage = "create-event";
  const event = await browser.ThunderbirdCalDAV.createEvent(calendar.id, {
    title: "Runtime Event",
    start: "2026-10-05T09:00",
    end: "2026-10-05T10:00",
    categories: ["Acceptance"],
    description: "Created by real Thunderbird 153 acceptance",
  });
  __acceptanceAssert(event.id, "Created event has no UID");

  __acceptanceStage = "list-event";
  let events = await browser.ThunderbirdCalDAV.listEvents(
    calendar.id,
    "2026-10-05",
    "2026-10-06"
  );
  __acceptanceAssert(
    events.some(item => item.id === event.id),
    "Created VEVENT was not re-read from Thunderbird"
  );

  __acceptanceStage = "update-event";
  const updatedEvent = await browser.ThunderbirdCalDAV.updateEvent(calendar.id, event.id, {
    title: "Runtime Event Updated",
    start: "2026-10-05T11:00",
    end: "2026-10-05T12:30",
    categories: ["Acceptance", "Updated"],
    description: "Updated through Thunderbird calendar provider",
  });
  __acceptanceAssert(updatedEvent.title === "Runtime Event Updated", "Event title update failed");
  __acceptanceAssert(
    updatedEvent.start?.icalString === "20261005T110000",
    "Event start update failed"
  );

  __acceptanceStage = "invalid-event-validation";
  let rejected = false;
  try {
    await browser.ThunderbirdCalDAV.updateEvent(calendar.id, event.id, {
      start: "2026-10-05T14:00",
      end: "2026-10-05T13:00",
    });
  } catch (error) {
    rejected = /end must not be before/i.test(error?.message || String(error));
  }
  __acceptanceAssert(rejected, "Invalid backwards event was not rejected");

  __acceptanceStage = "delete-task-event";
  await browser.ThunderbirdCalDAV.deleteTask(calendar.id, createdTask.id);
  await browser.ThunderbirdCalDAV.deleteEvent(calendar.id, event.id);

  tasks = await browser.ThunderbirdCalDAV.listTasks(calendar.id);
  events = await browser.ThunderbirdCalDAV.listEvents(
    calendar.id,
    "2026-10-05",
    "2026-10-06"
  );
  __acceptanceAssert(
    !tasks.some(task => task.id === createdTask.id),
    "Deleted task still exists"
  );
  __acceptanceAssert(
    !events.some(item => item.id === event.id),
    "Deleted event still exists"
  );

  return {
    ok: true,
    thunderbirdCalDAV: true,
    calendar,
    seedTaskRead: true,
    taskCrud: true,
    eventCrud: true,
    validation: true,
    spaceCreated: true,
    workspaceOpened: true,
  };
}

setTimeout(() => {
  __runRealAcceptance()
    .then(result => __acceptanceReport(result))
    .catch(async error => {
      console.error("[ThunderbirdCalDAV acceptance]", error);
      try {
        await __acceptanceReport({
          ok: false,
          stage: __acceptanceStage,
          name: error?.name || "",
          message: error?.message || String(error),
          error: error?.stack || error?.message || String(error),
        });
      } catch (reportError) {
        console.error("[ThunderbirdCalDAV acceptance report]", reportError);
      }
    });
}, 1500);
'''
with (root / "background.js").open("a", encoding="utf-8") as handle:
    handle.write("\n" + acceptance + "\n")
PY

(
  cd "$TMP/addon"
  zip -qr "$TMP/acceptance.xpi" .
)

echo "== Start Radicale =="
cat >"$TMP/users" <<'EOF'
acceptance:test-password
EOF
cat >"$TMP/rights" <<'EOF'
[acceptance]
user: ^acceptance$
collection: ^acceptance(/.*)?$
permissions: RrWw
EOF
cat >"$TMP/radicale.conf" <<EOF
[server]
hosts = 127.0.0.1:5232

[auth]
type = htpasswd
htpasswd_filename = $TMP/users
htpasswd_encryption = plain
realm = acceptance-realm
delay = 0

[rights]
type = from_file
file = $TMP/rights

[storage]
filesystem_folder = $TMP/storage

[logging]
level = debug
EOF
python3 -m radicale --config "$TMP/radicale.conf" >"$TMP/radicale.log" 2>&1 &
RADICALE_PID=$!

for _ in $(seq 1 80); do
  if curl -fsS -u acceptance:test-password http://127.0.0.1:5232/ >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
curl -fsS -u acceptance:test-password http://127.0.0.1:5232/ >/dev/null

echo "== Create real CalDAV collection and seed VTODO =="
cat >"$TMP/mkcalendar.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Acceptance</D:displayname>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
        <C:comp name="VTODO"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>
EOF
status="$(curl -sS -o "$TMP/mkcalendar.out" -w '%{http_code}'   -X MKCALENDAR   -H 'Content-Type: application/xml; charset=utf-8'   --data-binary @"$TMP/mkcalendar.xml"   -u acceptance:test-password   http://127.0.0.1:5232/acceptance/test/)"
if [[ "$status" != "201" && "$status" != "200" ]]; then
  echo "MKCALENDAR failed: HTTP $status"
  cat "$TMP/mkcalendar.out"
  cat "$TMP/radicale.log"
  exit 1
fi

cat >"$TMP/seed.ics" <<'EOF'
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Thunderbird CalDAV Lab Acceptance//EN
BEGIN:VTODO
UID:seed-task
DTSTAMP:20260930T000000Z
SUMMARY:Seed task from Radicale
STATUS:NEEDS-ACTION
DUE:20261005T100000Z
END:VTODO
END:VCALENDAR
EOF
curl -fsS -X PUT   -H 'Content-Type: text/calendar; charset=utf-8'   --data-binary @"$TMP/seed.ics"   -u acceptance:test-password   http://127.0.0.1:5232/acceptance/test/seed-task.ics >/dev/null

echo "== Start acceptance report endpoint =="
cat >"$TMP/report_server.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys

output = Path(sys.argv[1])

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length)
        output.write_bytes(data)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
    def log_message(self, fmt, *args):
        pass

HTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
PY
python3 "$TMP/report_server.py" "$TMP/report.json" >"$TMP/report-server.log" 2>&1 &
REPORT_PID=$!

echo "== Download official Thunderbird $TB_VERSION =="
ARCHIVE="$TMP/thunderbird.tar.xz"
URL="https://archive.mozilla.org/pub/thunderbird/releases/$TB_VERSION/linux-x86_64/en-US/thunderbird-$TB_VERSION.tar.xz"
curl -fL --retry 3 --retry-delay 2 "$URL" -o "$ARCHIVE"
tar -xJf "$ARCHIVE" -C "$TMP"
"$TMP/thunderbird/thunderbird" --version

echo "== Prepare isolated Thunderbird profile =="
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
user_pref("extensions.installDistroAddons", true);
user_pref("xpinstall.signatures.required", false);
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("mail.spotlight.firstRunDone", true);
user_pref("mail.winsearch.firstRunDone", true);
user_pref("mailnews.start_page.override_url", "about:blank");
user_pref("mailnews.start_page.url", "about:blank");
user_pref("calendar.item.promptDelete", false);
user_pref("calendar.timezone.local", "UTC");
user_pref("calendar.timezone.useSystemTimezone", false);
user_pref("calendar.registry.acceptance-calendar.calendar-main-default", true);
user_pref("calendar.registry.acceptance-calendar.calendar-main-in-composite", true);
user_pref("calendar.registry.acceptance-calendar.cache.enabled", true);
user_pref("calendar.registry.acceptance-calendar.name", "Acceptance");
user_pref("calendar.registry.acceptance-calendar.type", "caldav");
user_pref("calendar.registry.acceptance-calendar.uri", "http://acceptance:test-password@127.0.0.1:5232/acceptance/test/");
user_pref("calendar.registry.acceptance-calendar.username", "acceptance");
user_pref("calendar.list.sortOrder", "acceptance-calendar");
EOF

echo "== Launch real Thunderbird $TB_VERSION with the XPI =="
set +e
xvfb-run -a "$TMP/thunderbird/thunderbird"   -no-remote   -profile "$PROFILE"   >"$TMP/thunderbird.stdout" 2>"$TMP/thunderbird.stderr" &
TB_PID=$!
set -e

for _ in $(seq 1 240); do
  if [[ -s "$TMP/report.json" ]]; then
    break
  fi
  if ! kill -0 "$TB_PID" 2>/dev/null; then
    echo "Thunderbird exited before acceptance completed."
    cat "$TMP/thunderbird.stdout" || true
    cat "$TMP/thunderbird.stderr" || true
    exit 1
  fi
  sleep 0.25
done

if [[ ! -s "$TMP/report.json" ]]; then
  echo "Timed out waiting for real Thunderbird acceptance result."
  echo "--- Thunderbird stdout ---"
  cat "$TMP/thunderbird.stdout" || true
  echo "--- Thunderbird stderr ---"
  cat "$TMP/thunderbird.stderr" || true
  echo "--- Radicale log ---"
  cat "$TMP/radicale.log" || true
  exit 1
fi

echo "== Real Thunderbird result =="
cat "$TMP/report.json"
if ! python3 - "$TMP/report.json" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text())
if not data.get("ok"):
    raise SystemExit(
        "Real Thunderbird acceptance failed at "
        + data.get("stage", "unknown")
        + ": "
        + data.get("error", data.get("message", "unknown error"))
    )
for key in (
    "thunderbirdCalDAV",
    "seedTaskRead",
    "taskCrud",
    "eventCrud",
    "validation",
    "spaceCreated",
    "workspaceOpened",
):
    assert data.get(key) is True, (key, data)
assert data["calendar"]["type"] == "caldav", data
print("real-thunderbird-caldav: PASS")
PY
then
  echo "--- Thunderbird stdout ---"
  cat "$TMP/thunderbird.stdout" || true
  echo "--- Thunderbird stderr ---"
  cat "$TMP/thunderbird.stderr" || true
  echo "--- Radicale log ---"
  cat "$TMP/radicale.log" || true
  exit 1
fi

echo "== Verify server state after Thunderbird CRUD =="
propfind="$(curl -fsS -u acceptance:test-password -X PROPFIND -H 'Depth: 1' http://127.0.0.1:5232/acceptance/test/)"
grep -Fq 'seed-task.ics' <<<"$propfind"
if grep -Fq 'Runtime Task' <<<"$propfind" || grep -Fq 'Runtime Event' <<<"$propfind"; then
  echo "Unexpected runtime acceptance item remained on the CalDAV server."
  exit 1
fi

echo "Real Thunderbird $TB_VERSION + real Radicale acceptance: PASS"
