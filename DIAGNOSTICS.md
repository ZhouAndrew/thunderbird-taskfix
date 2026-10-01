# CalDAV Assistant Experimental 0.3.x diagnostics

Version 0.3.5 adds a persistent, extension-owned diagnostic log for production troubleshooting.

## Where the log is

Open **Thunderbird CalDAV → 诊断**. The page shows the exact profile-local path.

The file name is:

```text
caldav-assistant-experimental.log
```

The extension keeps one rotated backup:

```text
caldav-assistant-experimental.log.1
```

The current file rotates at about 1 MiB. Logs live inside the active Thunderbird profile; the add-on does not require a Native Host, Python process, daemon, or external logger.

## What is recorded

Each line is JSON and includes an ISO timestamp, component, event, and compact details.

The main sources are:

- extension startup and Space creation;
- TaskFix Experiment activation and Tasks UI injection;
- TaskFix fallback insertion when Thunderbird changes toolbar layout;
- direct Thunderbird provider Task/Event create, update and delete operations;
- slow provider reads (750 ms or slower);
- provider and UI errors;
- workspace refresh summaries;
- real-acceptance diagnostic probes.

Normal high-frequency successful reads are not logged unless they are slow, which keeps the log useful without turning it into a trace flood.

## Privacy rules

The diagnostic logger does not intentionally record CalDAV credentials or authorization headers. Detail keys containing password, secret, token, authorization, or credential are replaced with `[redacted]`.

The real Thunderbird acceptance test verifies that a deliberately supplied password-shaped value is not written to the log.

Task and Event titles/descriptions are not included in provider mutation log records. Calendar/item identifiers may be included because they are needed to correlate failures.

## Using the Diagnostics tab

The **诊断** tab provides:

- Refresh — read the newest log lines;
- Copy — copy the displayed diagnostic bundle, including version and log path;
- Clear — clear current and rotated logs.

When reporting a production problem, reproduce it once and copy the Diagnostics output immediately afterward.

## CI diagnostics

The real Thunderbird + real Radicale matrix always uploads a per-version/per-timezone diagnostic artifact, including the CalDAV Assistant log and Thunderbird/Radicale stdout/stderr when available. Artifacts are uploaded even when the acceptance job fails.

A release is not considered verified only because syntax/unit tests pass. The real matrix exercises Thunderbird 153.0.2esr, 153.1.0esr and 153.3.1esr in UTC and Asia/Shanghai, including restart persistence.
