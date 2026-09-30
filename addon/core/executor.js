"use strict";

(() => {
  function errorText(error) {
    return String(error?.message || error || "Unknown error");
  }

  function toLocalInput(value = new Date()) {
    const pad = number => String(number).padStart(2, "0");
    return [
      value.getFullYear(),
      pad(value.getMonth() + 1),
      pad(value.getDate()),
    ].join("-") +
      "T" +
      [pad(value.getHours()), pad(value.getMinutes()), pad(value.getSeconds())].join(":");
  }

  function newReceipt(action, task) {
    return {
      id: `receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action,
      success: false,
      startedAt: new Date().toISOString(),
      completedAt: null,
      task: task
        ? {
            id: task.id,
            calendarId: task.calendarId,
            calendarName: task.calendarName,
            title: task.title,
            beforeStatus: task.status || "",
            beforePaused: Boolean(task.paused),
          }
        : null,
      steps: [],
      error: null,
    };
  }

  function step(receipt, component, operation, success, details = {}) {
    receipt.steps.push({
      timestamp: new Date().toISOString(),
      component,
      operation,
      success,
      details,
    });
  }

  function ensureSelected(task) {
    if (!task?.id || !task?.calendarId) {
      throw new Error("No task is selected.");
    }
  }

  function ensureMutableTask(task) {
    ensureSelected(task);
    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      throw new Error("The selected task is already finished.");
    }
  }

  function sameTask(runtime, task) {
    return Boolean(
      runtime?.currentTask &&
      runtime.currentTask.id === task.id &&
      runtime.currentTask.calendarId === task.calendarId
    );
  }

  async function readBackTask(task, receipt, expected = {}) {
    const stored = await browser.ThunderbirdCalDAV.getTask(task.calendarId, task.id);
    for (const [key, value] of Object.entries(expected)) {
      if (stored[key] !== value) {
        throw new Error(
          `Task read-back mismatch for ${key}: expected ${String(value)}, got ${String(stored[key])}`
        );
      }
    }
    step(receipt, "CalDAV", "read-back task", true, {
      uid: stored.id,
      calendar: stored.calendarName,
      status: stored.status,
      paused: Boolean(stored.paused),
      percentComplete: stored.percentComplete,
    });
    return stored;
  }

  async function updateAndVerifyTask(task, changes, expected, receipt) {
    await browser.ThunderbirdCalDAV.updateTask(task.calendarId, task.id, changes);
    step(receipt, "CalDAV", "write task", true, {
      uid: task.id,
      calendar: task.calendarName,
      changes,
    });
    return readBackTask(task, receipt, expected);
  }

  async function createWorkEvent(task, workCalendarId, startedAt, receipt) {
    if (!workCalendarId) {
      throw new Error("No writable Work calendar is configured.");
    }
    const created = await browser.ThunderbirdCalDAV.createEvent(workCalendarId, {
      title: `Work · ${task.title || "(untitled task)"}`,
      start: startedAt,
      end: null,
      status: "CONFIRMED",
      categories: ["CalDAV Assistant", "Work"],
      description:
        `CalDAV Assistant work session\nTask UID: ${task.id}\nTask Calendar: ${task.calendarName || task.calendarId}`,
      taskUid: task.id,
      workSession: true,
    });
    step(receipt, "Work Session", "create VEVENT", true, {
      uid: created.id,
      calendarId: created.calendarId,
      calendar: created.calendarName,
      start: created.start?.icalString || null,
      taskUid: created.taskUid,
    });

    const stored = await browser.ThunderbirdCalDAV.getEvent(
      created.calendarId,
      created.id
    );
    if (stored.taskUid !== task.id || !stored.workSession) {
      throw new Error("Work VEVENT read-back did not preserve the task relation.");
    }
    if (stored.end) {
      throw new Error("A new Work VEVENT must remain open until Pause/Complete/Cancel.");
    }
    step(receipt, "Work Session", "read-back VEVENT", true, {
      uid: stored.id,
      open: !stored.end,
      taskUid: stored.taskUid,
    });
    return stored;
  }

  async function closeWorkEvent(workEvent, endedAt, receipt) {
    if (!workEvent?.id || !workEvent?.calendarId) return null;
    await browser.ThunderbirdCalDAV.updateEvent(workEvent.calendarId, workEvent.id, {
      end: endedAt,
    });
    step(receipt, "Work Session", "close VEVENT", true, {
      uid: workEvent.id,
      end: endedAt,
    });
    const stored = await browser.ThunderbirdCalDAV.getEvent(
      workEvent.calendarId,
      workEvent.id
    );
    if (!stored.end) {
      throw new Error("Work VEVENT read-back is still open after close.");
    }
    step(receipt, "Work Session", "read-back closed VEVENT", true, {
      uid: stored.id,
      end: stored.end?.icalString || null,
    });
    return stored;
  }

  async function reopenWorkEvent(workEvent, receipt) {
    if (!workEvent?.id || !workEvent?.calendarId) return;
    await browser.ThunderbirdCalDAV.updateEvent(workEvent.calendarId, workEvent.id, {
      end: null,
    });
    const stored = await browser.ThunderbirdCalDAV.getEvent(
      workEvent.calendarId,
      workEvent.id
    );
    if (stored.end) throw new Error("Rollback failed to reopen Work VEVENT.");
    step(receipt, "Rollback", "reopen VEVENT", true, {uid: stored.id});
  }

  async function finalizeReceipt(receipt) {
    receipt.completedAt = new Date().toISOString();
    if (!receipt.summary) {
      receipt.summary = receipt.success
        ? `${receipt.action} completed and verified.`
        : `${receipt.action} did not complete: ${receipt.error || "see steps"}`;
    }
    await AssistantStorage.saveLastReceipt(receipt);
    await AssistantStorage.appendAudit({
      scope: "workflow",
      action: receipt.action,
      success: receipt.success,
      summary: receipt.success
        ? `${receipt.action} completed for ${receipt.task?.title || "task"}`
        : `${receipt.action} failed for ${receipt.task?.title || "task"}`,
      details: receipt,
    });
    return receipt;
  }

  async function runAction(action, task, runner) {
    const receipt = newReceipt(action, task);
    try {
      await runner(receipt);
      receipt.success = true;
    } catch (error) {
      receipt.success = false;
      receipt.error = errorText(error);
      step(receipt, "Workflow", "error", false, {message: receipt.error});
    }
    return finalizeReceipt(receipt);
  }

  async function start(task, workCalendarId) {
    return runAction("start", task, async receipt => {
      ensureMutableTask(task);
      const runtime = await AssistantStorage.getRuntime();
      if (runtime.state !== "idle" && runtime.currentTask) {
        throw new Error("Another task is already active.");
      }
      const before = {status: task.status || "", paused: Boolean(task.paused)};
      let taskWritten = false;
      try {
        await updateAndVerifyTask(
          task,
          {status: "IN-PROCESS", paused: false},
          {status: "IN-PROCESS", paused: false},
          receipt
        );
        taskWritten = true;

        const startedAt = toLocalInput();
        const workEvent = await createWorkEvent(
          task,
          workCalendarId,
          startedAt,
          receipt
        );

        await AssistantStorage.setRuntime({
          state: "working",
          currentTask: {
            id: task.id,
            calendarId: task.calendarId,
            title: task.title,
          },
          currentWorkEvent: {
            id: workEvent.id,
            calendarId: workEvent.calendarId,
          },
          segmentStartedAtMs: Date.now(),
          accumulatedMs: 0,
        });
        step(receipt, "Runtime", "set current task", true, {
          state: "working",
          taskUid: task.id,
          workEventUid: workEvent.id,
        });
      } catch (error) {
        if (taskWritten) {
          try {
            await browser.ThunderbirdCalDAV.updateTask(task.calendarId, task.id, {
              status: before.status || null,
              paused: before.paused,
            });
            step(receipt, "Rollback", "restore task state", true, before);
          } catch (rollbackError) {
            step(receipt, "Rollback", "restore task state", false, {
              message: errorText(rollbackError),
            });
          }
        }
        throw error;
      }
    });
  }

  async function pause(task) {
    return runAction("pause", task, async receipt => {
      ensureMutableTask(task);
      const runtime = await AssistantStorage.getRuntime();
      if (runtime.state !== "working" || !sameTask(runtime, task)) {
        throw new Error("The selected task is not the currently working task.");
      }
      const endedAt = toLocalInput();
      let closed = false;
      try {
        await closeWorkEvent(runtime.currentWorkEvent, endedAt, receipt);
        closed = true;
        await updateAndVerifyTask(
          task,
          {status: "IN-PROCESS", paused: true},
          {status: "IN-PROCESS", paused: true},
          receipt
        );

        const elapsed = runtime.segmentStartedAtMs
          ? Math.max(0, Date.now() - runtime.segmentStartedAtMs)
          : 0;
        await AssistantStorage.setRuntime({
          ...runtime,
          state: "paused",
          currentWorkEvent: null,
          segmentStartedAtMs: null,
          accumulatedMs: Number(runtime.accumulatedMs || 0) + elapsed,
        });
        step(receipt, "Runtime", "set paused state", true, {
          accumulatedMs: Number(runtime.accumulatedMs || 0) + elapsed,
        });
      } catch (error) {
        if (closed) {
          try {
            await reopenWorkEvent(runtime.currentWorkEvent, receipt);
          } catch (rollbackError) {
            step(receipt, "Rollback", "reopen VEVENT", false, {
              message: errorText(rollbackError),
            });
          }
        }
        throw error;
      }
    });
  }

  async function resume(task, workCalendarId) {
    return runAction("resume", task, async receipt => {
      ensureMutableTask(task);
      const runtime = await AssistantStorage.getRuntime();
      if (runtime.state !== "paused" || !sameTask(runtime, task)) {
        throw new Error("The selected task is not paused.");
      }
      let taskWritten = false;
      try {
        await updateAndVerifyTask(
          task,
          {status: "IN-PROCESS", paused: false},
          {status: "IN-PROCESS", paused: false},
          receipt
        );
        taskWritten = true;

        const workEvent = await createWorkEvent(
          task,
          workCalendarId,
          toLocalInput(),
          receipt
        );
        await AssistantStorage.setRuntime({
          ...runtime,
          state: "working",
          currentWorkEvent: {
            id: workEvent.id,
            calendarId: workEvent.calendarId,
          },
          segmentStartedAtMs: Date.now(),
        });
        step(receipt, "Runtime", "set working state", true, {
          workEventUid: workEvent.id,
        });
      } catch (error) {
        if (taskWritten) {
          try {
            await browser.ThunderbirdCalDAV.updateTask(task.calendarId, task.id, {
              status: "IN-PROCESS",
              paused: true,
            });
            step(receipt, "Rollback", "restore paused task state", true, {});
          } catch (rollbackError) {
            step(receipt, "Rollback", "restore paused task state", false, {
              message: errorText(rollbackError),
            });
          }
        }
        throw error;
      }
    });
  }

  async function finish(task, status) {
    const action = status === "COMPLETED" ? "complete" : "cancel";

    return runAction(action, task, async receipt => {
      ensureMutableTask(task);
      const runtime = await AssistantStorage.getRuntime();
      if (!sameTask(runtime, task) || !["working", "paused"].includes(runtime.state)) {
        throw new Error("The selected task is not the current task.");
      }
      if (runtime.state === "working" && runtime.currentWorkEvent) {
        await closeWorkEvent(runtime.currentWorkEvent, toLocalInput(), receipt);
      }

      const changes =
        status === "COMPLETED"
          ? {status: "COMPLETED", paused: false, percentComplete: 100}
          : {status: "CANCELLED", paused: false};

      await updateAndVerifyTask(
        task,
        changes,
        {status, paused: false},
        receipt
      );

      await AssistantStorage.clearRuntime();
      step(receipt, "Runtime", "clear current task", true, {state: "idle"});
      step(receipt, "WordPress", "not invoked", true, {
        note: "Workflow completion does not automatically create a WordPress post.",
      });
    });
  }

  globalThis.AssistantExecutor = Object.freeze({
    start,
    pause,
    resume,
    complete: task => finish(task, "COMPLETED"),
    cancel: task => finish(task, "CANCELLED"),
    toLocalInput,
  });
})();
