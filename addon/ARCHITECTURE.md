# CalDAV Assistant Experimental 0.3.6 — simple program boundary

The design goal is deliberately ordinary: a small UI, a set of plain functions, a few plain objects, strict read-back checks, and persistent logs.

## Work

`workspace.html + workspace.js` only does this:

existing Task -> select -> Start -> Working -> Pause/Resume -> Complete or Cancel

Rules:

- the Work page never creates a Task;
- before a Task is selected there are no workflow buttons;
- only actions valid for the current state are shown;
- completed/cancelled Tasks show no workflow buttons;
- UID, raw VTODO status, Work Calendar, provider IDs and JSON details do not appear on the Work page;
- the Work page keeps only a short human-readable recent result.

## Plain action functions

`core/executor.js` is intentionally a file of plain functions. It does not define a class hierarchy or workflow framework.

The public operations are:

- `start(task, workCalendarId)`
- `pause(task)`
- `resume(task, workCalendarId)`
- `complete(task)`
- `cancel(task)`

Data-changing paths use:

write -> read back -> compare -> Result

Start/Resume create Work VEVENTs. Pause/Complete/Cancel close the current Work VEVENT. Rollback code exists only where a partial remote write could otherwise leave inconsistent data.

## Small data objects

Runtime data is ordinary JavaScript objects:

- Task view
- Work event reference
- Runtime state
- Result/receipt
- Settings

There is no domain class hierarchy.

## Logging rule

Every user-visible success/failure result is sent to `AssistantStorage.persistResult()` before the function returns it to the UI.

That function attempts:

Result -> append persistent audit -> cache latest Result -> return to UI

If the persistent audit write fails, `logSaved=false` and the UI must say so instead of pretending the result was safely logged.

The Logs page owns full technical detail. The Work page only shows a short result plus a link to Logs.

## Tools

`tools.html` owns settings and connection tests.

Calendar full test:

temporary TEST VEVENT -> read -> update -> read -> delete -> verify absence

It never creates a VTODO.

WordPress full test:

temporary Draft Post -> read -> update -> read -> temporary media -> read -> delete media -> delete post

## WordPress

`record.html` explicitly creates long-form WordPress records. Completing a Task does not implicitly create a WordPress Post.

The visible result reports concrete Post ID / Media ID values; the full request/result record stays in Logs.

## Data ownership

- Thunderbird/CalDAV = Task and Event facts.
- browser.storage.local = small Assistant runtime/settings/audit state only.
- WordPress = explicit long-form records.

## Top-level UI

Exactly five ordinary pages:

Work | Today | Record | Logs | Tools

The internal implementation may have supporting files, but those are not additional user workflows.
