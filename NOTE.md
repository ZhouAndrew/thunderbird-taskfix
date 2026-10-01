# NOTE — CalDAV Assistant Experimental

This file is the running development note for the Thunderbird CalDAV Assistant branch. Update it after meaningful code or acceptance changes.

## 2026-10-01 — 0.3.6 simple/reliable rewrite

### Version / branch

- Version: **0.3.6**
- Branch: `feat/caldav-assistant-simple-0.3.6`
- Tested code head: `326d170b342f68db5b1867f67df9ccb30e8b07c9`

### Goal

Reduce the 0.3.x workspace from a developer-style CRUD/control panel to an ordinary task program while keeping the direct Thunderbird provider architecture and strict verification.

The user-facing rule is now:

existing Task -> select -> Start -> Pause/Resume -> Complete/Cancel

### UI changes

Work now contains only:

- Task search/list;
- selected Task title;
- human-readable state;
- due date;
- accumulated working time when active;
- only the actions valid for the current state;
- a short, persistent recent result;
- a link to the full Logs page.

Removed from Work:

- UID;
- raw VTODO state;
- separate internal Assistant state;
- Work Calendar selector;
- Calendar selector/filter;
- developer JSON;
- permanent idle/read-count status banners.

Top-level pages are exactly:

`Work | Today | Record | Logs | Tools`

Settings and read/write tests moved to Tools.

### Internal changes

Kept intentionally small:

- `core/executor.js`: plain Start/Pause/Resume/Complete/Cancel functions;
- `core/connection.js`: plain Calendar connection-test functions;
- `core/wordpress.js`: plain WordPress functions;
- `core/storage.js`: runtime/settings/audit plus one `persistResult()` helper.

No new class hierarchy, workflow framework, event bus, repository layer, or manager stack was introduced.

### Logging rule

Any success/failure result that can later be overwritten on screen is persisted before the function returns it to the UI.

Order:

`Result -> persistent audit -> latest-result cache -> UI`

If the audit write fails, the returned result has `logSaved=false` and the UI says that logging failed.

### Read/write behavior

Calendar workflow changes still use write -> read back -> compare.

Calendar full connection test:

`temporary TEST VEVENT -> read -> update -> read -> delete -> verify absence`

It deliberately creates **no VTODO**.

WordPress full connection test:

`temporary Draft Post -> read -> update -> read -> test Media -> read -> delete Media -> delete Post`

### Failures / regressions found during development

The first staged 0.3.6 commits intentionally broke old static UI expectations because the tests still expected the 0.3.5 developer workspace. Those CI failures were treated as migration failures, not ignored. The XPI contract, workflow acceptance, and connection tests were updated before calling the branch tested.

A separate issue was found in the new log-before-display helper: `logSaved=true` was initially attached only after the audit object had already been written. That meant a reloaded receipt could lose the visible “result was logged” flag. It was fixed by placing the flag into the Result before the audit write.

### Automated verification

Selftest run for tested head: **PASS**.

The following all passed:

- legacy selftest;
- TaskFix add-on harness;
- direct Thunderbird Calendar provider harness;
- workflow harness;
- Calendar connection harness;
- WordPress connector harness;
- 0.3.6 XPI contract.

The workflow harness also verifies that the persistent audit key is written before the latest-result cache key.

### Real Thunderbird + real Radicale

Real matrix: **6 / 6 PASS**

- Thunderbird 153.0.2esr / UTC
- Thunderbird 153.0.2esr / Asia/Shanghai
- Thunderbird 153.1.0esr / UTC
- Thunderbird 153.1.0esr / Asia/Shanghai
- Thunderbird 153.1.1esr / UTC
- Thunderbird 153.1.1esr / Asia/Shanghai

The real acceptance uses an existing VTODO and drives:

`Start -> Pause -> Resume -> Complete`

It verifies:

- simple Work UI contract;
- no workflow buttons before selection;
- no UID / Work Calendar / Calendar filter on Work;
- five top-level pages;
- Work VEVENT lifecycle;
- Task write/read-back;
- persistent audit;
- persistent result;
- log-before-display flag;
- restart of the same Thunderbird profile;
- cleanup of test VEVENT data;
- persistent production diagnostics.

### Release status

Automated code and real Thunderbird/Radicale acceptance are green.

Still keep the branch experimental until the XPI is installed into the user's actual Thunderbird profile and the same human path is accepted there.
