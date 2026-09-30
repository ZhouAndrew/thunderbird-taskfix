# Thunderbird TaskFix XPI

Current standalone build: 0.2.1 for official Thunderbird 153.x.

This is a standalone Thunderbird enhancement add-on. It does not patch or replace Thunderbird application files and has no dependency on any companion application.

## 0.2.1

- Standalone add-on identity and packaging; no `apply.sh` is needed for normal use.
- Explicit background activation calls the Experiment API after install/startup, while the Experiment startup hook remains as a fallback.
- Existing Thunderbird main windows are injected immediately; future main windows are handled by the registered window listener.
- Resolves the real selected rows from the active task tree, including Ctrl/Shift multi-selection.
- Recurring-safe batch mutation core groups selected occurrences by recurring parent before committing changes.
- Adds a complete Status menu in both the task toolbar and task right-click context menu.
- Status values: Not specified, Needs Action, In Progress, Completed, Cancelled.
- Multi-select Mark Completed / Progress uses the same recurring-safe batch core.
- Multi-select Category uses the same recurring-safe batch core.
- Multi-select Priority is also routed through the recurring-safe batch core.
- Delete remains Thunderbird's native delete command because Thunderbird already receives the complete selected task list and owns recurrence/deletion confirmation semantics.
- Disabling or uninstalling this add-on restores the original Thunderbird functions and removes injected menus.

## Acceptance checklist

1. Install the XPI into an unmodified official Thunderbird 153.x profile.
2. Ctrl/Shift-select 3 ordinary tasks.
3. Mark Completed: all 3 must become completed.
4. Change Status to Cancelled, Needs Action, In Progress and Completed: every selected task must change.
5. Change Category: every selected task must change and mixed-category selection must be handled.
6. Change Priority: every selected task must change.
7. Repeat completion/status/category/priority tests with multiple selected occurrences of one recurring VTODO.
8. Delete multiple selected tasks with Thunderbird's native Delete button and verify the normal confirmation/recurrence behavior.
9. Sync, restart Thunderbird, and verify persistence.
10. Disable/uninstall the extension and verify the original Thunderbird UI/handlers are restored.
