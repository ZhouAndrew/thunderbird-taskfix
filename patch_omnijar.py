#!/usr/bin/env python3
from __future__ import annotations

import os
import stat
import sys
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, NoReturn

HERE = Path(__file__).resolve().parent
PATCH_DIR = HERE / "patches"
MARKER = "THUNDERBIRD_TASKFIX_BATCH_EDIT_V2"

TASK_UTILS = "calendar-task-tree-utils.js"
TASK_VIEW = "calendar-task-view.js"
TASK_ACTIONS_HOST = "__task_actions_host__"


def load_patch(name: str) -> str:
    path = PATCH_DIR / name
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        fail(f"Could not read patch fragment {path}: {exc}")


def fail(msg: str) -> NoReturn:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def find_braced_block(text: str, start: int) -> tuple[int, int]:
    brace = text.find("{", start)
    if brace < 0:
        fail("Opening brace not found")

    depth = 0
    i = brace
    state = "code"
    quote = ""
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if state == "code":
            if ch in ('"', "'", "`"):
                state = "string"
                quote = ch
            elif ch == "/" and nxt == "/":
                state = "line_comment"
                i += 1
            elif ch == "/" and nxt == "*":
                state = "block_comment"
                i += 1
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return start, i + 1
        elif state == "string":
            if ch == "\\":
                i += 1
            elif ch == quote:
                state = "code"
        elif state == "line_comment":
            if ch == "\n":
                state = "code"
        elif state == "block_comment":
            if ch == "*" and nxt == "/":
                state = "code"
                i += 1
        i += 1

    fail("Could not determine block end")


def replace_function(text: str, signature: str, replacement: str, required: list[str]) -> str:
    start = text.find(signature)
    if start < 0:
        fail(f"Could not find {signature!r}")
    start, end = find_braced_block(text, start)
    old = text[start:end]
    missing = [needle for needle in required if needle not in old]
    if missing:
        fail(f"Refusing unsafe patch for {signature!r}; missing: {', '.join(missing)}")
    return text[:start] + replacement.rstrip() + text[end:]


def replace_object_method(text: str, signature: str, replacement: str, required: list[str]) -> str:
    start = text.find(signature)
    if start < 0:
        fail(f"Could not find method {signature!r}")
    line_start = text.rfind("\n", 0, start) + 1
    _, end = find_braced_block(text, start)
    if text[end : end + 1] == ",":
        end += 1
    old = text[line_start:end]
    missing = [needle for needle in required if needle not in old]
    if missing:
        fail(f"Refusing unsafe patch for {signature!r}; missing: {', '.join(missing)}")
    return text[:line_start] + replacement.rstrip() + text[end:]


def patch_task_utils(text: str) -> str:
    if MARKER in text and "function contextChangeTaskStatus" in text:
        return text
    return replace_function(
        text,
        "function contextChangeTaskProgress(aProgress) {",
        load_patch("task-utils.js.part"),
        [
            "const tasks = getSelectedTasks();",
            "for (const task of tasks)",
            'doTransaction("modify", newTask, newTask.calendar, task, null);',
            "newTask.percentComplete = aProgress;",
        ],
    )


def patch_task_view(text: str) -> str:
    if MARKER in text and "taskfixCategoryCommand(event)" in text:
        return text

    text = replace_object_method(
        text,
        "loadCategories() {",
        load_patch("load-categories.js.part"),
        ["cal.category.fromPrefs()", "item.getCategories()", "calendar-category"],
    )
    text = replace_object_method(
        text,
        "saveCategories() {",
        load_patch("save-categories.js.part"),
        ["newItem.setCategories(categories)", 'doTransaction("modify"'],
    )
    return replace_object_method(
        text,
        "categoryTextboxKeypress(event) {",
        load_patch("category-keypress.js.part"),
        ["event.target.value", "calendar-category", 'case "Enter"'],
    )


def patch_task_actions_host(text: str) -> str:
    if 'id="task-actions-status"' in text:
        return text
    anchor = '                    <toolbarbutton is="toolbarbutton-menu-button" id="task-actions-markcompleted"'
    if anchor not in text:
        fail("Could not find task action toolbar insertion point")
    return text.replace(anchor, load_patch("status-button.xhtml.part") + anchor, 1)


PATCHERS: dict[str, Callable[[str], str]] = {
    TASK_UTILS: patch_task_utils,
    TASK_VIEW: patch_task_view,
    TASK_ACTIONS_HOST: patch_task_actions_host,
}


@dataclass
class ArchivePlan:
    archive: Path
    entries: dict[str, str] = field(default_factory=dict)


def candidate_archives(root: Path):
    seen = set()
    preferred = [
        root / "chrome" / "calendar.jar",
        root / "chrome" / "messenger.jar",
        root / "omni.ja",
        root / "browser" / "omni.ja",
    ]
    for path in preferred:
        if path.is_file():
            rp = path.resolve()
            if rp not in seen:
                seen.add(rp)
                yield path
    for pattern in ("*.ja", "*.jar"):
        for path in root.rglob(pattern):
            rp = path.resolve()
            if rp not in seen and path.is_file():
                seen.add(rp)
                yield path


def looks_like_task_actions_host(name: str, text: str) -> bool:
    if not name.endswith((".xhtml", ".html")):
        return False
    return (
        'id="task-actions-toolbar"' in text
        and 'id="task-actions-category"' in text
        and 'id="task-actions-markcompleted"' in text
    )


def locate(root: Path) -> list[ArchivePlan]:
    found: dict[str, tuple[Path, str]] = {}

    for archive in candidate_archives(root):
        try:
            with zipfile.ZipFile(archive, "r") as zf:
                for name in zf.namelist():
                    base = name.rsplit("/", 1)[-1]

                    logical = None
                    if base == TASK_UTILS:
                        logical = TASK_UTILS
                    elif base == TASK_VIEW:
                        logical = TASK_VIEW
                    elif base == "calendar-tab-panels.inc.xhtml":
                        logical = TASK_ACTIONS_HOST

                    if logical is not None:
                        prior = found.get(logical)
                        if prior and prior != (archive, name):
                            fail(
                                f"Found duplicate target {logical}: "
                                f"{prior[0]}!/{prior[1]} and {archive}!/{name}"
                            )
                        found[logical] = (archive, name)
                        continue

                    if TASK_ACTIONS_HOST not in found and name.endswith((".xhtml", ".html")):
                        try:
                            text = zf.read(name).decode("utf-8")
                        except (UnicodeDecodeError, KeyError):
                            continue
                        if looks_like_task_actions_host(name, text):
                            found[TASK_ACTIONS_HOST] = (archive, name)
        except zipfile.BadZipFile:
            continue

    missing = [key for key in PATCHERS if key not in found]
    if missing:
        details = ", ".join(missing)
        fail(
            "Could not locate all TaskFix targets across Thunderbird archives. "
            f"Missing: {details}. "
            "On packaged Thunderbird, Calendar code is normally in chrome/calendar.jar "
            "while the task action toolbar is compiled into chrome/messenger.jar."
        )

    plans_by_archive: dict[Path, ArchivePlan] = {}
    for logical, (archive, entry) in found.items():
        plans_by_archive.setdefault(archive, ArchivePlan(archive)).entries[logical] = entry

    return list(plans_by_archive.values())


def verify_rebuilt_archive(check: zipfile.ZipFile, entries: dict[str, str]) -> None:
    bad = check.testzip()
    if bad:
        fail(f"Rebuilt archive failed CRC test at {bad}")

    if TASK_UTILS in entries:
        text = check.read(entries[TASK_UTILS]).decode("utf-8")
        if MARKER not in text or "function contextChangeTaskStatus" not in text:
            fail("Task utility patch marker/status function missing after archive rebuild")

    if TASK_VIEW in entries:
        text = check.read(entries[TASK_VIEW]).decode("utf-8")
        if MARKER not in text or "taskfixCategoryCommand(event)" not in text:
            fail("Task Category patch marker/handler missing after archive rebuild")

    if TASK_ACTIONS_HOST in entries:
        text = check.read(entries[TASK_ACTIONS_HOST]).decode("utf-8")
        if 'id="task-actions-status"' not in text:
            fail("Status toolbar button missing after archive rebuild")


def rewrite_archive(plan: ArchivePlan) -> bool:
    archive = plan.archive
    entries = plan.entries
    mode = stat.S_IMODE(archive.stat().st_mode)

    with zipfile.ZipFile(archive, "r") as src:
        replacements: dict[str, bytes] = {}
        changed = False

        for logical, entry in entries.items():
            try:
                text = src.read(entry).decode("utf-8")
            except UnicodeDecodeError as exc:
                fail(f"{archive}!/{entry} is not UTF-8: {exc}")
            patched = PATCHERS[logical](text)
            replacements[entry] = patched.encode("utf-8")
            changed |= patched != text

        if not changed:
            print(f"Already patched: {archive}")
            return False

        fd, tmp_name = tempfile.mkstemp(prefix=archive.name + ".taskfix-", dir=archive.parent)
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            with zipfile.ZipFile(tmp, "w", allowZip64=True) as dst:
                dst.comment = src.comment
                for info in src.infolist():
                    dst.writestr(info, replacements.get(info.filename, src.read(info.filename)))

            with zipfile.ZipFile(tmp, "r") as check:
                verify_rebuilt_archive(check, entries)

            os.chmod(tmp, mode)
            os.replace(tmp, archive)
        finally:
            if tmp.exists():
                tmp.unlink()

    print(f"Patched: {archive}")
    return True


def main() -> None:
    if len(sys.argv) != 2:
        fail(f"Usage: {Path(sys.argv[0]).name} THUNDERBIRD_APP_DIR")
    root = Path(sys.argv[1]).expanduser().resolve()
    if not root.is_dir():
        fail(f"Not a directory: {root}")

    plans = locate(root)
    for plan in plans:
        rewrite_archive(plan)


if __name__ == "__main__":
    main()
