"use strict";

const $ = id => document.getElementById(id);
const state = {calendars: [], tasks: [], events: []};

function setStatus(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

function splitCategories(value) {
  return String(value || "").split(",").map(x => x.trim()).filter(Boolean);
}

function icalToInput(value, withTime = false) {
  const text = value?.icalString || "";
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(text);
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    return withTime ? `${date}T${m[4]}:${m[5]}` : date;
  }
  return "";
}

function displayDate(value) {
  const input = icalToInput(value, true);
  return input ? input.replace("T", " ") : "—";
}

function populateCalendars() {
  const writable = state.calendars.filter(calendar => !calendar.disabled && !calendar.readOnly);
  const currentFilter = $("calendar-filter").value;

  $("calendar-filter").replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部 Calendar";
  $("calendar-filter").appendChild(all);
  for (const calendar of state.calendars) {
    const option = document.createElement("option");
    option.value = calendar.id;
    option.textContent = `${calendar.name}${calendar.readOnly ? " · 只读" : ""}`;
    $("calendar-filter").appendChild(option);
  }
  $("calendar-filter").value = state.calendars.some(c => c.id === currentFilter) ? currentFilter : "";

  for (const id of ["task-calendar", "event-calendar"]) {
    const select = $(id);
    const selected = select.value;
    select.replaceChildren();
    for (const calendar of writable) {
      const option = document.createElement("option");
      option.value = calendar.id;
      option.textContent = calendar.name;
      select.appendChild(option);
    }
    if (writable.some(c => c.id === selected)) select.value = selected;
  }
}

function filteredTasks() {
  const calendarId = $("calendar-filter").value;
  const search = $("task-search").value.trim().toLocaleLowerCase();
  return state.tasks.filter(task =>
    (!calendarId || task.calendarId === calendarId) &&
    (!search || task.title.toLocaleLowerCase().includes(search))
  );
}

function renderTasks() {
  const tasks = filteredTasks();
  $("task-count").textContent = String(tasks.length);
  $("task-list").replaceChildren();

  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "没有匹配的任务";
    $("task-list").appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "item";
    const categories = task.categories?.length ? ` · ${task.categories.join(", ")}` : "";
    row.innerHTML = `
      <div class="item-title"></div>
      <div class="item-meta"></div>
    `;
    row.querySelector(".item-title").textContent = task.title || "(无标题)";
    row.querySelector(".item-meta").textContent =
      `${task.calendarName} · ${task.status || "NO STATUS"} · due ${displayDate(task.due)}${categories}`;
    row.addEventListener("click", () => editTask(task));
    $("task-list").appendChild(row);
  }
}

function renderEvents() {
  const calendarId = $("calendar-filter").value;
  const events = state.events.filter(event => !calendarId || event.calendarId === calendarId);
  $("event-count").textContent = String(events.length);
  $("event-list").replaceChildren();

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "这个时间范围没有事件";
    $("event-list").appendChild(empty);
    return;
  }

  for (const event of events) {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="item-title"></div>
      <div class="item-meta"></div>
    `;
    row.querySelector(".item-title").textContent = event.title || "(无标题)";
    row.querySelector(".item-meta").textContent =
      `${event.calendarName} · ${displayDate(event.start)} → ${displayDate(event.end)}`;
    row.addEventListener("click", () => editEvent(event));
    $("event-list").appendChild(row);
  }
}

function resetTaskEditor() {
  $("task-id").value = "";
  $("task-editor-title").textContent = "新建任务";
  $("task-title").value = "";
  $("task-due").value = "";
  $("task-status").value = "";
  $("task-priority").value = "0";
  $("task-categories").value = "";
  $("task-description").value = "";
  $("task-delete").hidden = true;
}

function editTask(task) {
  $("task-id").value = task.id;
  $("task-editor-title").textContent = "编辑任务";
  $("task-calendar").value = task.calendarId;
  $("task-title").value = task.title;
  $("task-due").value = icalToInput(task.due);
  $("task-status").value = task.status || "";
  $("task-priority").value = String(task.priority || 0);
  $("task-categories").value = (task.categories || []).join(", ");
  $("task-description").value = task.description || "";
  $("task-delete").hidden = false;
}

function taskValues() {
  return {
    title: $("task-title").value.trim(),
    due: $("task-due").value || null,
    status: $("task-status").value || null,
    priority: Number($("task-priority").value || 0),
    categories: splitCategories($("task-categories").value),
    description: $("task-description").value,
  };
}

async function saveTask() {
  const calendarId = $("task-calendar").value;
  if (!calendarId) throw new Error("没有可写的 Calendar");
  const id = $("task-id").value;
  if (!$("task-title").value.trim()) throw new Error("任务标题不能为空");

  setStatus("正在通过 Thunderbird 保存 VTODO…");
  if (id) {
    await browser.ThunderbirdCalDAV.updateTask(calendarId, id, taskValues());
  } else {
    await browser.ThunderbirdCalDAV.createTask(calendarId, taskValues());
  }
  resetTaskEditor();
  await refreshTasks();
  setStatus("Thunderbird 已提交任务修改；CalDAV 同步由 Thunderbird provider 负责。");
}

async function deleteTask() {
  const id = $("task-id").value;
  const calendarId = $("task-calendar").value;
  if (!id || !confirm("删除这个任务？")) return;
  setStatus("正在通过 Thunderbird 删除 VTODO…");
  await browser.ThunderbirdCalDAV.deleteTask(calendarId, id);
  resetTaskEditor();
  await refreshTasks();
  setStatus("任务已删除。");
}

function resetEventEditor() {
  $("event-id").value = "";
  $("event-editor-title").textContent = "新建事件";
  $("event-title").value = "";
  $("event-start").value = "";
  $("event-end").value = "";
  $("event-categories").value = "";
  $("event-description").value = "";
  $("event-delete").hidden = true;
}

function editEvent(event) {
  $("event-id").value = event.id;
  $("event-editor-title").textContent = "编辑事件";
  $("event-calendar").value = event.calendarId;
  $("event-title").value = event.title;
  $("event-start").value = icalToInput(event.start, true);
  $("event-end").value = icalToInput(event.end, true);
  $("event-categories").value = (event.categories || []).join(", ");
  $("event-description").value = event.description || "";
  $("event-delete").hidden = false;
}

function eventValues() {
  return {
    title: $("event-title").value.trim(),
    start: $("event-start").value || null,
    end: $("event-end").value || null,
    categories: splitCategories($("event-categories").value),
    description: $("event-description").value,
  };
}

async function saveEvent() {
  const calendarId = $("event-calendar").value;
  if (!calendarId) throw new Error("没有可写的 Calendar");
  const id = $("event-id").value;
  if (!$("event-title").value.trim()) throw new Error("事件标题不能为空");
  if (!$("event-start").value) throw new Error("事件开始时间不能为空");

  setStatus("正在通过 Thunderbird 保存 VEVENT…");
  if (id) {
    await browser.ThunderbirdCalDAV.updateEvent(calendarId, id, eventValues());
  } else {
    await browser.ThunderbirdCalDAV.createEvent(calendarId, eventValues());
  }
  resetEventEditor();
  await refreshEvents();
  setStatus("Thunderbird 已提交事件修改；CalDAV 同步由 Thunderbird provider 负责。");
}

async function deleteEvent() {
  const id = $("event-id").value;
  const calendarId = $("event-calendar").value;
  if (!id || !confirm("删除这个事件？")) return;
  setStatus("正在通过 Thunderbird 删除 VEVENT…");
  await browser.ThunderbirdCalDAV.deleteEvent(calendarId, id);
  resetEventEditor();
  await refreshEvents();
  setStatus("事件已删除。");
}

function defaultEventRange() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 7);
  const end = new Date(today);
  end.setDate(end.getDate() + 31);
  const format = date => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  $("event-range-start").value ||= format(start);
  $("event-range-end").value ||= format(end);
}

async function refreshTasks() {
  state.tasks = await browser.ThunderbirdCalDAV.listTasks();
  renderTasks();
}

async function refreshEvents() {
  defaultEventRange();
  state.events = await browser.ThunderbirdCalDAV.listEvents(
    "",
    $("event-range-start").value,
    $("event-range-end").value
  );
  renderEvents();
}

async function refreshAll() {
  setStatus("正在直接读取 Thunderbird Calendar/Tasks…");
  state.calendars = await browser.ThunderbirdCalDAV.listCalendars();
  populateCalendars();
  await Promise.all([refreshTasks(), refreshEvents()]);
  setStatus(`已读取 ${state.calendars.length} 个 Calendar、${state.tasks.length} 个任务、${state.events.length} 个事件。`);
}

function guard(fn) {
  return async event => {
    event?.preventDefault?.();
    try {
      await fn();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || String(error), true);
    }
  };
}

for (const button of document.querySelectorAll(".tab")) {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === button));
    const selected = button.dataset.tab;
    $("tasks-panel").hidden = selected !== "tasks";
    $("events-panel").hidden = selected !== "events";
  });
}

$("refresh").addEventListener("click", guard(refreshAll));
$("calendar-filter").addEventListener("change", () => {
  renderTasks();
  renderEvents();
});
$("task-search").addEventListener("input", renderTasks);
$("task-new").addEventListener("click", resetTaskEditor);
$("task-save").addEventListener("click", guard(saveTask));
$("task-delete").addEventListener("click", guard(deleteTask));
$("event-new").addEventListener("click", resetEventEditor);
$("event-save").addEventListener("click", guard(saveEvent));
$("event-delete").addEventListener("click", guard(deleteEvent));
$("event-range-apply").addEventListener("click", guard(refreshEvents));

browser.ThunderbirdCalDAV.onItemsChanged.addListener(() => {
  clearTimeout(globalThis.__thunderbirdCalDAVRefreshTimer);
  globalThis.__thunderbirdCalDAVRefreshTimer = setTimeout(() => refreshAll().catch(console.error), 250);
});

defaultEventRange();
refreshAll().catch(error => setStatus(error?.message || String(error), true));
