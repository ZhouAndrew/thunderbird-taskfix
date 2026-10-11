Independent **Thunderbird Text Planner 0.1.0 beta 1**, for Thunderbird **153 ESR**.

Install `thunderbird-text-planner-0.1.0b1.xpi` through Add-ons Manager → Install
Add-on From File. Open Text Planner from the main toolbar/extensions menu.

Features:
- New TXT plans require an explicit date and writable Thunderbird calendar.
- Continuous `#task` / `#event` sections, overlapping ranges and live preview.
- Stable UID lines plus a complete ICS block, hidden by default and optionally shown.
- Activation creates native Task/Event objects and verifies their read-back.
- Deactivation captures the latest edits, saves a separate verified TXT snapshot,
  then deletes only linked objects and verifies deletion. Original file retained.
- Reactivation restores completion, description, categories, custom properties,
  alarms and recurrence exceptions preserved in the ICS.
- Ownership checks, durable recovery journal, save-failure protection and CalDAV
  ETag/HTTP-412 conflict handling; no forced deletion or silent resurrection.

Validation: 47 automated tests; real official Thunderbird 153.1.0 ESR storage
calendar and editor tests; real Radicale 3.8.3 CalDAV create/edit/export/delete/
restore plus third-party and ETag-race tests. Reports and SHA-256 are attached.
The release workflow publishes only after all acceptance checks pass.

Beta scope: Linux/headless native execution, with acceptance-only deterministic
file-picker selections. OS file-dialog clicking, the user's profile/CalDAV server,
Windows/macOS and other Thunderbird versions are not claimed tested. No live
synchronization; deactivate before editing an active plan. Fresh plans use local
floating time. See `addons/text-planner/README.md` and `TESTING.md` for details.

Separate add-on ID and directory; existing TaskFix 0.3.3 and CalDAV Assistant
start/stop/complete/cancel/currentWorkId behavior remain unchanged.
