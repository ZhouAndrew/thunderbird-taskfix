# CalDAV Assistant Experimental

Current build: **0.3.6** for official Thunderbird **153.0.2 through 153.1.x**.

0.3.6 deliberately removes developer-console style UI. The add-on remains a direct Thunderbird Calendar/Tasks provider client; the normal user experience is a small task workflow.

## Work page

The Work page consumes existing VTODOs:

select Task -> Start -> Working -> Pause/Resume -> Complete or Cancel

It does not create Tasks.

Before selection: no workflow buttons.

Selected idle Task: Start only.

Working Task: Pause / Complete / Cancel.

Paused Task: Resume / Complete / Cancel.

Completed or cancelled Task: no workflow buttons.

The Work page does **not** show UID, raw VTODO state, internal Assistant state, Work Calendar selectors, provider IDs, or JSON details.

## Five pages

- **Work** — Task lifecycle.
- **Today** — today's workflow activity.
- **Record** — explicit WordPress log + attachments.
- **Logs** — complete persistent audit + technical diagnostics.
- **Tools** — settings and read/write connection tests.

## Simple internals

The core is plain functions plus a few plain JavaScript objects. There is no extra workflow framework or class hierarchy.

`core/executor.js` exposes Start/Pause/Resume/Complete/Cancel functions.

`core/connection.js` tests Calendar reads/writes.

`core/wordpress.js` talks to WordPress.

`core/storage.js` stores settings/runtime/audit and enforces the log-before-display rule.

## Reliability rules

Data-changing Calendar paths use:

write -> read back -> compare -> Result

A Result is persisted to the audit log before it is returned to the UI. If logging itself fails, the visible Result says so.

Start/Resume create Work VEVENTs. Pause/Complete/Cancel close them.

Task/Event facts remain in Thunderbird/CalDAV.

## Connection tests

Calendar full test creates only a temporary VEVENT:

create -> read -> update -> read -> delete -> verify absence

It never creates a VTODO.

WordPress full test uses a temporary Draft post + test media, verifies them, then deletes them.

## Diagnostics

The Logs page contains both:

- operation/audit records;
- the extension-owned profile log `caldav-assistant-experimental.log`.

See `DIAGNOSTICS.md`.

## Testing

Release acceptance requires more than syntax/unit tests. See `TESTING.md` and `NOTE.md`.
