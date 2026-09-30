#!/usr/bin/env bash
set -euo pipefail

TB_VERSION="${1:-153.0.2esr}"
TB_TIMEZONE="${2:-UTC}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
TB_PID=""
XVFB_PID=""
RADICALE_PID=""
REPORT_PID=""

cleanup() {
  set +e
  [[ -n "$TB_PID" ]] && kill "$TB_PID" 2>/dev/null || true
  [[ -n "$XVFB_PID" ]] && kill "$XVFB_PID" 2>/dev/null || true
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

manifest["experiment_apis"]["AcceptanceTaskFix"] = {
    "schema": "api/AcceptanceTaskFix/schema.json",
    "parent": {
        "scopes": ["addon_parent"],
        "paths": [["AcceptanceTaskFix"]],
        "script": "api/AcceptanceTaskFix/implementation.js",
    },
}
taskfix_dir = root / "api" / "AcceptanceTaskFix"
taskfix_dir.mkdir(parents=True, exist_ok=True)
(taskfix_dir / "schema.json").write_text(r'''[
  {
    "namespace": "AcceptanceTaskFix",
    "functions": [
      {
        "name": "openTasksAndCheck",
        "type": "function",
        "async": true,
        "parameters": [],
        "returns": {"type": "any"}
      }
    ]
  }
]
''')
(taskfix_dir / "implementation.js").write_text(r'''"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

function delay(window, ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

this.AcceptanceTaskFix = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      AcceptanceTaskFix: {
        async openTasksAndCheck() {
          const wm = Cc["@mozilla.org/appshell/window-mediator;1"]
            .getService(Ci.nsIWindowMediator);
          const window = wm.getMostRecentWindow("mail:3pane");
          if (!window) {
            return {ok: false, error: "No Thunderbird 3-pane window"};
          }

          if (typeof window.calSwitchToTaskMode === "function") {
            window.calSwitchToTaskMode();
          } else {
            window.document.getElementById("tasksButton")?.click();
          }

          for (let attempt = 0; attempt < 80; attempt++) {
            const taskTree = window.document.getElementById("calendar-task-tree");
            const toolbar = window.document.getElementById("task-actions-toolbar");
            const status = window.document.getElementById("task-actions-status");
            const contextStatus = window.document.getElementById("task-context-menu-status");
            if (taskTree && toolbar && status && contextStatus) {
              return {
                ok: true,
                marker: String(window.__taskfixAddonState?.marker || ""),
                taskTree: true,
                toolbar: true,
                statusButton: true,
                contextStatus: true,
              };
            }
            await delay(window, 100);
          }

          return {
            ok: false,
            error: "TaskFix controls did not appear in the real Tasks UI",
            marker: String(window.__taskfixAddonState?.marker || ""),
            taskTree: Boolean(window.document.getElementById("calendar-task-tree")),
            toolbar: Boolean(window.document.getElementById("task-actions-toolbar")),
            statusButton: Boolean(window.document.getElementById("task-actions-status")),
            contextStatus: Boolean(window.document.getElementById("task-context-menu-status")),
          };
        },
      },
    };
  }
};
''')

manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

workspace_acceptance = r'''
async function __workspaceWaitFor(predicate, label, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Workspace timeout: " + label);
}

function __workspaceAssert(condition, message) {
  if (!condition) throw new Error(message);
}

async function __runWorkspaceAcceptance() {
  await __workspaceWaitFor(
    () =>
      state.calendars.some(calendar => calendar.id === "acceptance-calendar") &&
      state.tasks.some(task => task.id === "seed-task"),
    "initial Calendar/VTODO render"
  );

  const calendarOption = [...$("calendar-filter").options].find(
    option => option.value === "acceptance-calendar"
  );
  __workspaceAssert(calendarOption, "Workspace calendar filter did not render the CalDAV calendar");
  __workspaceAssert(
    [...$("task-list").querySelectorAll(".item-title")].some(
      node => node.textContent === "Seed task from Radicale"
    ),
    "Workspace task list did not render the seed VTODO"
  );

  $("task-calendar").value = "acceptance-calendar";
  $("task-title").value = "Workspace UI Task";
  $("task-due").value = "2026-10-07";
  $("task-status").value = "NEEDS-ACTION";
  $("task-priority").value = "5";
  $("task-categories").value = "UI, Acceptance";
  $("task-description").value = "Created through real workspace controls";
  $("task-save").click();

  await __workspaceWaitFor(
    () => state.tasks.some(task => task.title === "Workspace UI Task"),
    "task create"
  );
  await new Promise(resolve => setTimeout(resolve, 400));

  let task = state.tasks.find(item => item.title === "Workspace UI Task");
  let taskRow = [...$("task-list").children].find(
    row => row.querySelector?.(".item-title")?.textContent === "Workspace UI Task"
  );
  __workspaceAssert(taskRow, "Created task row was not rendered");
  taskRow.click();
  __workspaceAssert($("task-id").value === task.id, "Task row click did not load editor");

  $("task-title").value = "Workspace UI Task Updated";
  $("task-due").value = "2026-10-08";
  $("task-status").value = "IN-PROCESS";
  $("task-priority").value = "1";
  $("task-categories").value = "UI, Updated";
  $("task-save").click();

  await __workspaceWaitFor(
    () =>
      state.tasks.some(
        item =>
          item.id === task.id &&
          item.title === "Workspace UI Task Updated" &&
          item.status === "IN-PROCESS" &&
          item.priority === 1
      ),
    "task update"
  );
  await new Promise(resolve => setTimeout(resolve, 400));

  task = state.tasks.find(item => item.id === task.id);
  taskRow = [...$("task-list").children].find(
    row => row.querySelector?.(".item-title")?.textContent === "Workspace UI Task Updated"
  );
  __workspaceAssert(taskRow, "Updated task row was not rendered");
  taskRow.click();
  globalThis.confirm = () => true;
  $("task-delete").click();

  await __workspaceWaitFor(
    () => !state.tasks.some(item => item.id === task.id),
    "task delete"
  );

  $("event-calendar").value = "acceptance-calendar";
  $("event-title").value = "Workspace UI Event";
  $("event-start").value = "2026-10-08T09:00";
  $("event-end").value = "2026-10-08T10:00";
  $("event-categories").value = "UI, Acceptance";
  $("event-description").value = "Created through real workspace controls";
  $("event-save").click();

  await __workspaceWaitFor(
    () => state.events.some(event => event.title === "Workspace UI Event"),
    "event create"
  );
  await new Promise(resolve => setTimeout(resolve, 400));

  let event = state.events.find(item => item.title === "Workspace UI Event");
  let eventRow = [...$("event-list").children].find(
    row => row.querySelector?.(".item-title")?.textContent === "Workspace UI Event"
  );
  __workspaceAssert(eventRow, "Created event row was not rendered");
  eventRow.click();
  __workspaceAssert($("event-id").value === event.id, "Event row click did not load editor");

  $("event-title").value = "Workspace UI Event Updated";
  $("event-start").value = "2026-10-08T11:00";
  $("event-end").value = "2026-10-08T12:30";
  $("event-categories").value = "UI, Updated";
  $("event-save").click();

  await __workspaceWaitFor(
    () =>
      state.events.some(
        item => item.id === event.id && item.title === "Workspace UI Event Updated"
      ),
    "event update"
  );
  await new Promise(resolve => setTimeout(resolve, 400));

  event = state.events.find(item => item.id === event.id);
  eventRow = [...$("event-list").children].find(
    row => row.querySelector?.(".item-title")?.textContent === "Workspace UI Event Updated"
  );
  __workspaceAssert(eventRow, "Updated event row was not rendered");
  eventRow.click();
  globalThis.confirm = () => true;
  $("event-delete").click();

  await __workspaceWaitFor(
    () => !state.events.some(item => item.id === event.id),
    "event delete"
  );

  return {
    ok: true,
    calendarRendered: true,
    seedTaskRendered: true,
    taskUiCrud: true,
    eventUiCrud: true,
    statusText: $("status").textContent,
  };
}

setTimeout(() => {
  __runWorkspaceAcceptance()
    .then(result =>
      browser.runtime.sendMessage({
        kind: "thunderbird-caldav-workspace-acceptance",
        result,
      })
    )
    .catch(error =>
      browser.runtime.sendMessage({
        kind: "thunderbird-caldav-workspace-acceptance",
        result: {
          ok: false,
          error: error?.stack || error?.message || String(error),
        },
      })
    );
}, 800);
'''
with (root / "workspace.js").open("a", encoding="utf-8") as handle:
    handle.write("\n" + workspace_acceptance + "\n")

acceptance = r'''
const __ACCEPTANCE_REPORT = "http://127.0.0.1:8765/report";
let __acceptanceStage = "startup";
let __workspaceAcceptanceResolve;
const __workspaceAcceptancePromise = new Promise(resolve => {
  __workspaceAcceptanceResolve = resolve;
});
browser.runtime.onMessage.addListener(message => {
  if (message?.kind === "thunderbird-caldav-workspace-acceptance") {
    __workspaceAcceptanceResolve(message.result);
  }
});

function __acceptanceAssert(condition, message) {
  if (!condition) throw new Error(message);
}

function __acceptanceDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function __acceptanceIcalEquals(actual, expected) {
  return String(actual || "").replace(/Z$/, "") === expected;
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

  __acceptanceStage = "workspace-ui";
  const workspaceResult = await Promise.race([
    __workspaceAcceptancePromise,
    __acceptanceDelay(25000).then(() => {
      throw new Error("Timed out waiting for workspace UI acceptance");
    }),
  ]);
  __acceptanceAssert(
    workspaceResult?.ok,
    "Workspace UI acceptance failed: " + (workspaceResult?.error || "unknown")
  );
  __acceptanceAssert(workspaceResult.taskUiCrud, "Workspace task CRUD did not pass");
  __acceptanceAssert(workspaceResult.eventUiCrud, "Workspace event CRUD did not pass");
  await browser.tabs.remove(workspaceTab.id);

  __acceptanceStage = "taskfix-real-ui";
  const taskFix = await browser.AcceptanceTaskFix.openTasksAndCheck();
  __acceptanceAssert(
    taskFix?.ok,
    "TaskFix real Tasks UI injection failed: " + JSON.stringify(taskFix)
  );
  __acceptanceAssert(taskFix.statusButton, "TaskFix Status toolbar button is missing");
  __acceptanceAssert(taskFix.contextStatus, "TaskFix Status context menu is missing");

  __acceptanceStage = "diagnostics";
  await browser.ThunderbirdCalDAV.writeDiagnostic("acceptance", "probe", {
    password: "must-not-leak",
    note: "diagnostics-probe-ok",
  });
  const diagnosticInfo = await browser.ThunderbirdCalDAV.diagnosticsInfo();
  const diagnosticRead = await browser.ThunderbirdCalDAV.readDiagnostics(400);
  __acceptanceAssert(Boolean(diagnosticInfo.path), "Diagnostics path is missing");
  __acceptanceAssert(
    diagnosticRead.text.includes('"component":"acceptance"') &&
      diagnosticRead.text.includes('"event":"probe"'),
    "Persistent diagnostics probe was not readable"
  );
  __acceptanceAssert(
    !diagnosticRead.text.includes("must-not-leak"),
    "Diagnostics did not redact a password field"
  );

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
    __acceptanceIcalEquals(updatedEvent.start?.icalString, "20261005T110000"),
    `Event start update failed: ${updatedEvent.start?.icalString}; source=${updatedEvent.start?.sourceIcalString}`
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
    workspaceUiCrud: true,
    taskFixRealUi: true,
    diagnostics: true,
    createdTaskId: createdTask.id,
    createdEventId: event.id,
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
printf 'user_pref("calendar.timezone.local", "%s");\n' "$TB_TIMEZONE" >>"$PROFILE/user.js"

echo "== Start Xvfb =="
Xvfb :99 -screen 0 1280x1024x24 >"$TMP/xvfb.log" 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
sleep 0.5
if ! kill -0 "$XVFB_PID" 2>/dev/null; then
  echo "Xvfb failed to start."
  cat "$TMP/xvfb.log" || true
  exit 1
fi

echo "== Launch real Thunderbird $TB_VERSION ($TB_TIMEZONE) with the XPI =="
set +e
"$TMP/thunderbird/thunderbird" \
  -no-remote \
  -profile "$PROFILE" \
  >"$TMP/thunderbird.stdout" 2>"$TMP/thunderbird.stderr" &
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
    "workspaceUiCrud",
    "taskFixRealUi",
    "diagnostics",
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

echo "== Verify persistent CalDAV Lab diagnostics =="
LAB_LOG="$PROFILE/thunderbird-caldav-lab.log"
test -s "$LAB_LOG"
grep -q '"component":"acceptance"' "$LAB_LOG"
grep -q '"event":"probe"' "$LAB_LOG"
grep -q '"event":"task.create.success"' "$LAB_LOG"
grep -q '"event":"event.create.success"' "$LAB_LOG"
if grep -q 'must-not-leak\|test-password' "$LAB_LOG"; then
  echo "Sensitive value leaked into diagnostics log"
  cat "$LAB_LOG"
  exit 1
fi
echo "persistent-diagnostics: PASS ($LAB_LOG)"

echo "== Verify server state after Thunderbird CRUD =="
curl -fsS -u acceptance:test-password -X PROPFIND -H 'Depth: 1' \
  http://127.0.0.1:5232/acceptance/test/ >"$TMP/propfind.xml"
python3 - "$TMP/propfind.xml" <<'PY'
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

root = ET.fromstring(Path(sys.argv[1]).read_bytes())
hrefs = [
    (node.text or "").strip()
    for node in root.findall(".//{DAV:}href")
    if (node.text or "").strip().endswith(".ics")
]
assert hrefs == ["/acceptance/test/seed-task.ics"], hrefs
print("radicale-clean-after-crud: PASS")
PY

echo "== Restart the same Thunderbird profile and repeat acceptance =="
kill "$TB_PID" 2>/dev/null || true
wait "$TB_PID" 2>/dev/null || true
TB_PID=""
rm -f "$TMP/report.json"
sleep 1

set +e
"$TMP/thunderbird/thunderbird" \
  -no-remote \
  -profile "$PROFILE" \
  >"$TMP/thunderbird-restart.stdout" 2>"$TMP/thunderbird-restart.stderr" &
TB_PID=$!
set -e

for _ in $(seq 1 260); do
  if [[ -s "$TMP/report.json" ]]; then
    break
  fi
  if ! kill -0 "$TB_PID" 2>/dev/null; then
    echo "Thunderbird exited during restart acceptance."
    cat "$TMP/thunderbird-restart.stdout" || true
    cat "$TMP/thunderbird-restart.stderr" || true
    exit 1
  fi
  sleep 0.25
done

if [[ ! -s "$TMP/report.json" ]]; then
  echo "Timed out waiting for restart acceptance result."
  cat "$TMP/thunderbird-restart.stdout" || true
  cat "$TMP/thunderbird-restart.stderr" || true
  cat "$TMP/radicale.log" || true
  exit 1
fi

echo "== Restart acceptance result =="
cat "$TMP/report.json"
python3 - "$TMP/report.json" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text())
assert data.get("ok") is True, data
for key in (
    "thunderbirdCalDAV",
    "seedTaskRead",
    "taskCrud",
    "eventCrud",
    "validation",
    "spaceCreated",
    "workspaceOpened",
    "workspaceUiCrud",
    "taskFixRealUi",
    "diagnostics",
):
    assert data.get(key) is True, (key, data)
assert data["calendar"]["type"] == "caldav", data
print("real-thunderbird-restart: PASS")
PY

curl -fsS -u acceptance:test-password -X PROPFIND -H 'Depth: 1' \
  http://127.0.0.1:5232/acceptance/test/ >"$TMP/propfind-restart.xml"
python3 - "$TMP/propfind-restart.xml" <<'PY'
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

root = ET.fromstring(Path(sys.argv[1]).read_bytes())
hrefs = [
    (node.text or "").strip()
    for node in root.findall(".//{DAV:}href")
    if (node.text or "").strip().endswith(".ics")
]
assert hrefs == ["/acceptance/test/seed-task.ics"], hrefs
print("radicale-clean-after-restart: PASS")
PY

echo "== Verify diagnostics survived Thunderbird restart =="
test -s "$LAB_LOG"
python3 - "$LAB_LOG" <<'PY'
from pathlib import Path
import json
import sys

lines = [line for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
events = [json.loads(line) for line in lines]
assert sum(1 for row in events if row.get("component") == "acceptance" and row.get("event") == "probe") >= 2
assert any(row.get("component") == "background" and row.get("event") == "startup.success" for row in events)
print("persistent-diagnostics-after-restart: PASS")
PY

echo "Real Thunderbird $TB_VERSION ($TB_TIMEZONE) + real Radicale + restart + diagnostics acceptance: PASS"
