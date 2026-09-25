#!/usr/bin/env python3
from __future__ import annotations

import os
import stat
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Callable, NoReturn

HERE = Path(__file__).resolve().parent
PATCH_DIR = HERE / "patches"
MARKER = "THUNDERBIRD_TASKFIX_BATCH_EDIT_V2"

TASK_UTILS = "calendar-task-tree-utils.js"
TASK_VIEW = "calendar-task-view.js"
TASK_PANELS = "calendar-tab-panels.inc.xhtml"


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


def patch_task_panels(text: str) -> str:
    if 'id="task-actions-status"' in text:
        return text
    anchor = '                    <toolbarbutton is="toolbarbutton-menu-button" id="task-actions-markcompleted"'
    if anchor not in text:
        fail("Could not find task action toolbar insertion point")
    return text.replace(anchor, load_patch("status-button.xhtml.part") + anchor, 1)


PATCHERS: dict[str, Callable[[str], str]] = {
    TASK_UTILS: patch_task_utils,
    TASK_VIEW: patch_task_view,
    TASK_PANELS: patch_task_panels,
}


def candidate_archives(root: Path):
    seen = set()
    for path in [root / "omni.ja", root / "browser" / "omni.ja"]:
        if path.is_file():
            seen.add(path.resolve())
            yield path
    for pattern in ("*.ja", "*.jar"):
        for path in root.rglob(pattern):
            rp = path.resolve()
            if rp not in seen and path.is_file():
                seen.add(rp)
                yield path


def locate(root: Path) -> tuple[Path, dict[str, str]]:
    matches: list[tuple[Path, dict[str, str]]] = []
    for archive in candidate_archives(root):
        try:
            with zipfile.ZipFile(archive, "r") as zf:
                found: dict[str, str] = {}
                for name in zf.namelist():
                    base = name.rsplit("/", 1)[-1]
                    if base in PATCHERS:
                        found[base] = name
                if len(found) == len(PATCHERS):
                    matches.append((archive, found))
        except zipfile.BadZipFile:
            continue

    if not matches:
        fail("Could not find all TaskFix target files inside one .ja/.jar archive")
    if len(matches) > 1:
        fail("Found multiple candidate archives containing all TaskFix targets")
    return matches[0]


def rewrite_archive(archive: Path, entries: dict[str, str]) -> bool:
    mode = stat.S_IMODE(archive.stat().st_mode)
    with zipfile.ZipFile(archive, "r") as src:
        replacements: dict[str, bytes] = {}
        changed = False
        for base, entry in entries.items():
            try:
                text = src.read(entry).decode("utf-8")
            except UnicodeDecodeError as exc:
                fail(f"{entry} is not UTF-8: {exc}")
            patched = PATCHERS[base](text)
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
                bad = check.testzip()
                if bad:
                    fail(f"Rebuilt archive failed CRC test at {bad}")
                util_text = check.read(entries[TASK_UTILS]).decode("utf-8")
                view_text = check.read(entries[TASK_VIEW]).decode("utf-8")
                panel_text = check.read(entries[TASK_PANELS]).decode("utf-8")
                if MARKER not in util_text or MARKER not in view_text:
                    fail("TaskFix marker missing after archive rebuild")
                if 'id="task-actions-status"' not in panel_text:
                    fail("Status toolbar button missing after archive rebuild")

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
    archive, entries = locate(root)
    rewrite_archive(archive, entries)


if __name__ == "__main__":
    main()
