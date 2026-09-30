# CalDAV Assistant Experimental

Current build: **0.3.5** for official Thunderbird **153.0.2 through 153.1.x**.

This branch keeps the direct Thunderbird Calendar/Tasks provider architecture from the 0.3.x rewrite, but replaces the CRUD-lab workspace with the actual CalDAV Assistant workflow.

## Main workflow

The Work page consumes already existing VTODOs:

select existing Task -> Start -> Working -> Pause/Resume -> Complete or Cancel

It does not create Tasks. Start/Resume create Work VEVENTs. Pause/Complete/Cancel close the current Work VEVENT. Every supported write is followed by provider read-back verification and a persistent on-screen receipt.

## Program blocks

- **Work**: Task lifecycle only.
- **Executor**: performs Start/Pause/Resume/Complete/Cancel and verifies writes.
- **Connections**: tests Thunderbird/CalDAV and WordPress read/write paths.
- **Logs**: persistent audit, separate from the workflow UI.
- **Record**: explicit WordPress post + attachment creation with Post/Media IDs in the receipt.
- **Today**: workflow activity derived from the local audit.

See ARCHITECTURE.md for the frozen responsibility boundary.

## Direct Thunderbird architecture

The add-on uses ThunderbirdCalDAV Experiment API -> Thunderbird Calendar/Tasks provider -> configured CalDAV server. It uses cal.manager, getItemsAsArray(), getItem(), addItem(), modifyItem() and deleteItem().

There is no Native Host, no Python companion process, and no second CalDAV client.

## Local auxiliary state

browser.storage.local stores only Assistant state such as current Task pointer, current Work VEVENT pointer, accumulated time, settings, latest receipt and audit history. Task/Event facts remain in Thunderbird/CalDAV.

No success/failure information may exist only as a disappearing popup. The latest receipt remains visible on Work and full history is available on Logs.

## Read/write diagnostics

The Calendar full test creates a temporary VEVENT only, then performs create -> read -> update -> read -> delete -> verify absence. It creates no VTODO.

The WordPress full test uses a temporary Draft post and test media, verifies both, then deletes them.

## Testing

CI covers the direct provider API, workflow state machine, WordPress connector, XPI contract, real Thunderbird + real Radicale workflow, persistent audit, Work VEVENT lifecycle, and restart of the same Thunderbird profile.
