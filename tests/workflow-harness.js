"use strict";

const fs = require("fs");
const vm = require("vm");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const storage = {};
global.browser = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === "string") return {[key]: storage[key]};
        const result = {};
        for (const name of key || []) result[name] = storage[name];
        return result;
      },
      async set(values) {
        Object.assign(storage, values);
      },
    },
  },
};

const task = {
  id: "seed-task",
  calendarId: "tasks",
  calendarName: "Tasks",
  title: "Seed task",
  status: "NEEDS-ACTION",
  paused: false,
  percentComplete: 0,
  categories: ["Acceptance"],
};

let eventCounter = 0;
const events = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

browser.ThunderbirdCalDAV = {
  async updateTask(calendarId, itemId, changes) {
    assert(calendarId === task.calendarId && itemId === task.id, "wrong task target");
    if ("status" in changes) task.status = changes.status || "";
    if ("paused" in changes) task.paused = Boolean(changes.paused);
    if ("percentComplete" in changes) task.percentComplete = Number(changes.percentComplete);
    if (task.status === "COMPLETED") task.percentComplete = 100;
    return clone(task);
  },
  async getTask(calendarId, itemId) {
    assert(calendarId === task.calendarId && itemId === task.id, "wrong task readback target");
    return clone(task);
  },
  async createEvent(calendarId, values) {
    const id = "work-" + (++eventCounter);
    const event = {
      id,
      calendarId,
      calendarName: "Work",
      title: values.title,
      start: {icalString: values.start.replace(/[-:]/g, "")},
      end: values.end ? {icalString: values.end.replace(/[-:]/g, "")} : null,
      taskUid: values.taskUid || "",
      workSession: Boolean(values.workSession),
      status: values.status || "",
    };
    events.set(id, event);
    return clone(event);
  },
  async updateEvent(calendarId, itemId, changes) {
    const event = events.get(itemId);
    assert(event && event.calendarId === calendarId, "wrong event target");
    if ("end" in changes) {
      event.end = changes.end
        ? {icalString: String(changes.end).replace(/[-:]/g, "")}
        : null;
    }
    return clone(event);
  },
  async getEvent(calendarId, itemId) {
    const event = events.get(itemId);
    if (!event || event.calendarId !== calendarId) throw new Error("Calendar item not found");
    return clone(event);
  },
};

global.crypto = require("crypto").webcrypto;
global.window = global;

for (const path of ["addon/core/storage.js", "addon/core/executor.js"]) {
  vm.runInThisContext(fs.readFileSync(path, "utf8"), {filename: path});
}

(async () => {
  let receipt = await AssistantExecutor.start(clone(task), "work");
  assert(receipt.success, "start failed");
  assert(task.status === "IN-PROCESS", "start did not set task IN-PROCESS");
  assert(task.paused === false, "start incorrectly paused task");
  let runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "working", "runtime is not working after start");
  assert(runtime.currentWorkEvent?.id === "work-1", "start did not persist Work VEVENT");
  assert(events.get("work-1").end === null, "start Work VEVENT is not open");

  receipt = await AssistantExecutor.pause(clone(task));
  assert(receipt.success, "pause failed");
  assert(task.status === "IN-PROCESS" && task.paused, "pause task state wrong");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "paused", "runtime is not paused");
  assert(events.get("work-1").end, "pause did not close first Work VEVENT");

  receipt = await AssistantExecutor.resume(clone(task), "work");
  assert(receipt.success, "resume failed");
  assert(task.paused === false, "resume did not clear paused state");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "working", "runtime is not working after resume");
  assert(runtime.currentWorkEvent?.id === "work-2", "resume did not create a second Work VEVENT");
  assert(events.get("work-2").end === null, "resumed Work VEVENT is not open");

  receipt = await AssistantExecutor.complete(clone(task));
  assert(receipt.success, "complete failed");
  assert(task.status === "COMPLETED", "complete did not set COMPLETED");
  assert(task.percentComplete === 100, "complete did not set 100 percent");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "idle" && !runtime.currentTask, "runtime was not cleared");
  assert(events.get("work-2").end, "complete did not close second Work VEVENT");
  assert(
    receipt.steps.some(step => step.component === "WordPress" && step.operation === "not invoked"),
    "receipt must explicitly say WordPress was not invoked"
  );

  const audit = await AssistantStorage.listAudit();
  assert(
    audit.map(row => row.action).join(",") === "start,pause,resume,complete",
    "workflow audit sequence is incomplete"
  );
  assert(audit.every(row => row.details?.steps?.length), "audit records lost detailed receipts");

  const failure = await AssistantExecutor.pause(clone(task));
  assert(!failure.success, "invalid pause should return a persistent failed receipt");
  assert(/not the currently working task|already finished/i.test(failure.error), "wrong failure reason");
  const last = await AssistantStorage.getLastReceipt();
  assert(last?.id === failure.id, "failed receipt was not persisted");

  console.log("workflow-harness: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
