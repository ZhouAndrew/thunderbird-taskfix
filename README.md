# Thunderbird TaskFix Lab

TaskFix Lab is an experimental, user-local Thunderbird Tasks build. It installs under its **own Lab name and paths**, leaving both the Linux Mint / APT Thunderbird and an existing stable `thunderbird-taskfix` installation untouched.

This branch extends the original Mozilla Bug 1872561 workaround into a small batch editor for CalDAV VTODOs.

## Current feature branch goals

- **Multi-select Mark Completed**: selected occurrences of the same recurring VTODO are folded into one parent modification, avoiding successive writes against a stale CalDAV ETag.
- **Batch Status**: adds a `Status` menu beside the existing task actions with:
  - Not specified
  - Needs Action
  - In Progress
  - Completed
  - Cancelled
- **Batch Category**: the existing Category menu applies changes to every selected task instead of only `currentTask`.
- **VTODO consistency**: Completed uses Thunderbird's `isCompleted` logic so `STATUS:COMPLETED`, `PERCENT-COMPLETE:100`, and `COMPLETED` stay consistent. Returning to a non-completed state clears stale completion metadata first.
- **Recurring-task safety**: Category and Status use the same one-parent-per-recurring-VTODO batching as Mark Completed.

## Install / refresh

```bash
chmod +x apply.sh uninstall.sh selftest.sh
./selftest.sh
./apply.sh
```

The installer creates only Lab-specific paths:

- application copy: `~/.local/opt/thunderbird-taskfix-lab-<version>`
- isolated profile: `~/.local/share/thunderbird-taskfix-lab/profile`
- launcher: `~/.local/bin/thunderbird-taskfix-lab`
- desktop entry: `~/.local/share/applications/thunderbird-taskfix-lab.desktop`

It does **not** replace `~/.local/opt/thunderbird-taskfix-*`, `~/.local/bin/thunderbird-taskfix`, or `~/.local/share/thunderbird-taskfix/profile`.

Safe/default launch:

```bash
thunderbird-taskfix-lab
```

To use your normal Thunderbird profile, first close the normal Thunderbird completely, then run:

```bash
thunderbird-taskfix-lab --system-profile
```

Do not run two Thunderbird processes against the same profile at the same time.

## What gets patched

Inside Thunderbird's `omni.ja`, TaskFix modifies three Calendar UI source files:

- `calendar-task-tree-utils.js` — recurring-safe batch mutation core plus Status handling.
- `calendar-task-view.js` — multi-selection Category handling.
- `calendar-tab-panels.inc.xhtml` — adds the Status toolbar menu.

The patcher checks for expected source fragments and aborts on an unknown implementation instead of blindly editing a future Thunderbird build.

## Required human-path acceptance test

A green `selftest.sh` is **not** enough to call a release verified. On the real Thunderbird + Radicale setup, verify all of the following:

1. Ctrl/Shift-select several ordinary tasks; set **Status → In Progress**; every selected task changes.
2. Restart Thunderbird TaskFix Lab; the Status values persist after CalDAV sync.
3. Select several tasks; use **Category** to add and remove a category; every selected task changes while unrelated categories are preserved.
4. Select 3–5 occurrences of one recurring CalDAV VTODO; choose **Mark Completed**; all selected occurrences complete with no `Item changed on server` error.
5. Repeat the recurring-occurrence test with **Status** and **Category**.
6. Unselected occurrences remain unchanged.
7. Refresh/sync, restart TaskFix, then open the normal/stable Thunderbird (not simultaneously on the same profile) and confirm Radicale shows the same data.

Until that passes, treat this branch as a **release candidate**, not a verified final release.

## Uninstall

```bash
./uninstall.sh
```

The generated TaskFix application and launcher are removed. The isolated profile is intentionally retained so calendar/mail configuration is not destroyed automatically.

## Safety

- No `sudo`.
- Does not edit `/usr/bin`, `/usr/lib`, APT, the distro Thunderbird, or the stable TaskFix installation in place.
- Keeps a Lab-only isolated profile outside the generated application copy.
- Re-running `apply.sh` refreshes only the generated **Lab** application copy.
