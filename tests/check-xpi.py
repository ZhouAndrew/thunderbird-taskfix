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
        "content/taskfix-window.js",
        "api/TaskFix/implementation.js",
        "api/TaskFix/schema.json",
        "api/ThunderbirdCalDAV/implementation.js",
        "api/ThunderbirdCalDAV/schema.json",
    }
    assert required <= names, required - names

    manifest = json.loads(z.read("manifest.json"))
    assert manifest["name"] == "Thunderbird CalDAV Lab"
    assert manifest["version"] == "0.3.0"
    assert manifest["browser_specific_settings"]["gecko"]["id"] == (
        "ZhouAndrew.thunderbird-taskfix-lab@addons.thunderbird.net"
    )
    assert manifest["background"]["scripts"] == ["background.js"]
    assert manifest["browser_specific_settings"]["gecko"]["strict_min_version"] == "153.0"
    assert manifest["browser_specific_settings"]["gecko"]["strict_max_version"] == "153.*"
    assert "ThunderbirdCalDAV" in manifest["experiment_apis"]
    assert "nativeMessaging" not in manifest.get("permissions", [])

    background = z.read("background.js").decode()
    direct = z.read("api/ThunderbirdCalDAV/implementation.js").decode()
    workspace = z.read("workspace.js").decode()

    assert "browser.spaces.create" in background
    assert "cal.manager.getCalendars" in direct
    assert ".getItemsAsArray(" in direct
    assert ".addItem(" in direct
    assert ".modifyItem(" in direct
    assert ".deleteItem(" in direct
    assert "browser.ThunderbirdCalDAV" in workspace

    joined = b"\n".join(z.read(n) for n in names if n.endswith((".js", ".json", ".md")))
    lowered = joined.lower()
    assert b"native host" in lowered
    assert b"no native host" in lowered
    assert b"caldav_assistant" not in lowered
    assert b"connectnative" not in lowered
    assert "apply.sh" not in names
    assert "patch_omnijar.py" not in names

print("direct-thunderbird-caldav-xpi-contract: PASS")
