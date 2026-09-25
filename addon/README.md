# Thunderbird TaskFix Lab XPI

Current lab build: 0.1.1 (Thunderbird 153.x).

## 0.1.1

- Fixes multi-selection resolution by reading the actual selected rows from the active task tree.
- Adds a complete Status menu in both places:
  - task action toolbar;
  - task right-click context menu.
- Status values:
  - Not specified
  - Needs Action
  - In Progress
  - Completed
  - Cancelled
- Status, Progress/Mark Completed and Category share the same recurring-safe batch mutation core.
- Disabling/uninstalling the extension restores Thunderbird's original functions and removes injected menus.

## Human-path acceptance

1. Ctrl/Shift-select 3 ordinary tasks.
2. Right-click -> Status -> Cancelled. All 3 must become CANCELLED.
3. Repeat with Needs Action, In Progress and Completed.
4. Repeat through the toolbar Status menu.
5. Test Mark Completed and Category with the same multi-selection.
6. Repeat with multiple occurrences of one recurring CalDAV VTODO.
7. Sync/restart and verify persistence.
