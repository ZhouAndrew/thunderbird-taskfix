# CalDAV Assistant Experimental 0.3.5 — module boundaries

## Work / workflow

workspace.html + workspace.js only shows existing VTODOs and moves one selected Task through:

select existing Task -> Start -> Working -> Pause/Resume -> Complete or Cancel

Rules: the Work page does not create Tasks; no Task selected means no workflow buttons; Pause and Resume never appear together; full Task/Assistant state remains visible; the latest result is a persistent receipt rather than a disappearing popup.

## Executor

core/executor.js performs Start, Pause, Resume, Complete and Cancel. Data-changing steps follow write -> read back -> compare -> receipt. Start/Resume create Work VEVENTs; Pause/Complete/Cancel close them. Paused state uses X-CALDAV-ASSISTANT-PAUSED. Work VEVENTs carry X-CALDAV-ASSISTANT-WORK-SESSION and X-CALDAV-ASSISTANT-TASK-UID.

## Connection / diagnostics

connections.html + core/connection.js + core/wordpress.js test external paths. Calendar quick test reads calendars and existing VTODOs. Calendar full test creates only a temporary TEST VEVENT, reads it, updates it, reads it again, deletes it and verifies absence. It deliberately creates no VTODO.

WordPress full test authenticates, creates a temporary Draft post, reads/updates/reads it, uploads/reads temporary media, then deletes the media and test post.

## Recorder / audit

core/storage.js + logs.html persist timestamp, scope, action, success/failure and full structured receipt. Logs are an independent page. Passwords are configuration data and must never be copied into audit records.

## Independent tools

Work = lifecycle only.
Record = explicit WordPress long-form logging and attachments.
Today = today's workflow activity.
Connections = provider/network diagnostics.
Logs = persistent detailed audit.

## WordPress rule

Completing a Task does not automatically create a WordPress post. If WordPress is not invoked, the workflow receipt says so. When Record creates a post, the receipt shows Post ID, status, URL, Media IDs, parent Post IDs and read-back verification.

## Acceptance rule

Success is not 'the API call did not throw'. For paths that support read-back, success means write -> read back -> compare -> permanent receipt. Real Thunderbird + real Radicale acceptance must drive Start -> Pause -> Resume -> Complete on an already existing VTODO, verify Work VEVENT lifecycle and persistent audit, restart the same profile, and leave no test data behind.
