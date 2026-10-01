# CalDAV Assistant Experimental

Current build: **0.3.7** for official Thunderbird **153.0.2 through 153.1.x**.

0.3.7 keeps the 0.3.6 simple UI and adds guided defaults without adding another framework. The add-on remains a direct Thunderbird Calendar/Tasks provider client; the normal user experience is a small task workflow.

## Work page

The Work page consumes existing VTODOs. Its default view is **Incomplete**, so completed/cancelled history stays available without filling the normal work list. The compact view selector can switch to Today, Overdue, Completed or All.

A compact Calendar selector uses Thunderbird's existing Calendar list. The persistent default is configured under Tools; changing the selector on Work is only a temporary view choice.

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
- **Record** — append one log entry (and optional attachments) to today's WordPress log post.
- **Logs** — complete persistent audit + technical diagnostics.
- **Tools** — settings and read/write connection tests.

## Guided defaults

Tools owns two lightweight user preferences:

- Default Task view (Incomplete by default).
- Default Task Calendar (including All Calendars).

When more than one Task Calendar exists and no default has been chosen, Work shows a short link to the exact Tools section. If a saved Calendar later disappears, Work falls back to All Calendars for the current session and guides the user back to settings instead of silently replacing the preference.

Saving Calendar/view defaults creates a one-step settings undo snapshot. The user can immediately undo the choice from Tools.

Inferred Work Calendar choices are one-shot only; the Assistant no longer silently persists an inferred Calendar as a user preference.

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

Normal Record writes are different: each submission appends one Gutenberg log entry to the single published daily post (new posts keep the existing helper title shape, for example `October 1  Thursday  2026`). The daily post is created only when that day's post does not yet exist; Record never asks the user for a per-entry post title or post status. Text entries keep the existing local `HH:MM` prefix, and attachments are appended as native Gutenberg media/file blocks.

## Diagnostics

The Logs page contains both:

- operation/audit records;
- the extension-owned profile log `caldav-assistant-experimental.log`.

See `DIAGNOSTICS.md`.

## Testing

Release acceptance requires more than syntax/unit tests. See `TESTING.md` and `NOTE.md`.
