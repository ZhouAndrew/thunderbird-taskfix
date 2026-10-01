#!/usr/bin/env python3
import json, sys, zipfile
from pathlib import Path

path = Path(sys.argv[1])
with zipfile.ZipFile(path) as z:
    assert z.testzip() is None
    names = set(z.namelist())
    required = {
        "manifest.json",
        "background.js",
        "workspace.html",
        "workspace.css",
        "workspace.js",
        "record.html",
        "record.js",
        "today.html",
        "today.js",
        "connections.html",
        "connections.js",
        "logs.html",
        "logs.js",
        "core/storage.js",
        "core/executor.js",
        "core/connection.js",
        "core/wordpress.js",
        "content/taskfix-window.js",
        "api/TaskFix/implementation.js",
        "api/TaskFix/schema.json",
        "api/ThunderbirdCalDAV/implementation.js",
        "api/ThunderbirdCalDAV/schema.json",
    }
    assert required <= names, required - names

    manifest = json.loads(z.read("manifest.json"))
    assert manifest["name"] == "CalDAV Assistant Experimental"
    assert manifest["version"] == "0.3.5"
    assert manifest["browser_specific_settings"]["gecko"]["id"] == (
        "ZhouAndrew.thunderbird-taskfix-lab@addons.thunderbird.net"
    )
    assert manifest["background"]["scripts"] == ["background.js"]
    assert manifest["browser_specific_settings"]["gecko"]["strict_min_version"] == "153.0.2"
    assert manifest["browser_specific_settings"]["gecko"]["strict_max_version"] == "153.1.*"
    assert "ThunderbirdCalDAV" in manifest["experiment_apis"]
    assert "storage" in manifest.get("permissions", [])
    assert "nativeMessaging" not in manifest.get("permissions", [])
    assert "http://*/*" in manifest.get("optional_permissions", [])
    assert "https://*/*" in manifest.get("optional_permissions", [])

    background = z.read("background.js").decode()
    direct = z.read("api/ThunderbirdCalDAV/implementation.js").decode()
    schema = z.read("api/ThunderbirdCalDAV/schema.json").decode()
    workspace_html = z.read("workspace.html").decode()
    workspace = z.read("workspace.js").decode()
    executor = z.read("core/executor.js").decode()
    connection = z.read("core/connection.js").decode()
    wordpress = z.read("core/wordpress.js").decode()
    logs = z.read("logs.js").decode()

    assert "browser.spaces.create" in background
    assert "CalDAV Assistant" in background
    assert "cal.manager.getCalendars" in direct
    assert ".getItemsAsArray(" in direct
    assert ".addItem(" in direct
    assert ".modifyItem(" in direct
    assert ".deleteItem(" in direct
    assert "getTask" in schema and "getEvent" in schema
    assert "X-CALDAV-ASSISTANT-PAUSED" in direct
    assert "X-CALDAV-ASSISTANT-TASK-UID" in direct
    assert "X-CALDAV-ASSISTANT-WORK-SESSION" in direct
    assert "caldav-assistant-experimental.log" in direct
    assert "diagnosticsInfo" in direct
    assert "readDiagnostics" in direct
    assert "clearDiagnostics" in direct
    assert "writeDiagnostic" in direct
    assert "loggedMutation" in direct
    assert "X-CALDAV-ASSISTANT-WORK-OPEN" in direct
    assert "browser.ThunderbirdCalDAV" in workspace
    assert "AssistantExecutor.start" in workspace
    assert "AssistantExecutor.pause" in workspace
    assert "AssistantExecutor.resume" in workspace
    assert "AssistantExecutor.complete" in workspace
    assert "AssistantExecutor.cancel" in workspace
    assert "task-save" not in workspace_html
    assert "task-new" not in workspace_html
    assert "新建任务" not in workspace_html
    assert "Work Calendar" in workspace_html
    assert "最近一次操作回执" in workspace_html
    assert "不会自动消失" in workspace_html
    assert "createWorkEvent" in executor
    assert "read-back task" in executor
    assert "read-back VEVENT" in executor
    assert "No VTODO was created" in connection
    assert 'status: "draft"' in wordpress
    assert "read-back WordPress post" in wordpress
    assert "AssistantStorage.listAudit" in logs
    assert "ExtensionUtils" in direct and "ExtensionError" in direct
    assert "CalTodo.sys.mjs" in direct and "new CalTodo()" in direct
    assert "CalEvent.sys.mjs" in direct and "new CalEvent()" in direct
    assert "calendar.getItem(" in direct
    assert "Calendar is disabled" in direct
    assert "Event end must not be before its start" in direct

    joined = b"\n".join(
        z.read(n) for n in names if n.endswith((".js", ".json", ".md", ".html"))
    )
    lowered = joined.lower()
    assert b"connectnative" not in lowered
    assert b"nativeMessaging".lower() not in lowered
    assert "apply.sh" not in names
    assert "patch_omnijar.py" not in names

print("caldav-assistant-experimental-xpi-contract: PASS")
