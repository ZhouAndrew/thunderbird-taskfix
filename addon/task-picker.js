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

function sameTaskRef(ref, task) {
  return Boolean(ref && task && ref.id === task.id && ref.calendarId === task.calendarId);
}

function taskByRef(ref) {
  return state.tasks.find(task => sameTaskRef(ref, task)) || null;
}

function dateKey(value) {
  const text = value?.icalString || "";
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(text);
  return match ? match[1] + match[2] + match[3] : "";
}

function todayKey() {
  const now = new Date();
  return String(now.getFullYear()).padStart(4, "0") +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
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

function taskState(task) {
  if (!task) return {label: "未选择", css: ""};
  if (sameTaskRef(state.runtime?.currentTask, task) && state.runtime.state === "working") {
    return {label: "正在进行", css: "working"};
  }
  if (sameTaskRef(state.runtime?.currentTask, task) && state.runtime.state === "paused") {
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
  if (!chosen) throw new Error("没有可写的 Work Calendar。请到“工具”设置。");
  return chosen.id;
}

function showNotice(message, error = false) {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = error ? "notice error" : "notice";
  notice.hidden = false;
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

function renderCurrentStrip() {
  const task = taskByRef(state.runtime?.currentTask);
  const strip = $("current-strip");
  if (!task) {
    strip.hidden = true;
    return;
  }
  const stateText = state.runtime.state === "paused" ? "已暂停" : "正在进行";
  $("current-strip-text").textContent =
    "当前：" + (task.title || "(无标题)") + " · " + stateText;
  strip.hidden = false;
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
      renderSelection();
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

function renderSelection() {
  const task = state.selected;
  $("no-selection").hidden = Boolean(task);
  $("selection").hidden = !task;
  $("actions").replaceChildren();
  $("flow-note").textContent = "";
  if (!task) return;

  $("selected-title").textContent = task.title || "(无标题)";
  const view = taskState(task);
  $("selected-state").textContent = view.label;
  $("selected-state").className = "task-state " + view.css;
  const due = displayDate(task.due);
  $("selected-due").textContent = due === "—" ? "没有截止日期" : "截止 " + due;

  const finished = task.status === "COMPLETED" || task.status === "CANCELLED";
  const current = taskByRef(state.runtime?.currentTask);

  if (finished) {
    $("flow-note").textContent = "这个 Task 已结束。";
    return;
  }

  if (sameTaskRef(state.runtime?.currentTask, task)) {
    $("flow-note").textContent = "这个 Task 就是当前工作。";
    return;
  }

  if (current) {
    addAction("换下当前 Task", runPutAside, "primary");
    $("flow-note").textContent =
      "先把“" + (current.title || "(无标题)") + "”换下来；完成后再开始这个 Task。";
    return;
  }

  addAction("开始这个 Task", runStart, "primary");
}

async function persistUiFailure(action, task, error) {
  return AssistantStorage.persistResult({
    action,
    success: false,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    task: task ? {id: task.id, calendarId: task.calendarId, title: task.title} : null,
    steps: [],
    error: String(error?.message || error || "Unknown error"),
  }, "workflow");
}

async function runPutAside() {
  const target = state.selected;
  const current = taskByRef(state.runtime?.currentTask);
  if (!target || !current) return;

  $("actions").querySelectorAll("button").forEach(button => { button.disabled = true; });
  let receipt;
  try {
    receipt = await AssistantExecutor.putAside(current);
  } catch (error) {
    receipt = await persistUiFailure("put-aside", current, error);
  }

  if (receipt.success) {
    showNotice("已换下当前 Task。现在可以开始“" + (target.title || "(无标题)") + "”。");
  } else {
    showNotice(receipt.error || receipt.summary || "换下当前 Task 失败。", true);
  }
  await refreshAll(true);
}

async function runStart() {
  const task = state.selected;
  if (!task) return;

  $("actions").querySelectorAll("button").forEach(button => { button.disabled = true; });
  let receipt;
  try {
    receipt = await AssistantExecutor.start(task, await resolveWorkCalendar(task));
  } catch (error) {
    receipt = await persistUiFailure("start", task, error);
  }

  if (receipt.success) {
    window.location.href = "workspace.html";
    return;
  }
  showNotice(receipt.error || receipt.summary || "开始 Task 失败。", true);
  await refreshAll(true);
}

async function refreshAll(preserveSelection = true) {
  try {
    const selectedRef = preserveSelection && state.selected
      ? {id: state.selected.id, calendarId: state.selected.calendarId}
      : null;

    state.calendars = await browser.ThunderbirdCalDAV.listCalendars();
    state.tasks = await browser.ThunderbirdCalDAV.listTasks();
    state.runtime = await AssistantStorage.getRuntime();
    state.settings = await AssistantStorage.getSettings();

    if (!state.filtersInitialized) {
      state.taskView = state.settings.taskView || "incomplete";
      state.taskCalendarId = String(state.settings.taskCalendarId || "");
      state.filtersInitialized = true;
    }

    if (selectedRef) state.selected = taskByRef(selectedRef);

    renderFilters();
    renderCurrentStrip();

    const visible = filteredTasks();
    if (state.selected && !visible.some(task => sameTaskRef(state.selected, task))) {
      state.selected = null;
    }

    renderTasks();
    renderSelection();
  } catch (error) {
    await persistUiFailure("refresh", state.selected, error);
    showNotice("读取 Task 失败。详细原因已经写入日志。", true);
  }
}

$("task-search").addEventListener("input", renderTasks);
$("task-view").addEventListener("change", event => {
  state.taskView = event.target.value || "incomplete";
  if (state.selected && !filteredTasks().some(task => sameTaskRef(state.selected, task))) {
    state.selected = null;
  }
  renderTasks();
  renderSelection();
});
$("task-calendar-filter").addEventListener("change", event => {
  state.taskCalendarId = event.target.value || "";
  if (state.selected && !filteredTasks().some(task => sameTaskRef(state.selected, task))) {
    state.selected = null;
  }
  renderTasks();
  renderSelection();
});

browser.ThunderbirdCalDAV.onItemsChanged.addListener(() => {
  clearTimeout(window.__caldavAssistantRefresh);
  window.__caldavAssistantRefresh = setTimeout(() => refreshAll(true), 250);
});

if (browser.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes["caldavAssistant.settings"]) return;
    state.settings = changes["caldavAssistant.settings"].newValue || {};
    state.taskView = state.settings.taskView || "incomplete";
    state.taskCalendarId = String(state.settings.taskCalendarId || "");
    state.filtersInitialized = true;
    renderFilters();
    renderTasks();
    renderSelection();
  });
}

refreshAll(false);
