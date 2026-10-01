"use strict";

const $ = id => document.getElementById(id);
const state = {
  calendars: [],
  tasks: [],
  selected: null,
  runtime: null,
  settings: {},
};

function displayDate(value) {
  if (!value || !value.icalString) return "—";
  const text = value.icalString;
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(text);
  if (m) return m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5];
  return text;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return h + ":" + m + ":" + s;
}

function sameTaskRef(ref, task) {
  return Boolean(ref && task && ref.id === task.id && ref.calendarId === task.calendarId);
}

function taskByRef(ref) {
  return state.tasks.find(task => sameTaskRef(ref, task)) || null;
}

function currentTask(task) {
  return sameTaskRef(state.runtime && state.runtime.currentTask, task);
}

function taskState(task) {
  if (!task) return {label: "未选择", css: ""};
  if (currentTask(task) && state.runtime.state === "working") {
    return {label: "正在进行", css: "working"};
  }
  if (currentTask(task) && state.runtime.state === "paused") {
    return {label: "已暂停", css: "paused"};
  }
  if (task.status === "COMPLETED") return {label: "已完成", css: "completed"};
  if (task.status === "CANCELLED") return {label: "已取消", css: "cancelled"};
  if (task.paused) return {label: "已暂停", css: "paused"};
  if (task.status === "IN-PROCESS") return {label: "进行中", css: "working"};
  return {label: "未开始", css: ""};
}

function filteredTasks() {
  const search = $("task-search").value.trim().toLocaleLowerCase();
  const calendarId = String(state.settings.taskCalendarId || "");
  return state.tasks.filter(task => {
    if (calendarId && task.calendarId !== calendarId) return false;
    if (!search) return true;
    return String(task.title || "").toLocaleLowerCase().includes(search);
  });
}

function renderTasks() {
  $("task-list").replaceChildren();
  const tasks = filteredTasks();
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "没有匹配的 Task";
    $("task-list").appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "item" + (sameTaskRef(state.selected, task) ? " selected" : "");

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = task.title || "(无标题)";

    const meta = document.createElement("div");
    meta.className = "item-meta";
    const status = taskState(task).label;
    const due = displayDate(task.due);
    meta.textContent = due === "—" ? status : status + " · 截止 " + due;

    row.append(title, meta);
    row.addEventListener("click", () => {
      state.selected = task;
      renderTasks();
      renderFlow();
    });
    $("task-list").appendChild(row);
  }
}

function addAction(label, handler, className) {
  const button = document.createElement("button");
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", handler);
  $("actions").appendChild(button);
}

function writableEventCalendars() {
  return state.calendars.filter(calendar =>
    calendar.supportsEvents && !calendar.disabled && !calendar.readOnly
  );
}

async function resolveWorkCalendar(task) {
  const candidates = writableEventCalendars();
  const configured = candidates.find(calendar => calendar.id === state.settings.workCalendarId);
  if (configured) return configured.id;

  const sameCalendar = candidates.find(calendar => calendar.id === task.calendarId);
  const chosen = sameCalendar || candidates[0];
  if (!chosen) {
    throw new Error("没有可写的 Work Calendar。请到“工具”设置。");
  }

  state.settings.workCalendarId = chosen.id;
  await AssistantStorage.saveSettings({workCalendarId: chosen.id});
  return chosen.id;
}

function renderFlow() {
  const task = state.selected;
  $("no-selection").hidden = Boolean(task);
  $("selection").hidden = !task;
  $("actions").replaceChildren();
  $("cancel-confirm").hidden = true;

  if (!task) return;

  $("selected-title").textContent = task.title || "(无标题)";
  const stateView = taskState(task);
  $("selected-state").textContent = stateView.label;
  $("selected-state").className = "task-state " + stateView.css;

  const due = displayDate(task.due);
  $("selected-due").textContent = due === "—" ? "没有截止日期" : "截止 " + due;

  const active = currentTask(task) &&
    (state.runtime.state === "working" || state.runtime.state === "paused");
  $("elapsed-block").hidden = !active;

  const finished = task.status === "COMPLETED" || task.status === "CANCELLED";
  if (currentTask(task) && state.runtime.state === "working") {
    addAction("暂停", () => runWorkflow("pause"), "primary");
    addAction("完成", () => runWorkflow("complete"), "");
    addAction("取消", () => {$("cancel-confirm").hidden = false;}, "danger");
    $("flow-note").textContent = "";
  } else if (currentTask(task) && state.runtime.state === "paused") {
    addAction("继续", () => runWorkflow("resume"), "primary");
    addAction("完成", () => runWorkflow("complete"), "");
    addAction("取消", () => {$("cancel-confirm").hidden = false;}, "danger");
    $("flow-note").textContent = "";
  } else if (!state.runtime.currentTask && !finished) {
    addAction("开始", () => runWorkflow("start"), "primary");
    $("flow-note").textContent = "";
  } else if (finished) {
    $("flow-note").textContent = "";
  } else {
    $("flow-note").textContent = "另一个 Task 正在工作，请先处理当前 Task。";
  }

  updateElapsed();
}

function updateElapsed() {
  const task = state.selected;
  if (!task || !currentTask(task)) return;
  let ms = Number(state.runtime.accumulatedMs || 0);
  if (state.runtime.state === "working" && state.runtime.segmentStartedAtMs) {
    ms += Math.max(0, Date.now() - state.runtime.segmentStartedAtMs);
  }
  $("selected-elapsed").textContent = formatDuration(ms);
}

function actionLabel(action) {
  return {
    start: "开始",
    pause: "暂停",
    resume: "继续",
    complete: "完成",
    cancel: "取消",
  }[action] || action || "操作";
}

function shortStep(step) {
  const component = step.component || "";
  const operation = step.operation || step.name || "";
  if (component === "CalDAV" && operation === "write task") return "Task 已写入 CalDAV";
  if (component === "CalDAV" && operation === "read-back task") return "Task 已重新读取确认";
  if (component === "Work Session" && operation === "create VEVENT") return "工作记录已开始";
  if (component === "Work Session" && operation === "read-back VEVENT") return "工作记录已重新读取确认";
  if (component === "Work Session" && operation === "close VEVENT") return "工作记录已结束";
  if (component === "Work Session" && operation === "read-back closed VEVENT") return "工作记录结束已确认";
  if (component === "WordPress" && operation === "not invoked") return "WordPress：本操作没有写入";
  if (component === "Rollback") return "已执行恢复：" + operation;
  if (component === "Workflow" && operation === "error") return "错误：" + (step.details && step.details.message || "操作失败");
  return "";
}

function renderReceipt(receipt) {
  const root = $("receipt");
  root.replaceChildren();
  if (!receipt) {
    root.textContent = "尚无工作结果。";
    return;
  }

  const summary = document.createElement("div");
  summary.className = "result-summary " + (receipt.success ? "ok" : "fail");
  const title = receipt.task && receipt.task.title ? "“" + receipt.task.title + "”" : "Task";
  summary.textContent = receipt.success
    ? "✓ 已" + actionLabel(receipt.action) + title
    : "✗ " + actionLabel(receipt.action) + "失败：" + (receipt.error || receipt.summary || "未知错误");
  root.appendChild(summary);

  const messages = [];
  for (const step of receipt.steps || []) {
    const text = shortStep(step);
    if (text && !messages.includes(text)) messages.push(text);
  }
  if (receipt.logSaved === false) {
    messages.unshift("⚠ 操作结果已显示，但持久日志保存失败：" + (receipt.logError || "未知错误"));
  } else if (receipt.logSaved === true) {
    messages.push("结果已写入日志");
  }

  if (messages.length) {
    const list = document.createElement("ul");
    list.className = "result-list";
    for (const message of messages) {
      const item = document.createElement("li");
      item.textContent = message;
      list.appendChild(item);
    }
    root.appendChild(list);
  }
}

async function persistUiFailure(action, task, error) {
  const receipt = {
    action,
    success: false,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    task: task ? {
      id: task.id,
      calendarId: task.calendarId,
      title: task.title,
    } : null,
    steps: [],
    error: String(error && error.message || error || "Unknown error"),
  };
  return AssistantStorage.persistResult(receipt, "workflow");
}

async function runWorkflow(action) {
  if (!state.selected) return;
  const task = state.selected;
  $("actions").querySelectorAll("button").forEach(button => { button.disabled = true; });

  let receipt;
  try {
    if (action === "start") {
      receipt = await AssistantExecutor.start(task, await resolveWorkCalendar(task));
    } else if (action === "pause") {
      receipt = await AssistantExecutor.pause(task);
    } else if (action === "resume") {
      receipt = await AssistantExecutor.resume(task, await resolveWorkCalendar(task));
    } else if (action === "complete") {
      receipt = await AssistantExecutor.complete(task);
    } else if (action === "cancel") {
      receipt = await AssistantExecutor.cancel(task);
    } else {
      throw new Error("Unknown workflow action: " + action);
    }
  } catch (error) {
    receipt = await persistUiFailure(action, task, error);
  }

  renderReceipt(receipt);
  await refreshAll();
}

async function lastWorkflowReceipt() {
  const records = await AssistantStorage.listAudit();
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].scope === "workflow" && records[i].details) {
      return records[i].details;
    }
  }
  return null;
}

async function refreshAll() {
  try {
    state.calendars = await browser.ThunderbirdCalDAV.listCalendars();
    state.tasks = await browser.ThunderbirdCalDAV.listTasks();
    state.runtime = await AssistantStorage.getRuntime();
    state.settings = await AssistantStorage.getSettings();

    if (state.runtime.currentTask) {
      const active = taskByRef(state.runtime.currentTask);
      if (active) state.selected = active;
    } else if (state.selected) {
      state.selected = taskByRef(state.selected);
    }

    $("notice").hidden = true;
    renderTasks();
    renderFlow();
    renderReceipt(await lastWorkflowReceipt());
  } catch (error) {
    const receipt = await persistUiFailure("refresh", state.selected, error);
    renderReceipt(receipt);
    $("notice").textContent = "读取 Task 失败。详细原因已经写入日志。";
    $("notice").className = "notice error";
    $("notice").hidden = false;
  }
}

$("task-search").addEventListener("input", renderTasks);
$("cancel-confirm-no").addEventListener("click", () => {
  $("cancel-confirm").hidden = true;
});
$("cancel-confirm-yes").addEventListener("click", async () => {
  $("cancel-confirm").hidden = true;
  await runWorkflow("cancel");
});

browser.ThunderbirdCalDAV.onItemsChanged.addListener(() => {
  clearTimeout(window.__caldavAssistantRefresh);
  window.__caldavAssistantRefresh = setTimeout(refreshAll, 250);
});

setInterval(updateElapsed, 1000);
refreshAll();
