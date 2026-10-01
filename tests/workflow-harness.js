"use strict";

const fs = require("fs");
const vm = require("vm");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const storage = {};
const storageWrites = [];
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
        storageWrites.push(...Object.keys(values));
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
const faults = {
  corruptNextWorkReadback: false,
  failNextPausedWrite: false,
  failNextCompleteWrite: false,
  throwAfterNextEventCreate: false,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resetTask() {
  task.status = "NEEDS-ACTION";
  task.paused = false;
  task.percentComplete = 0;
}

function resetAll() {
  resetTask();
  events.clear();
  eventCounter = 0;
  for (const key of Object.keys(storage)) delete storage[key];
  storageWrites.length = 0;
  for (const key of Object.keys(faults)) faults[key] = false;
}

browser.ThunderbirdCalDAV = {
  async updateTask(calendarId, itemId, changes) {
    assert(calendarId === task.calendarId && itemId === task.id, "wrong task target");
    if (faults.failNextPausedWrite && changes.paused === true) {
      faults.failNextPausedWrite = false;
      throw new Error("simulated paused write failure");
    }
    if (faults.failNextCompleteWrite && changes.status === "COMPLETED") {
      faults.failNextCompleteWrite = false;
      throw new Error("simulated complete write failure");
    }
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
    const id = values.id || "work-" + (++eventCounter);
    const event = {
      id,
      calendarId,
      calendarName: "Work",
      title: values.title,
      start: {icalString: values.start.replace(/[-:]/g, "")},
      end: values.end ? {icalString: values.end.replace(/[-:]/g, "")} : null,
      taskUid: values.taskUid || "",
      workSession: Boolean(values.workSession),
      workOpen: Boolean(values.workOpen),
      status: values.status || "",
    };
    events.set(id, event);
    if (faults.throwAfterNextEventCreate) {
      faults.throwAfterNextEventCreate = false;
      throw new Error("simulated uncertain create response");
    }
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
    if ("workOpen" in changes) event.workOpen = Boolean(changes.workOpen);
    return clone(event);
  },
  async getEvent(calendarId, itemId) {
    const event = events.get(itemId);
    if (!event || event.calendarId !== calendarId) throw new Error("Calendar item not found");
    const result = clone(event);
    if (faults.corruptNextWorkReadback && result.workSession) {
      faults.corruptNextWorkReadback = false;
      result.taskUid = "";
    }
    return result;
  },
  async deleteEvent(calendarId, itemId) {
    const event = events.get(itemId);
    if (!event || event.calendarId !== calendarId) {
      throw new Error("Calendar item not found");
    }
    events.delete(itemId);
    return {ok: true, id: itemId};
  },
};

global.window = global;

for (const script of ["addon/core/storage.js", "addon/core/executor.js"]) {
  vm.runInThisContext(fs.readFileSync(script, "utf8"), {filename: script});
}

async function normalLifecycle() {
  let receipt = await AssistantExecutor.start(clone(task), "work");
  assert(receipt.success, "start failed");
  assert(receipt.logSaved === true, "start result was returned before persistent log success");
  const firstAuditWrite = storageWrites.indexOf("caldavAssistant.audit");
  const firstReceiptWrite = storageWrites.indexOf("caldavAssistant.lastReceipt");
  assert(
    firstAuditWrite >= 0 && firstReceiptWrite >= 0 && firstAuditWrite < firstReceiptWrite,
    "result cache was written before the persistent audit log"
  );
  assert(task.status === "IN-PROCESS", "start did not set task IN-PROCESS");
  assert(task.paused === false, "start incorrectly paused task");

  let runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "working", "runtime is not working after start");
  const firstWorkId = runtime.currentWorkEvent?.id;
  assert(firstWorkId && events.has(firstWorkId), "start did not persist Work VEVENT");
  assert(events.get(firstWorkId).workOpen === true, "start Work VEVENT is not marked open");

  receipt = await AssistantExecutor.pause(clone(task));
  assert(receipt.success, "pause failed");
  assert(task.status === "IN-PROCESS" && task.paused, "pause task state wrong");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "paused", "runtime is not paused");
  assert(events.get(firstWorkId).end && !events.get(firstWorkId).workOpen, "pause did not close first Work VEVENT");

  receipt = await AssistantExecutor.resume(clone(task), "work");
  assert(receipt.success, "resume failed");
  assert(task.paused === false, "resume did not clear paused state");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "working", "runtime is not working after resume");
  const secondWorkId = runtime.currentWorkEvent?.id;
  assert(secondWorkId && events.has(secondWorkId), "resume did not persist a Work VEVENT");
  assert(secondWorkId !== firstWorkId, "resume reused the first Work VEVENT");
  assert(events.get(secondWorkId).workOpen === true, "resumed Work VEVENT is not marked open");

  receipt = await AssistantExecutor.complete(clone(task));
  assert(receipt.success, "complete failed");
  assert(task.status === "COMPLETED", "complete did not set COMPLETED");
  assert(task.percentComplete === 100, "complete did not set 100 percent");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "idle" && !runtime.currentTask, "runtime was not cleared");
  assert(events.get(secondWorkId).end && !events.get(secondWorkId).workOpen, "complete did not close second Work VEVENT");
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
}

async function startReadbackRollback() {
  resetAll();
  faults.corruptNextWorkReadback = true;
  const receipt = await AssistantExecutor.start(clone(task), "work");
  assert(!receipt.success, "corrupt Work VEVENT read-back should fail Start");
  assert(task.status === "NEEDS-ACTION", "failed Start did not restore original Task status");
  assert(task.paused === false, "failed Start left Task paused");
  assert(events.size === 0, "failed Start left an orphan Work VEVENT");
  const runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "idle", "failed Start did not restore idle runtime");
  assert(
    receipt.steps.some(step => step.component === "Rollback" && step.operation === "delete created VEVENT" && step.success),
    "failed Start did not record verified VEVENT cleanup"
  );
  assert(
    receipt.steps.some(step => step.component === "Rollback" && step.operation === "restore task state" && step.success),
    "failed Start did not record verified Task rollback"
  );
}

async function uncertainCreateRollback() {
  resetAll();
  faults.throwAfterNextEventCreate = true;
  const receipt = await AssistantExecutor.start(clone(task), "work");
  assert(!receipt.success, "uncertain create response should fail Start");
  assert(events.size === 0, "uncertain event create left an orphan VEVENT");
  assert(task.status === "NEEDS-ACTION", "uncertain Start did not restore Task");
  assert(
    receipt.steps.some(step => step.operation === "delete created VEVENT" && step.success),
    "known Work UID did not allow cleanup after uncertain create"
  );
}

async function pauseWriteRollback() {
  resetAll();
  let receipt = await AssistantExecutor.start(clone(task), "work");
  assert(receipt.success, "setup Start failed");
  let runtime = await AssistantStorage.getRuntime();
  const workId = runtime.currentWorkEvent.id;

  faults.failNextPausedWrite = true;
  receipt = await AssistantExecutor.pause(clone(task));
  assert(!receipt.success, "simulated Pause write failure should fail");
  assert(task.status === "IN-PROCESS" && task.paused === false, "failed Pause changed Task state");
  assert(events.get(workId)?.workOpen === true, "failed Pause did not reopen Work VEVENT");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "working" && runtime.currentWorkEvent?.id === workId, "failed Pause changed runtime");
}

async function resumeReadbackRollback() {
  resetAll();
  let receipt = await AssistantExecutor.start(clone(task), "work");
  assert(receipt.success, "setup Start failed");
  receipt = await AssistantExecutor.pause(clone(task));
  assert(receipt.success, "setup Pause failed");
  const beforeEvents = new Set(events.keys());

  faults.corruptNextWorkReadback = true;
  receipt = await AssistantExecutor.resume(clone(task), "work");
  assert(!receipt.success, "corrupt Resume VEVENT read-back should fail");
  assert(task.status === "IN-PROCESS" && task.paused === true, "failed Resume did not restore paused Task");
  assert(events.size === beforeEvents.size, "failed Resume left an extra Work VEVENT");
  for (const id of beforeEvents) assert(events.has(id), "failed Resume removed previous Work VEVENT");
  const runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "paused" && !runtime.currentWorkEvent, "failed Resume did not restore paused runtime");
}

async function putAsideLifecycle() {
  resetAll();
  let receipt = await AssistantExecutor.start(clone(task), "work");
  assert(receipt.success, "Put-aside setup Start failed");
  let runtime = await AssistantStorage.getRuntime();
  const workId = runtime.currentWorkEvent.id;

  receipt = await AssistantExecutor.putAside(clone(task));
  assert(receipt.success, "Put-aside failed");
  assert(task.status === "IN-PROCESS" && task.paused === true, "Put-aside did not leave Task paused");
  assert(events.get(workId)?.end && !events.get(workId)?.workOpen, "Put-aside did not close Work VEVENT");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "idle" && !runtime.currentTask, "Put-aside did not release the current Task");

  receipt = await AssistantExecutor.start(clone(task), "work");
  assert(receipt.success, "Task could not be started again after put-aside");
  assert(task.status === "IN-PROCESS" && task.paused === false, "Restart after put-aside did not clear paused state");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "working" && runtime.currentTask?.id === task.id, "Restart after put-aside did not become current");

  receipt = await AssistantExecutor.cancel(clone(task));
  assert(receipt.success, "Put-aside cleanup Cancel failed");
}

async function putAsidePausedLifecycle() {
  resetAll();
  let receipt = await AssistantExecutor.start(clone(task), "work");
  assert(receipt.success, "Paused put-aside setup Start failed");
  receipt = await AssistantExecutor.pause(clone(task));
  assert(receipt.success, "Paused put-aside setup Pause failed");

  receipt = await AssistantExecutor.putAside(clone(task));
  assert(receipt.success, "Put-aside from paused state failed");
  assert(task.status === "IN-PROCESS" && task.paused === true, "Paused put-aside changed Task state");
  const runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "idle" && !runtime.currentTask, "Paused put-aside did not release current Task");
}

async function cancelLifecycle() {
  resetAll();
  let receipt = await AssistantExecutor.start(clone(task), "work");
  assert(receipt.success, "Cancel setup Start failed");
  let runtime = await AssistantStorage.getRuntime();
  const workId = runtime.currentWorkEvent.id;

  receipt = await AssistantExecutor.cancel(clone(task));
  assert(receipt.success, "Cancel failed");
  assert(task.status === "CANCELLED", "Cancel did not set CANCELLED");
  assert(task.paused === false, "Cancel left Task paused");
  assert(events.get(workId)?.end && !events.get(workId)?.workOpen, "Cancel did not close Work VEVENT");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "idle" && !runtime.currentTask, "Cancel did not clear runtime");
  assert(
    receipt.steps.some(step => step.component === "WordPress" && step.operation === "not invoked"),
    "Cancel receipt must explicitly say WordPress was not invoked"
  );
}

async function completeWriteRollback() {
  resetAll();
  let receipt = await AssistantExecutor.start(clone(task), "work");
  assert(receipt.success, "setup Start failed");
  let runtime = await AssistantStorage.getRuntime();
  const workId = runtime.currentWorkEvent.id;

  faults.failNextCompleteWrite = true;
  receipt = await AssistantExecutor.complete(clone(task));
  assert(!receipt.success, "simulated Complete write failure should fail");
  assert(task.status === "IN-PROCESS" && task.percentComplete === 0, "failed Complete changed Task");
  assert(events.get(workId)?.workOpen === true, "failed Complete did not reopen Work VEVENT");
  runtime = await AssistantStorage.getRuntime();
  assert(runtime.state === "working" && runtime.currentWorkEvent?.id === workId, "failed Complete changed runtime");
}

(async () => {
  resetAll();
  await normalLifecycle();
  await startReadbackRollback();
  await uncertainCreateRollback();
  await pauseWriteRollback();
  await resumeReadbackRollback();
  await putAsideLifecycle();
  await putAsidePausedLifecycle();
  await cancelLifecycle();
  await completeWriteRollback();
  console.log("workflow-harness: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
