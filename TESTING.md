# TESTING — CalDAV Assistant Experimental 0.3.6

A release is not considered verified merely because the XPI builds.

## 1. Static / package contract

Required:

- JavaScript syntax checks pass.
- XPI archive integrity passes.
- Manifest name/version/extension ID are correct.
- No native companion process is required.
- Work page does not contain developer-only fields.
- Tools contains Calendar/WordPress connection tests.
- Logs contains operation audit and technical diagnostics.

## 2. Unit / harness tests

Required PASS:

- `tests/taskfix-addon-harness.js`
- `tests/direct-caldav-api-harness.js`
- `tests/workflow-harness.js`
- `tests/connection-harness.js`
- `tests/wordpress-connector-harness.js`
- `tests/check-xpi.py`

Specific invariants:

- Start/Pause/Resume/Complete/Cancel return a persistent Result.
- Audit write occurs before latest-result cache write.
- Calendar connection full test never creates a VTODO.
- Calendar full test cleans up its temporary VEVENT.
- WordPress full test cleans up its temporary Draft post and media.
- WordPress credentials are not copied into audit records.

## 3. Real Thunderbird + real Radicale

Matrix:

- 153.0.2esr / UTC
- 153.0.2esr / Asia/Shanghai
- 153.1.0esr / UTC
- 153.1.0esr / Asia/Shanghai
- 153.1.1esr / UTC
- 153.1.1esr / Asia/Shanghai

Acceptance path:

1. Start with a real Radicale collection containing an existing VTODO.
2. Open CalDAV Assistant.
3. Confirm zero workflow buttons before Task selection.
4. Confirm Work does not expose UID, raw VTODO state, Work Calendar, or Calendar filter.
5. Select the existing Task.
6. Start.
7. Verify Task becomes IN-PROCESS after provider read-back.
8. Verify a Work VEVENT is created and re-read.
9. Pause.
10. Verify Work VEVENT closes and paused state is re-read.
11. Resume.
12. Verify a new Work VEVENT is created.
13. Complete.
14. Verify Task becomes COMPLETED / 100% and the final Work VEVENT closes.
15. Verify the recent result remains visible.
16. Verify the persistent audit contains Start/Pause/Resume/Complete.
17. Verify the result says the log was written.
18. Restart the same Thunderbird profile.
19. Repeat acceptance.
20. Verify test VEVENTs are cleaned up and the seed VTODO is restored for the harness.

## 4. Human-profile acceptance before merge

On the user's real Thunderbird profile:

- existing real Tasks appear without creating a new Task;
- Start/Pause/Resume/Complete/Cancel behave correctly;
- no action buttons appear in impossible states;
- completed/cancelled Task has no workflow buttons;
- recent result never relies on a disappearing popup;
- full detail is visible in Logs;
- Tools can test Calendar reads/writes;
- Tools can test WordPress reads/writes;
- Record reports the actual WordPress Post ID and Media IDs;
- restart Thunderbird and confirm state/log recovery.

Only after this human-profile pass should the experimental branch be considered ready to merge/release.
