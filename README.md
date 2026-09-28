# Thunderbird TaskFix Clean — recurring-safe, with copied user data

This branch installs a **fresh side-by-side copy of the current system Thunderbird**, applies only the TaskFix patch, and then clones the user's current Thunderbird profile into a separate TaskFix profile. The original Thunderbird application and original profile are not modified.

The copied profile includes the user's existing mail/account/calendar/task settings and local profile data. The installer refuses to copy a live Thunderbird profile; close Thunderbird before running it.

## Install

```bash
chmod +x apply.sh selftest.sh uninstall.sh
./selftest.sh
./apply.sh
```

The launcher is:

```text
thunderbird-taskfix-clean
```

The desktop entry is named **Thunderbird TaskFix Clean <version>**.

### What "with data" means

On first install (and on an explicit reinstall), the installer resolves the current default profile from `~/.thunderbird/profiles.ini`, makes a full copied snapshot under:

```text
~/.local/share/thunderbird-taskfix-clean/profile
```

If a previous TaskFix Clean copied profile already exists, it is moved to a timestamped backup before a new snapshot is created.

This is intentionally different from the old experimental installer, which created an empty isolated profile.

### Current data-recovery step for the recurring-parent incident

If a repeating parent row in **All** currently shows `Completed` even though the series should continue, use the copied-data TaskFix Clean instance and change that parent once to **Status → Needs Action**. Sync, then verify the expected occurrence appears in **Today**.

After recovery, this branch prevents **Mark Completed** / **Status → Completed** from completing an unexpanded recurring parent in **All**. Concrete occurrences in **Today** / **Next Seven Days** can still be completed normally.

---


TaskFix is a user-local patch package for Thunderbird Tasks. It creates a **second copy of the installed Thunderbird** under `~/.local/opt`, leaving the Linux Mint / APT Thunderbird untouched.

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
- **Recurring-parent completion guard**: Thunderbird's unbounded **All** view returns the recurring parent itself. TaskFix now refuses `Completed`/`Mark Completed` on that parent so one click cannot complete the whole series and hide future occurrences. Use **Today** or **Next Seven Days** to complete a concrete occurrence. `Needs Action` remains allowed on the parent so an accidentally completed series can be repaired.

## Install / refresh

```bash
chmod +x apply.sh uninstall.sh selftest.sh
./selftest.sh
./apply.sh
```

The installer creates:

- application copy: `~/.local/opt/thunderbird-taskfix-<version>`
- isolated profile: `~/.local/share/thunderbird-taskfix/profile`
- launcher: `~/.local/bin/thunderbird-taskfix`
- desktop entry: `~/.local/share/applications/thunderbird-taskfix.desktop`

Safe/default launch:

```bash
thunderbird-taskfix-recurring-safe
```

To use your normal Thunderbird profile, first close the normal Thunderbird completely, then run:

```bash
thunderbird-taskfix-recurring-safe --system-profile
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
2. Restart Thunderbird TaskFix; the Status values persist after CalDAV sync.
3. Select several tasks; use **Category** to add and remove a category; every selected task changes while unrelated categories are preserved.
4. In **Today** or **Next Seven Days**, select 3–5 concrete occurrences of one recurring CalDAV VTODO; choose **Mark Completed**; all selected occurrences complete with no `Item changed on server` error.
5. In **All**, select a `(Repeating)` parent row and choose **Mark Completed** or **Status → Completed**; TaskFix must refuse the operation and the series must remain available on future dates.
6. Repeat the recurring-occurrence test with **Status** and **Category**.
7. Unselected occurrences remain unchanged.
8. Refresh/sync, restart TaskFix, then open the normal Thunderbird (not simultaneously on the same profile) and confirm Radicale shows the same data.

Until that passes, treat this branch as a **release candidate**, not a verified final release.

## Uninstall

```bash
./uninstall.sh
```

The generated TaskFix application and launcher are removed. The isolated profile is intentionally retained so calendar/mail configuration is not destroyed automatically.

## Safety

- No `sudo`.
- Does not edit `/usr/bin`, `/usr/lib`, APT, or the distro Thunderbird in place.
- Keeps the isolated profile outside the generated application copy.
- Re-running `apply.sh` refreshes only the generated application copy.


## Emergency repair for an already completed recurring parent

If an `All` row shows `(Repeating)` and `Status = Completed`, select that parent and choose **Status → Needs Action** once. Then sync and switch to **Today**. This clears the accidental parent-level completion; the new guard prevents a later **Completed** action in **All** from repeating the damage.
