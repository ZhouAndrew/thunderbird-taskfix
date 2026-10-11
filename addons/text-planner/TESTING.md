# Beta 1 validation — 2026-10-11

## Executed locally

- Official Linux x86_64 Thunderbird **153.1.0 ESR**, isolated profile.
- Real SQLite/storage calendar and real loopback **Radicale 3.8.3** CalDAV server.
- **47/47** Node.js tests, zero skipped: codec round trips, exact entry identities,
  overlap, invalid inputs, UTC/TZID preservation, multiline summaries, overnight
  ranges, recurrence exception grouping, custom properties/parameters; injected
  I/O faults, ownership conflict, concurrent changes, partial operation retry,
  external deletion, original backup protection and journal read-back.
- **30** native Thunderbird assertions: Task/Event creation; verified file writes;
  idempotent activation; modified title/due/description/category/completion and
  custom property capture; original file protection; deletion read-back;
  reactivation; real filesystem failure; concurrent modification; native alarm,
  recurrence and modified recurrence exception round trip.
- **14** real CalDAV assertions: server GET after creation, latest server edits,
  server 404 after deletion, completed-state restoration, independent third-party
  modification protection; a deliberate edit between the final GET and DELETE
  generates **HTTP 412** and is refused without forced deletion.
- **9** real Thunderbird editor DOM assertions: required date/calendar, selected
  template metadata, live preview, hidden/shown ICS, concrete deactivation
  preview, save/deactivate/reactivate and reopening the saved TXT. Save, Save As,
  Activate and Deactivate handlers are exercised in addition to these assertions.

`dist/native-report.json` and `dist/unit-report.txt` record the exact run. The
GitHub release workflow independently repeats these checks before publishing.

## Scope and limits

- The native runner uses real Thunderbird in headless mode and temporary native
  file paths. It substitutes file-picker *selection* in an acceptance-only copy;
  manually clicking the OS file dialog on a user's desktop is not claimed.
- This does not claim testing on the user's existing profile, their own CalDAV
  service, Windows/macOS, other Thunderbird versions or every server extension.
- Complete ICS serialized by Thunderbird/server is retained. Properties a
  provider cannot return are outside a lossless-backup guarantee. A mismatched
  activation read-back fails rather than claiming success.
- Active plan membership changes and live synchronization are deliberately not
  implemented. Deactivate, edit the resulting file, then reactivate.
- No user TaskFix or CalDAV Assistant extension files or workflow are modified.
