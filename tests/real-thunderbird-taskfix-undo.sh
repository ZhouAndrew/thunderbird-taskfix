#!/usr/bin/env bash
set -euo pipefail

TB_VERSION="${1:-153.1.0esr}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
TB_PID=""
REPORT_PID=""

cleanup() {
  set +e
  [[ -n "$TB_PID" ]] && kill "$TB_PID" 2>/dev/null || true
  [[ -n "$REPORT_PID" ]] && kill "$REPORT_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "== Build production XPI =="
chmod +x "$ROOT/packaging/build-xpi.sh"
"$ROOT/packaging/build-xpi.sh" "$TMP/base.xpi"
python3 "$ROOT/tests/check-xpi.py" "$TMP/base.xpi"

echo "== Build real-Thunderbird acceptance XPI =="
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

api_dir = root / "api" / "AcceptanceTaskFix"
api_dir.mkdir(parents=True, exist_ok=True)
(api_dir / "schema.json").write_text(r'''[
  {
    "namespace": "AcceptanceTaskFix",
    "functions": [
      {
        "name": "run",
        "type": "function",
        "async": true,
        "parameters": [],
        "returns": {"type": "any"}
      }
    ]
  }
]
''')

(api_dir / "implementation.js").write_text(r'''"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { Services } = ChromeUtils.importESModule(
  "resource://gre/modules/Services.sys.mjs"
);
var { cal } = ChromeUtils.importESModule(
  "resource:///modules/calendar/calUtils.sys.mjs"
);
var { CalTodo } = ChromeUtils.importESModule(
  "resource:///modules/CalTodo.sys.mjs"
);
var { CalTransactionManager } = ChromeUtils.importESModule(
  "resource:///modules/CalTransactionManager.sys.mjs"
);

function delay(window, ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function waitFor(window, predicate, label, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch {}
    await delay(window, 100);
  }
  throw new Error("Timed out: " + label);
}

async function taskStatus(calendar, id) {
  const item = await calendar.getItem(id);
  if (!item) return "__MISSING__";
  return item.getProperty("STATUS") || null;
}

this.AcceptanceTaskFix = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      AcceptanceTaskFix: {
        async run() {
          const wm = Cc["@mozilla.org/appshell/window-mediator;1"]
            .getService(Ci.nsIWindowMediator);
          const window = wm.getMostRecentWindow("mail:3pane");
          if (!window) throw new Error("No Thunderbird 3-pane window");

          // IMPORTANT: the acceptance runner intentionally waits >15 seconds
          // before calling this API. This reproduces the lazy Tasks-panel path
          // that broke TaskFix 0.3.0.
          if (typeof window.calSwitchToTaskMode === "function") {
            window.calSwitchToTaskMode();
          } else {
            window.document.getElementById("tasksButton")?.click();
          }

          await waitFor(
            window,
            () =>
              window.document.getElementById("calendar-task-tree") &&
              window.document.getElementById("task-actions-toolbar") &&
              window.document.getElementById("task-actions-status") &&
              typeof window.contextChangeTaskStatus === "function" &&
              typeof window.taskfixUndo === "function" &&
              typeof window.taskfixRedo === "function",
            "TaskFix controls and handlers in real Tasks UI"
          );

          const tree = window.document.getElementById("calendar-task-tree");
          tree.ensureInitialized?.();

          const calendar = cal.manager.createCalendar(
            "memory",
            Services.io.newURI("moz-memory-calendar://")
          );
          calendar.name = "TaskFix Real Undo Acceptance";
          calendar.setProperty("calendar-main-default", true);
          cal.manager.registerCalendar(calendar);

          const composite = cal.view.getCompositeCalendar(window);
          if (!composite.getCalendarById(calendar.id)) {
            composite.addCalendar(calendar);
          }

          const ids = ["taskfix-real-undo-a", "taskfix-real-undo-b"];
          for (const [index, id] of ids.entries()) {
            const task = new CalTodo();
            task.id = id;
            task.title = "TaskFix Real Undo " + (index + 1);
            task.calendar = calendar;
            task.entryDate = cal.dtz.now();
            await calendar.addItem(task);
          }

          tree.refresh();
          await waitFor(
            window,
            () => ids.every(id => tree.mTaskArray?.some(task => task.id === id)),
            "two real tasks to appear in the Thunderbird Tasks tree"
          );

          const indexes = ids.map(id => tree.mTaskArray.findIndex(task => task.id === id));
          if (indexes.some(index => index < 0)) {
            throw new Error("Acceptance tasks are not present in real Tasks tree");
          }

          tree.view.selection.clearSelection();
          tree.view.selection.rangedSelect(indexes[0], indexes[0], false);
          tree.view.selection.rangedSelect(indexes[1], indexes[1], true);

          const selectedIds = tree.selectedTasks.map(task => task.id);
          if (!ids.every(id => selectedIds.includes(id))) {
            throw new Error("Real task-tree multi-selection failed: " + JSON.stringify(selectedIds));
          }

          const manager = CalTransactionManager.getInstance();
          manager.undoStack = [];
          manager.redoStack = [];

          // Real TaskFix batch mutation against two real Thunderbird calendar items.
          window.contextChangeTaskStatus("IN-PROCESS");
          await waitFor(
            window,
            async () =>
              (await taskStatus(calendar, ids[0])) === "IN-PROCESS" &&
              (await taskStatus(calendar, ids[1])) === "IN-PROCESS",
            "TaskFix batch Status change"
          );

          const top = manager.peekUndoStack();
          if (!manager.canUndo()) {
            throw new Error("Calendar transaction manager cannot undo TaskFix batch");
          }
          if (!top || !Array.isArray(top.transactions) || top.transactions.length !== 2) {
            throw new Error(
              "TaskFix did not create one two-item Calendar batch transaction: " +
              JSON.stringify({
                hasTop: Boolean(top),
                transactionCount: top?.transactions?.length ?? null,
              })
            );
          }

          // Direct TaskFix helper must use Calendar undo(), not mail/editor undo.
          if (!window.taskfixUndo()) {
            throw new Error("taskfixUndo() refused a real Calendar undo");
          }
          await waitFor(
            window,
            async () =>
              (await taskStatus(calendar, ids[0])) === null &&
              (await taskStatus(calendar, ids[1])) === null,
            "direct TaskFix Calendar undo"
          );

          if (!window.taskfixRedo()) {
            throw new Error("taskfixRedo() refused a real Calendar redo");
          }
          await waitFor(
            window,
            async () =>
              (await taskStatus(calendar, ids[0])) === "IN-PROCESS" &&
              (await taskStatus(calendar, ids[1])) === "IN-PROCESS",
            "direct TaskFix Calendar redo"
          );

          // Exercise the actual keyboard path on the real Tasks tree.
          tree.dispatchEvent(
            new window.KeyboardEvent("keydown", {
              key: "z",
              code: "KeyZ",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            })
          );
          await waitFor(
            window,
            async () =>
              (await taskStatus(calendar, ids[0])) === null &&
              (await taskStatus(calendar, ids[1])) === null,
            "Ctrl+Z real Tasks-tree undo"
          );

          tree.dispatchEvent(
            new window.KeyboardEvent("keydown", {
              key: "z",
              code: "KeyZ",
              ctrlKey: true,
              shiftKey: true,
              bubbles: true,
              cancelable: true,
            })
          );
          await waitFor(
            window,
            async () =>
              (await taskStatus(calendar, ids[0])) === "IN-PROCESS" &&
              (await taskStatus(calendar, ids[1])) === "IN-PROCESS",
            "Ctrl+Shift+Z real Tasks-tree redo"
          );

          // Exercise Thunderbird's real command-controller path too.
          window.goDoCommand("cmd_undo");
          await waitFor(
            window,
            async () =>
              (await taskStatus(calendar, ids[0])) === null &&
              (await taskStatus(calendar, ids[1])) === null,
            "Edit/command cmd_undo path"
          );

          window.goDoCommand("cmd_redo");
          await waitFor(
            window,
            async () =>
              (await taskStatus(calendar, ids[0])) === "IN-PROCESS" &&
              (await taskStatus(calendar, ids[1])) === "IN-PROCESS",
            "Edit/command cmd_redo path"
          );

          cal.manager.unregisterCalendar(calendar);

          return {
            ok: true,
            thunderbirdVersion: Services.appinfo.version,
            marker: String(window.__taskfixAddonState?.marker || ""),
            lateTasksPanelActivation: true,
            realTaskTreeMultiSelect: true,
            batchTransactionCount: top.transactions.length,
            directCalendarUndo: true,
            directCalendarRedo: true,
            ctrlZUndo: true,
            ctrlShiftZRedo: true,
            commandUndo: true,
            commandRedo: true,
          };
        },
      },
    };
  }
};
''')

manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

with (root / "background.js").open("a", encoding="utf-8") as handle:
    handle.write(r'''
const __TASKFIX_ACCEPTANCE_REPORT = "http://127.0.0.1:8765/report";

async function __taskfixAcceptanceReport(payload) {
  await fetch(__TASKFIX_ACCEPTANCE_REPORT, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
  });
}

setTimeout(() => {
  browser.AcceptanceTaskFix.run()
    .then(result => __taskfixAcceptanceReport(result))
    .catch(async error => {
      console.error("[TaskFix real acceptance]", error);
      try {
        await __taskfixAcceptanceReport({
          ok: false,
          name: error?.name || "",
          message: error?.message || String(error),
          error: error?.stack || error?.message || String(error),
        });
      } catch (reportError) {
        console.error("[TaskFix acceptance report]", reportError);
      }
    });
}, 17000);
''')
PY

(
  cd "$TMP/addon"
  zip -qr "$TMP/acceptance.xpi" .
)

echo "== Start acceptance report endpoint =="
cat >"$TMP/report_server.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys

output = Path(sys.argv[1])

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        output.write_bytes(self.rfile.read(length))
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

echo "== Prepare isolated profile =="
PROFILE="$TMP/profile"
mkdir -p "$PROFILE/extensions"
EXT_ID='ZhouAndrew.thunderbird-taskfix@addons.thunderbird.net'
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
user_pref("calendar.timezone.local", "Asia/Shanghai");
EOF

echo "== Start real Thunderbird under Xvfb =="
set +e
xvfb-run -a "$TMP/thunderbird/thunderbird" \
  -no-remote \
  -profile "$PROFILE" \
  >"$TMP/thunderbird.stdout" 2>"$TMP/thunderbird.stderr" &
TB_PID=$!
set -e

for _ in $(seq 1 220); do
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
  echo "Timed out waiting for real Thunderbird TaskFix acceptance."
  cat "$TMP/thunderbird.stdout" || true
  cat "$TMP/thunderbird.stderr" || true
  exit 1
fi

echo "== Real Thunderbird TaskFix acceptance result =="
cat "$TMP/report.json"
python3 - "$TMP/report.json" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text())
assert data.get("ok") is True, data
for key in (
    "lateTasksPanelActivation",
    "realTaskTreeMultiSelect",
    "directCalendarUndo",
    "directCalendarRedo",
    "ctrlZUndo",
    "ctrlShiftZRedo",
    "commandUndo",
    "commandRedo",
):
    assert data.get(key) is True, (key, data)
assert data.get("batchTransactionCount") == 2, data
print("real-thunderbird-taskfix-undo: PASS")
PY
