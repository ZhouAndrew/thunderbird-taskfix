# Thunderbird Text Planner 0.1.0 beta 1

Independent add-on in the TaskFix repository. Unique add-on ID; the existing
`addon/` TaskFix 0.3.3 is not modified. CalDAV Assistant's work controls and
`currentWorkId` are not part of this add-on.

## Install and use

Thunderbird **153 ESR**: Add-ons Manager → gear → Install Add-on From File →
select `thunderbird-text-planner-0.1.0b1.xpi`. The Experiment API requires full
Thunderbird permissions. Click **Text Planner** in the main toolbar (or its
extensions menu), then **新建**. Choose the date and an existing writable calendar.

```text
#date=2026-10-11
#calendar=<actual Thunderbird calendar ID>
#timezone=floating

#task
09:00-09:35 Anki
09:05-09:40 constart mars

#event
14:00-15:00 English
```

Activation saves the file, assigns stable plan/entry IDs and creates native
Task/Event objects. The saved TXT contains `#uid` lines and a complete ICS block
at the end. The editor hides that block by default; the checkbox shows it.
Move the UID line with its corresponding entry. Duplicate titles and overlaps
are allowed. `..` is not a valid item.

To deactivate, reopen the activated file, click **去激活…**, review the current
Thunderbird snapshot and deletion count, and choose a **different** output file.
The add-on saves and reads back the snapshot before deleting the associated
objects. Original TXT remains intact. Activate the resulting file to restore
its UID, completion, description, categories and other preserved ICS fields.

## Deliberate boundaries

- This is activate/deactivate, not live synchronization. Editing an active
  text plan does not overwrite native changes. Deactivate first to capture
  native changes, then edit/reactivate the resulting TXT.
- Calendar identity uses the actual Thunderbird ID, not a mutable display name.
  Moving a file to another profile requires explicit re-selection/editing of
  the target ID. Active associations are recorded in the profile journal;
  another profile cannot delete objects without that association.
- Fresh entries use floating local times. Existing UTC/TZID data is preserved.
  Overnight entries accept `2026-10-11T23:00-2026-10-12T01:00 Title`.
- All-day, undated, second-precision and other non-projectable objects remain
  as `#preserved=<UID>` plus complete ICS. Do not delete these markers.
- Recurrence exceptions stay grouped with their parent UID. The editor does
  not expand them into separate tasks. No byte-for-byte formatting guarantee;
  the goal is semantic preservation of the serialized native objects.
- Repeated activation is idempotent. Conflicts, foreign UID ownership and
  external deletions are rejected instead of overwritten or resurrected.
- Calendar/file failures retain the journal and saved snapshot. After partial
  activation reopen the already saved TXT and retry activation. After partial
  deletion reopen the activated TXT and retry deactivation; the archive retains
  objects already deleted. Disabling/uninstalling does not delete native data.
- CalDAV reads use Thunderbird's authenticated request/session implementation;
  deletes use `If-Match` with a freshly read ETag and require a 404 read-back.
  A 409/412 never triggers forced deletion. Cached/offline success is not
  treated as server verification. No certificate bypass is implemented.

## Architecture and reproducible testing

`core/codec.mjs`: pure TXT/ICS parser/compiler/decompiler, bundled ICAL.js 2.2.1.
`core/executor.mjs`: effect orchestration with injected dependencies.
`api/TextPlanner/implementation.js`: thin native calendar/file/journal boundary.
`editor/`: lightweight textarea IDE, live preview and optional ICS display.

```sh
node --test addons/text-planner/tests/*.test.mjs
python3 addons/text-planner/build.py
TB_BINARY=/path/to/thunderbird TEST_CALDAV=1 \
  python3 addons/text-planner/tests/run-native.py dist/native-report.json
```

The native runner requires Python `radicale` for `TEST_CALDAV=1`. It uses a new
isolated profile and a loopback test server, never a user's profile. It adds
acceptance-only instrumentation to a copy of the extension to select temporary
file paths instead of operating an OS file picker. Production API, filesystem
writes, storage calendar, CalDAV requests, editor handlers and DOM run inside
real Thunderbird. Production XPI does not include the instrumentation.

See `TESTING.md` for the exact verified scope and remaining limits. Supported
Thunderbird version is intentionally bounded to 153.* because the adapter uses
internal Experiment APIs. No claim of compatibility with every CalDAV server.
