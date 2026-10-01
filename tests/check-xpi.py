#!/usr/bin/env python3
import json
import sys
import zipfile
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
        "logs.html",
        "logs.js",
        "tools.html",
        "tools.js",
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
    assert manifest["version"] == "0.3.6"
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
    storage = z.read("core/storage.js").decode()
    executor = z.read("core/executor.js").decode()
    connection = z.read("core/connection.js").decode()
    wordpress = z.read("core/wordpress.js").decode()
    logs_html = z.read("logs.html").decode()
    logs = z.read("logs.js").decode()
    tools_html = z.read("tools.html").decode()
    tools = z.read("tools.js").decode()

    assert "browser.spaces.create" in background
    assert "CalDAV Assistant" in background

    # Direct Thunderbird provider architecture.
    assert "cal.manager.getCalendars" in direct
    assert ".getItemsAsArray(" in direct
    assert ".addItem(" in direct
    assert ".modifyItem(" in direct
    assert ".deleteItem(" in direct
    assert "getTask" in schema and "getEvent" in schema
    assert "X-CALDAV-ASSISTANT-PAUSED" in direct
    assert "X-CALDAV-ASSISTANT-TASK-UID" in direct
    assert "X-CALDAV-ASSISTANT-WORK-SESSION" in direct
    assert "X-CALDAV-ASSISTANT-WORK-OPEN" in direct

    # Production diagnostics remain available, but not on the Work screen.
    assert "caldav-assistant-experimental.log" in direct
    assert "diagnosticsInfo" in direct
    assert "readDiagnostics" in direct
    assert "clearDiagnostics" in direct
    assert "writeDiagnostic" in direct
    assert "diagnosticsInfo" in logs
    assert "技术诊断" in logs_html

    # Simple Work page contract.
    assert "工作" in workspace_html
    assert "今天" in workspace_html
    assert "记录" in workspace_html
    assert "日志" in workspace_html
    assert "工具" in workspace_html
    assert "最近结果" in workspace_html
    assert "搜索 Task" in workspace_html
    assert "selected-uid" not in workspace_html
    assert "work-calendar" not in workspace_html
    assert "calendar-filter" not in workspace_html
    assert "VTODO" not in workspace_html
    assert "Assistant" not in workspace_html.replace("CalDAV Assistant", "")
    assert "JSON.stringify(item.details" not in workspace
    assert "AssistantExecutor.start" in workspace
    assert "AssistantExecutor.pause" in workspace
    assert "AssistantExecutor.resume" in workspace
    assert "AssistantExecutor.complete" in workspace
    assert "AssistantExecutor.cancel" in workspace
    assert "结果已写入日志" in workspace
    assert "resolveWorkCalendar" in workspace

    # One simple persistence function freezes log-before-display order.
    assert "persistResult" in storage
    assert 'persistResult(receipt, "workflow")' in executor
    assert 'persistResult(result, "connection")' in connection
    assert 'persistResult(result, "wordpress")' in wordpress

    # Connection and settings live under Tools, not on the Work page.
    assert "Task Calendar" in tools_html
    assert "Work Calendar" in tools_html
    assert "Calendar 完整读写" in tools_html
    assert "WordPress 完整读写" in tools_html
    assert "No VTODO was created" in connection
    assert "AssistantConnection.fullCalendarWriteTest" in tools

    # WordPress result keeps concrete IDs while full detail is in Logs.
    assert 'status: "draft"' in wordpress
    assert "read-back WordPress post" in wordpress
    assert "Post ID" in z.read("record.js").decode()
    assert "Media ID" in z.read("record.js").decode()

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
    assert b"nativemessaging" not in lowered
    assert "apply.sh" not in names
    assert "patch_omnijar.py" not in names

print("caldav-assistant-experimental-0.3.6-xpi-contract: PASS")
