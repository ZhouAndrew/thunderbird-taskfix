# Thunderbird CalDAV Lab

Current build: **0.3.2** for official Thunderbird 153.x.

This project is a Thunderbird extension. It is **not** the separate Python/CLI CalDAV Assistant project.

## Architecture

The add-on reads and writes calendar data through Thunderbird itself:

```text
Thunderbird CalDAV Lab XPI
        |
        +-- ThunderbirdCalDAV Experiment API
        |       |
        |       +-- cal.manager
        |       +-- calICalendar.getItemsAsArray()
        |       +-- calICalendar.addItem()
        |       +-- calICalendar.modifyItem()
        |       +-- calICalendar.deleteItem()
        |
        +-- Thunderbird Calendar / Tasks providers
                    |
                    +-- CalDAV provider
                    +-- local/offline cache
                    |
                    +-- configured CalDAV server
```

There is no Native Host, no Python process, no companion daemon, and no second CalDAV client in this add-on.

## 0.3.2 hardening

- Uses Thunderbird's exported `CalTodo` and `CalEvent` constructors directly; `cal.createTodo()` / `cal.createEvent()` do not exist in current Thunderbird calendar utilities.
- Keeps the direct provider CRUD harness and package contract checks aligned with the real Thunderbird constructor API.

## 0.3.1 hardening

- Imports Thunderbird's real `ExtensionError` implementation instead of relying on an undeclared global.
- Rejects disabled/read-only calendars and calendars that do not support the requested item type.
- Validates VTODO status, priority and percent-complete values.
- Uses `calendar.getItem()` for exact update/delete targets.
- Rejects VEVENT end times earlier than their start.
- Prevents accidental cross-calendar edits by locking the Calendar selector while editing an existing item.
- Read-only items remain viewable but Save/Delete are disabled.
- Makes the UI's event-range end date inclusive.
- Adds a direct Calendar-provider API harness covering create/read/update/delete and error paths.

## 0.3.0 rewrite

- Adds a Thunderbird Space named **Thunderbird CalDAV**.
- Reads Thunderbird's configured calendars directly.
- Lists VTODO tasks directly from Thunderbird.
- Lists VEVENT events directly from Thunderbird.
- Creates, edits and deletes VTODO through Thunderbird's calendar provider.
- Creates, edits and deletes VEVENT through Thunderbird's calendar provider.
- Supports task title, due date, standard VTODO status, priority, categories and description.
- Supports event title, start/end, categories and description.
- Watches Thunderbird calendar changes and refreshes the workspace.
- Keeps the existing recurring-safe multi-select Status/Progress/Category/Priority fixes in the native Tasks view.
- Uses Thunderbird/OS light and dark colors.
- Does not patch Thunderbird application files.

## CalDAV responsibility

If a selected Thunderbird calendar is CalDAV-backed, Thunderbird's own provider performs the CalDAV network synchronization. This add-on does not make a parallel HTTP/CalDAV connection.

If a selected calendar is local, changes remain local because that is the calendar Thunderbird exposes.

## Acceptance checklist

1. Install the XPI in Thunderbird 153.x.
2. Open the **Thunderbird CalDAV** Space.
3. Confirm configured Thunderbird calendars are listed.
4. Confirm existing CalDAV VTODOs appear without any external process.
5. Create a task; verify it appears in Thunderbird Tasks and on the CalDAV server after Thunderbird sync.
6. Edit title, due date, status, priority, category and description; verify persistence after restart.
7. Delete a task; verify deletion after sync.
8. Create/edit/delete an event and verify it in Thunderbird Calendar and on the server.
9. Make a change in Thunderbird's normal Tasks/Calendar UI and verify the Space refreshes.
10. Re-run multi-select recurring-task Status/Progress/Category/Priority acceptance.
