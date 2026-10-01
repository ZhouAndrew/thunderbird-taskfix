# Real Thunderbird GUI Acceptance

This file is the **standing testing convention** for Thunderbird TaskFix.

A version is **not** considered a stable TaskFix release merely because unit tests, JavaScript harnesses, packaging checks, or mock transaction tests pass. Before a stable release is published, the release candidate must pass the real Thunderbird GUI acceptance path described here.

## Reference baseline

The first complete reference run is **TaskFix 0.3.3** on the official **Thunderbird 153.1.0esr** Linux build.

The passing real-GUI result was:

```json
{"ok":true,"thunderbirdVersion":"153.1.0","marker":"THUNDERBIRD_TASKFIX_ADDON_V3_3","lateTasksPanelActivation":true,"realTaskTreeMultiSelect":true,"batchTransactionCount":2,"directCalendarUndo":true,"directCalendarRedo":true,"ctrlZUndo":true,"ctrlShiftZRedo":true,"commandUndo":true,"commandRedo":true}
```

The automated real-GUI entry point is:

```bash
tests/real-thunderbird-taskfix-undo.sh 153.1.0esr
```

and the GitHub Actions workflow is:

```text
.github/workflows/real-thunderbird-taskfix-undo.yml
```

The test runs the official Thunderbird binary in a real GUI session under Xvfb. It is not a DOM-only mock and not a Node-only simulation.

## Required end-to-end path

For every stable candidate, run the following path against an isolated Thunderbird profile.

1. Start the official Thunderbird build with TaskFix installed.
2. Keep the **Tasks** panel closed for more than 15 seconds.
   - This verifies cold-start activation.
   - TaskFix must not require manually reloading the extension.
3. Open the real **Tasks** UI.
   - TaskFix controls must appear without reloading.
   - The Status control and patched task handlers must be active.
4. Create two real Thunderbird VTODO items in a Thunderbird Calendar.
5. Make both VTODO rows visible in the real task tree.
6. Multi-select both rows in the real task tree.
7. Change both tasks through TaskFix, for example:
   - **Status → In Progress**
8. Verify the Calendar transaction manager contains **one batch transaction** with **two item modifications**.
9. Run TaskFix direct **Undo**.
   - Both tasks must return to their previous state.
10. Run TaskFix direct **Redo**.
    - Both tasks must return to the modified state.
11. With the real Tasks UI active, press **Ctrl+Z**.
    - Both items must be undone together.
12. Press **Ctrl+Shift+Z**.
    - Both items must be redone together.
13. Use Thunderbird **Edit → Undo**.
    - The TaskFix batch must be undone through the Calendar transaction path, not the mail/editor undo stack.
14. Use Thunderbird **Edit → Redo**.
    - The same TaskFix batch must be restored.
15. Verify editable text controls still keep their normal text-editor Ctrl+Z behavior.
16. Disable/uninstall TaskFix and verify injected handlers/controllers are removed cleanly.

## Broader stable-release acceptance

The Undo/Redo path above is mandatory, but it does not replace the rest of TaskFix acceptance.

Before a stable release, also verify on real tasks:

- multi-select **Status**
- multi-select **Progress**
- multi-select **Category**
- multi-select **Priority**
- multi-select **Mark Completed**
- recurring-VTODO occurrence safety
- native multi-select Delete behavior
- CalDAV sync/persistence
- restart persistence
- disable/uninstall cleanup

For CalDAV-sensitive changes, repeat the relevant path against a real CalDAV calendar, not only a memory calendar.

## Pass/fail rule

A stable release may be published only when all of the following are true:

- ordinary automated tests pass;
- XPI packaging/contract checks pass;
- the real Thunderbird GUI acceptance passes;
- the tested XPI is the same build intended for release;
- any release-specific human-path checks on the user's real profile / CalDAV data pass.

If the real GUI acceptance fails, the candidate remains an **RC / prerelease**. Fix the failure and rerun the complete path. Do not declare the version stable based on partial success.

## Convention for future versions

This procedure is now a project convention.

When TaskFix changes UI injection, startup behavior, multi-selection, transactions, Undo/Redo, recurrence handling, or CalDAV writes, update this acceptance test together with the code.

For every future stable TaskFix release:

1. keep this real-GUI acceptance runnable;
2. run it before stable publication;
3. record the Thunderbird version and result;
4. preserve any newly discovered regression as an automated acceptance check;
5. do not remove a previously required real-world check merely because a unit test covers similar code.

The Thunderbird version may advance as TaskFix support advances, but the **behavioral path and release gate remain mandatory**.
