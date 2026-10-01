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
    assert manifest["version"] == "0.3.7"
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
    assert 'id="task-view"' in workspace_html
    assert 'id="task-calendar-filter"' in workspace_html
    assert ">未完成<" in workspace_html
    assert "VTODO" not in workspace_html
    assert 'id="selected-flow-state"' not in workspace_html
    assert ">Assistant<" not in workspace_html
    assert "JSON.stringify(item.details" not in workspace
    assert "AssistantExecutor.start" in workspace
    assert "AssistantExecutor.pause" in workspace
    assert "AssistantExecutor.resume" in workspace
    assert "AssistantExecutor.complete" in workspace
    assert "AssistantExecutor.cancel" in workspace
    assert "结果已写入日志" in workspace
    assert "resolveWorkCalendar" in workspace
    assert 'state.taskView = state.settings.taskView || "incomplete"' in workspace
    assert 'view === "completed"' in workspace
    assert 'view === "overdue"' in workspace
    assert "打开设置" in workspace

    # One simple persistence function freezes log-before-display order.
    assert "persistResult" in storage
    assert "saveSettingsWithUndo" in storage
    assert "undoSettings" in storage
    assert 'persistResult(receipt, "workflow")' in executor
    assert 'persistResult(result, "connection")' in connection
    assert 'persistResult(result, "wordpress")' in wordpress

    # Connection and settings live under Tools, not on the Work page.
    assert "默认 Task 视图" in tools_html
    assert "默认 Task Calendar" in tools_html
    assert "Work Calendar" in tools_html
    assert "undo-settings" in tools_html
    assert "saveSettingsWithUndo" in tools
    assert "undoSettings" in tools
    assert "Calendar 完整读写" in tools_html
    assert "WordPress 完整读写" in tools_html
    assert "No VTODO was created" in connection
    assert "AssistantConnection.fullCalendarWriteTest" in tools

    # WordPress Record appends one entry to one daily post; per-entry title/status
    # fields must not return to the simple UI.
    record_html = z.read("record.html").decode()
    record_js = z.read("record.js").decode()
    assert 'id="title"' not in record_html
    assert 'id="post-status"' not in record_html
    assert "每次只追加一条" in record_html
    assert "追加日志" in record_html
    assert "dailyLogTitle" in wordpress
    assert "ensureDailyLogPost" in wordpress
    assert "append + read-back daily WordPress log" in wordpress
    assert "wordpress.append-log" in wordpress
    assert "今日日志" in record_js
    assert "Post ID" in record_js
    assert "Media ID" in record_js

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

print("caldav-assistant-experimental-0.3.7-xpi-contract: PASS")
