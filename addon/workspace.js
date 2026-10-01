"use strict";

const $ = id => document.getElementById(id);
const state = {
  calendars: [],
  tasks: [],
  selected: null,
  runtime: null,
  settings: {},
  taskView: "incomplete",
  taskCalendarId: "",
  filtersInitialized: false,
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

function dateKey(value) {
  const text = value?.icalString || "";
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(text);
  return match ? match[1] + match[2] + match[3] : "";
}

function todayKey() {
  const now = new Date();
  const y = String(now.getFullYear()).padStart(4, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return y + m + d;
}

function taskMatchesView(task, view) {
  const status = String(task.status || "").toUpperCase();
  const completed = Boolean(task.completed) || status === "COMPLETED";
  const cancelled = status === "CANCELLED";
  const active = !completed && !cancelled;
  const due = dateKey(task.due);
  const today = todayKey();

  if (view === "all") return true;
  if (view === "completed") return completed;
  if (view === "today") return active && due === today;
  if (view === "overdue") return active && Boolean(due) && due < today;
  return active;
}

function filteredTasks() {
  const search = $("task-search").value.trim().toLocaleLowerCase();
  return state.tasks.filter(task => {
    if (state.taskCalendarId && task.calendarId !== state.taskCalendarId) return false;
    if (!taskMatchesView(task, state.taskView)) return false;
    if (!search) return true;
    return String(task.title || "").toLocaleLowerCase().includes(search);
  });
}

function enabledTaskCalendars() {
  return state.calendars.filter(calendar => calendar.supportsTasks && !calendar.disabled);
}

function renderFilters() {
  $("task-view").value = state.taskView;

  const select = $("task-calendar-filter");
  const current = state.taskCalendarId;
  select.replaceChildren();

  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部 Calendar";
  select.appendChild(all);

  for (const calendar of enabledTaskCalendars()) {
    const item = document.createElement("option");
    item.value = calendar.id;
    item.textContent = calendar.name + (calendar.readOnly ? " · 只读" : "");
    select.appendChild(item);
  }

  if ([...select.options].some(item => item.value === current)) {
    select.value = current;
  } else {
    state.taskCalendarId = "";
    select.value = "";
  }
}

function showSettingsGuidance(message) {
  const notice = $("notice");
  notice.replaceChildren();
  notice.className = "notice";
  notice.append(document.createTextNode(message + " "));
  const link = document.createElement("a");
  link.href = "tools.html#task-defaults";
  link.textContent = "打开设置";
  notice.appendChild(link);
  notice.hidden = false;
}

function renderGuidance() {
  const hasDefaultCalendar = Object.prototype.hasOwnProperty.call(
    state.settings,
    "taskCalendarId"
  );
  const configuredId = String(state.settings.taskCalendarId || "");
  const configuredAvailable =
    !configuredId || enabledTaskCalendars().some(calendar => calendar.id === configuredId);

  if (!hasDefaultCalendar && enabledTaskCalendars().length > 1) {
    showSettingsGuidance("你有多个 Task Calendar。可以选择一个默认 Calendar，以后打开时直接选中它。");
    return;
  }
  if (configuredId && !configuredAvailable) {
    showSettingsGuidance("原来的默认 Task Calendar 目前不可用。已临时显示全部 Calendar。");
    return;
  }

  $("notice").hidden = true;
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

  // A missing default is resolved for this one action only. Do not silently
  // turn an inferred choice into a persistent user preference.
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

    if (!state.filtersInitialized) {
      state.taskView = state.settings.taskView || "incomplete";
      state.taskCalendarId = String(state.settings.taskCalendarId || "");
      state.filtersInitialized = true;
    }

    renderFilters();
    renderGuidance();

    if (state.runtime.currentTask) {
      const active = taskByRef(state.runtime.currentTask);
      if (active) state.selected = active;
    } else if (state.selected) {
      state.selected = taskByRef(state.selected);
    }

    const visible = filteredTasks();
    if (state.selected && !visible.some(task => sameTaskRef(state.selected, task))) {
      state.selected = null;
    }

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
$("task-view").addEventListener("change", event => {
  state.taskView = event.target.value || "incomplete";
  if (state.selected && !filteredTasks().some(task => sameTaskRef(state.selected, task))) {
    state.selected = null;
  }
  renderTasks();
  renderFlow();
});
$("task-calendar-filter").addEventListener("change", event => {
  state.taskCalendarId = event.target.value || "";
  if (state.selected && !filteredTasks().some(task => sameTaskRef(state.selected, task))) {
    state.selected = null;
  }
  renderTasks();
  renderFlow();
});
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

if (browser.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    const changed = changes["caldavAssistant.settings"];
    if (areaName !== "local" || !changed) return;

    state.settings = changed.newValue || {};
    state.taskView = state.settings.taskView || "incomplete";
    state.taskCalendarId = String(state.settings.taskCalendarId || "");
    state.filtersInitialized = true;
    renderFilters();
    renderGuidance();

    if (state.selected && !filteredTasks().some(task => sameTaskRef(state.selected, task))) {
      state.selected = null;
    }
    renderTasks();
    renderFlow();
  });
}

setInterval(updateElapsed, 1000);
refreshAll();
