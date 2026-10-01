"use strict";

const $ = id => document.getElementById(id);
const state = {
  calendars: [],
  tasks: [],
  selected: null,
  runtime: null,
  workCalendarId: "",
};

function setStatus(message, kind = "") {
  $("status").textContent = message;
  $("status").className = "status" + (kind ? " " + kind : "");
}

function displayDate(value) {
  if (!value?.icalString) return "—";
  const text = value.icalString;
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (date) return `${date[1]}-${date[2]}-${date[3]}`;
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(text);
  if (dt) return `${dt[1]}-${dt[2]}-${dt[3]} ${dt[4]}:${dt[5]}:${dt[6]}`;
  return text;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function filteredTasks() {
  const calendarId = $("calendar-filter").value;
  const search = $("task-search").value.trim().toLocaleLowerCase();
  return state.tasks.filter(task =>
    (!calendarId || task.calendarId === calendarId) &&
    (!search ||
      task.title.toLocaleLowerCase().includes(search) ||
      task.id.toLocaleLowerCase().includes(search))
  );
}

function sameTaskRef(ref, task) {
  return Boolean(
    ref && task && ref.id === task.id && ref.calendarId === task.calendarId
  );
}

function taskByRef(ref) {
  return state.tasks.find(task => sameTaskRef(ref, task)) || null;
}

function populateCalendars() {
  const current = $("calendar-filter").value;
  $("calendar-filter").replaceChildren();

  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部 Task Calendar";
  $("calendar-filter").appendChild(all);

  for (const calendar of state.calendars.filter(x => x.supportsTasks && !x.disabled)) {
    const option = document.createElement("option");
    option.value = calendar.id;
    option.textContent = calendar.name + (calendar.readOnly ? " · 只读" : "");
    $("calendar-filter").appendChild(option);
  }
  if ([...$("calendar-filter").options].some(x => x.value === current)) {
    $("calendar-filter").value = current;
  }

  const previous = state.workCalendarId;
  $("work-calendar").replaceChildren();
  for (const calendar of state.calendars.filter(
    x => x.supportsEvents && !x.disabled && !x.readOnly
  )) {
    const option = document.createElement("option");
    option.value = calendar.id;
    option.textContent = calendar.name;
    $("work-calendar").appendChild(option);
  }

  const wanted =
    previous ||
    state.selected?.calendarId ||
    [...$("work-calendar").options][0]?.value ||
    "";
  if ([...$("work-calendar").options].some(x => x.value === wanted)) {
    $("work-calendar").value = wanted;
  }
  state.workCalendarId = $("work-calendar").value;
}

function renderTasks() {
  const tasks = filteredTasks();
  $("task-count").textContent = String(tasks.length);
  $("task-list").replaceChildren();

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
    const paused = task.paused ? " · PAUSED" : "";
    meta.textContent =
      `${task.calendarName} · ${task.status || "NO STATUS"}${paused} · due ${displayDate(task.due)}`;
    row.append(title, meta);
    row.addEventListener("click", () => {
      state.selected = task;
      renderTasks();
      renderFlow();
    });
    $("task-list").appendChild(row);
  }
}

function assistantState(task) {
  if (!task) return "未选择";
  if (sameTaskRef(state.runtime?.currentTask, task)) {
    if (state.runtime.state === "working") return "正在进行";
    if (state.runtime.state === "paused") return "已暂停";
  }
  if (task.status === "COMPLETED") return "已完成";
  if (task.status === "CANCELLED") return "已取消";
  if (state.runtime?.currentTask) return "未激活（另一个 Task 正在工作）";
  return "未开始";
}

function addAction(label, handler, className = "") {
  const button = document.createElement("button");
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", handler);
  $("actions").appendChild(button);
}

function renderFlow() {
  const task = state.selected;
  $("no-selection").hidden = Boolean(task);
  $("selection").hidden = !task;
  $("actions").replaceChildren();
  $("cancel-confirm").hidden = true;

  if (!task) return;

  $("selected-title").textContent = task.title || "(无标题)";
  $("selected-calendar").textContent = task.calendarName || task.calendarId;
  $("selected-uid").textContent = task.id;
  $("selected-vtodo-state").textContent =
    (task.status || "NO STATUS") + (task.paused ? " · PAUSED" : "");
  $("selected-flow-state").textContent = assistantState(task);
  $("selected-due").textContent = displayDate(task.due);
  $("selected-category").textContent = task.categories?.join(", ") || "—";

  const current = sameTaskRef(state.runtime?.currentTask, task);
  const finished = task.status === "COMPLETED" || task.status === "CANCELLED";

  if (current && state.runtime.state === "working") {
    addAction("暂停", () => runWorkflow("pause"), "primary");
    addAction("完成", () => runWorkflow("complete"));
    addAction("取消", () => {$("cancel-confirm").hidden = false;}, "danger");
    $("flow-note").textContent = "当前 Task 正在工作。";
  } else if (current && state.runtime.state === "paused") {
    addAction("继续", () => runWorkflow("resume"), "primary");
    addAction("完成", () => runWorkflow("complete"));
    addAction("取消", () => {$("cancel-confirm").hidden = false;}, "danger");
    $("flow-note").textContent = "当前 Task 已暂停。";
  } else if (!state.runtime?.currentTask && !finished) {
    addAction("开始", () => runWorkflow("start"), "primary");
    $("flow-note").textContent = "开始后会修改已有 VTODO，并创建一个新的 Work VEVENT。";
  } else if (finished) {
    $("flow-note").textContent = "这个 Task 已经结束，没有进一步的工作动作。";
  } else {
    $("flow-note").textContent =
      `另一个 Task 正在${state.runtime.state === "paused" ? "暂停" : "进行"}；请先处理当前 Task。`;
  }

  updateElapsed();
}

function updateElapsed() {
  const task = state.selected;
  if (!task || !sameTaskRef(state.runtime?.currentTask, task)) {
    if (task) $("selected-elapsed").textContent = "00:00:00";
    return;
  }
  let ms = Number(state.runtime.accumulatedMs || 0);
  if (state.runtime.state === "working" && state.runtime.segmentStartedAtMs) {
    ms += Math.max(0, Date.now() - state.runtime.segmentStartedAtMs);
  }
  $("selected-elapsed").textContent = formatDuration(ms);
}

function renderReceipt(receipt) {
  const root = $("receipt");
  root.replaceChildren();
  if (!receipt) {
    root.textContent = "尚无操作回执。";
    return;
  }

  const summary = document.createElement("div");
  summary.className = "receipt-summary " + (receipt.success ? "ok" : "fail");
  summary.textContent =
    `${receipt.success ? "✓" : "✗"} ${receipt.action || "operation"} · ${receipt.summary || receipt.error || ""}`;
  root.appendChild(summary);

  const meta = document.createElement("div");
  meta.className = "receipt-meta";
  const task = receipt.task
    ? `Task: ${receipt.task.title || ""} · UID ${receipt.task.id || ""}`
    : "Task: —";
  meta.textContent =
    `${task}\n开始: ${receipt.startedAt || "—"}\n完成: ${receipt.completedAt || "—"}`;
  meta.style.whiteSpace = "pre-line";
  root.appendChild(meta);

  for (const item of receipt.steps || []) {
    const row = document.createElement("div");
    row.className = "receipt-step";
    const head = document.createElement("strong");
    head.textContent =
      `${item.success === false ? "✗" : "✓"} ${item.component || item.name || ""} · ${item.operation || item.name || ""}`;
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(item.details ?? item, null, 2);
    row.append(head, pre);
    root.appendChild(row);
  }

  if (receipt.error) {
    const row = document.createElement("div");
    row.className = "receipt-step";
    row.textContent = "错误：" + receipt.error;
    root.appendChild(row);
  }
}

async function runWorkflow(action) {
  if (!state.selected) return;
  const task = state.selected;
  setStatus(`正在执行 ${action}…`);
  $("actions").querySelectorAll("button").forEach(button => button.disabled = true);

  let receipt;
  try {
    if (action === "start") {
      receipt = await AssistantExecutor.start(task, state.workCalendarId);
    } else if (action === "pause") {
      receipt = await AssistantExecutor.pause(task);
    } else if (action === "resume") {
      receipt = await AssistantExecutor.resume(task, state.workCalendarId);
    } else if (action === "complete") {
      receipt = await AssistantExecutor.complete(task);
    } else if (action === "cancel") {
      receipt = await AssistantExecutor.cancel(task);
    } else {
      throw new Error("Unknown workflow action: " + action);
    }
  } catch (error) {
    setStatus(String(error?.message || error), "error");
    await refreshAll(false);
    return;
  }

  renderReceipt(receipt);
  setStatus(
    receipt.success
      ? `${action} 已完成，并已执行写入后读回验证。`
      : `${action} 未完整完成：${receipt.error || "请查看回执。"}`,
    receipt.success ? "success" : "error"
  );
  await refreshAll(false);
}

async function refreshAll(showLoading = true) {
  if (showLoading) setStatus("正在读取 Thunderbird Calendar…");
  try {
    state.calendars = await browser.ThunderbirdCalDAV.listCalendars();
    state.tasks = await browser.ThunderbirdCalDAV.listTasks();
    state.runtime = await AssistantStorage.getRuntime();
    const settings = await AssistantStorage.getSettings();
    state.workCalendarId = settings.workCalendarId || state.workCalendarId;

    if (state.runtime.currentTask) {
      const current = taskByRef(state.runtime.currentTask);
      if (current) state.selected = current;
    } else if (state.selected) {
      state.selected = taskByRef(state.selected);
    }

    populateCalendars();
    renderTasks();
    renderFlow();
    renderReceipt(await AssistantStorage.getLastReceipt());
    setStatus(
      `已读取 ${state.tasks.length} 个 Task；当前 Assistant 状态：${state.runtime.state}。`,
      "success"
    );
  } catch (error) {
    setStatus("读取失败：" + String(error?.message || error), "error");
  }
}

$("task-search").addEventListener("input", renderTasks);
$("calendar-filter").addEventListener("change", renderTasks);
$("work-calendar").addEventListener("change", async event => {
  state.workCalendarId = event.target.value;
  await AssistantStorage.saveSettings({workCalendarId: state.workCalendarId});
});
$("refresh").addEventListener("click", () => refreshAll());
$("cancel-confirm-no").addEventListener("click", () => {
  $("cancel-confirm").hidden = true;
});
$("cancel-confirm-yes").addEventListener("click", async () => {
  $("cancel-confirm").hidden = true;
  await runWorkflow("cancel");
});

browser.ThunderbirdCalDAV.onItemsChanged.addListener(() => {
  clearTimeout(window.__caldavAssistantRefresh);
  window.__caldavAssistantRefresh = setTimeout(() => refreshAll(false), 250);
});

setInterval(updateElapsed, 1000);
refreshAll();
