#!/usr/bin/env python3
import json, sys, zipfile
from pathlib import Path

path = Path(sys.argv[1])
with zipfile.ZipFile(path) as z:
    assert z.testzip() is None
    names = set(z.namelist())
    required = {
        "manifest.json",
        "content/taskfix-window.js",
        "api/TaskFix/implementation.js",
        "api/TaskFix/schema.json",
    }
    assert required <= names, required - names
    manifest = json.loads(z.read("manifest.json"))
    assert manifest["name"] == "Thunderbird TaskFix"
    assert manifest["version"] == "0.2.0"
    assert manifest["browser_specific_settings"]["gecko"]["id"] == "ZhouAndrew.thunderbird-taskfix@addons.thunderbird.net"
    assert manifest["browser_specific_settings"]["gecko"]["strict_min_version"] == "153.0"
    assert manifest["browser_specific_settings"]["gecko"]["strict_max_version"] == "153.*"
    joined = b"\n".join(z.read(n) for n in names if n.endswith((".js", ".json", ".md")))
    lowered = joined.lower()
    assert b"caldav_assistant" not in lowered
    assert "apply.sh" not in names
    assert "patch_omnijar.py" not in names
print("xpi-contract: PASS")
