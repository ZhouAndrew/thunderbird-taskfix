"use strict";

const $ = id => document.getElementById(id);
const state = {calendars: [], tasks: [], events: []};

function setStatus(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

function calendarState(id) {
  return state.calendars.find(calendar => calendar.id === id) || null;
}

function splitCategories(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean)
  )];
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

function fillEditorCalendar(selectId, capability) {
  const select = $(selectId);
  const selected = select.value;
  select.replaceChildren();

  for (const calendar of state.calendars) {
    if (calendar.disabled || !calendar[capability]) continue;
    const option = document.createElement("option");
    option.value = calendar.id;
    option.textContent =
      calendar.name + (calendar.readOnly ? " · 只读" : "");
    option.disabled = calendar.readOnly;
    select.appendChild(option);
  }

  if ([...select.options].some(option => option.value === selected)) {
    select.value = selected;
  } else {
    const firstWritable = [...select.options].find(option => !option.disabled);
    if (firstWritable) select.value = firstWritable.value;
  }
}

function populateCalendars() {
  const currentFilter = $("calendar-filter").value;
  $("calendar-filter").replaceChildren();

  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部 Calendar";
  $("calendar-filter").appendChild(all);

  for (const calendar of state.calendars) {
    const option = document.createElement("option");
    option.value = calendar.id;
    const flags = [
      calendar.disabled ? "已停用" : "",
      calendar.readOnly ? "只读" : "",
    ].filter(Boolean);
    option.textContent =
      calendar.name + (flags.length ? ` · ${flags.join(" · ")}` : "");
    $("calendar-filter").appendChild(option);
  }

  $("calendar-filter").value = state.calendars.some(
    calendar => calendar.id === currentFilter
  )
    ? currentFilter
    : "";

  fillEditorCalendar("task-calendar", "supportsTasks");
  fillEditorCalendar("event-calendar", "supportsEvents");
}

function filteredTasks() {
  const calendarId = $("calendar-filter").value;
  const search = $("task-search").value.trim().toLocaleLowerCase();
  return state.tasks.filter(
    task =>
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
    const categories = task.categories?.length
      ? ` · ${task.categories.join(", ")}`
      : "";
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
  const events = state.events.filter(
    event => !calendarId || event.calendarId === calendarId
  );
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

function setTaskEditorWritable(writable) {
  $("task-save").disabled = !writable;
  $("task-delete").disabled = !writable;
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
  $("task-calendar").disabled = false;
  $("task-delete").hidden = true;
  setTaskEditorWritable(Boolean($("task-calendar").value));
}

function editTask(task) {
  const calendar = calendarState(task.calendarId);
  $("task-id").value = task.id;
  $("task-editor-title").textContent =
    calendar?.readOnly ? "查看任务（只读）" : "编辑任务";
  $("task-calendar").value = task.calendarId;
  $("task-calendar").disabled = true;
  $("task-title").value = task.title;
  $("task-due").value = icalToInput(task.due);
  $("task-status").value = task.status || "";
  $("task-priority").value = String(task.priority || 0);
  $("task-categories").value = (task.categories || []).join(", ");
  $("task-description").value = task.description || "";
  $("task-delete").hidden = false;
  setTaskEditorWritable(Boolean(calendar && !calendar.readOnly && !calendar.disabled));
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
  if (!$("task-title").value.trim()) {
    throw new Error("任务标题不能为空");
  }

  setStatus("正在通过 Thunderbird 保存 VTODO…");
  if (id) {
    await browser.ThunderbirdCalDAV.updateTask(
      calendarId,
      id,
      taskValues()
    );
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

function setEventEditorWritable(writable) {
  $("event-save").disabled = !writable;
  $("event-delete").disabled = !writable;
}

function resetEventEditor() {
  $("event-id").value = "";
  $("event-editor-title").textContent = "新建事件";
  $("event-title").value = "";
  $("event-start").value = "";
  $("event-end").value = "";
  $("event-categories").value = "";
  $("event-description").value = "";
  $("event-calendar").disabled = false;
  $("event-delete").hidden = true;
  setEventEditorWritable(Boolean($("event-calendar").value));
}

function editEvent(event) {
  const calendar = calendarState(event.calendarId);
  $("event-id").value = event.id;
  $("event-editor-title").textContent =
    calendar?.readOnly ? "查看事件（只读）" : "编辑事件";
  $("event-calendar").value = event.calendarId;
  $("event-calendar").disabled = true;
  $("event-title").value = event.title;
  $("event-start").value = icalToInput(event.start, true);
  $("event-end").value = icalToInput(event.end, true);
  $("event-categories").value = (event.categories || []).join(", ");
  $("event-description").value = event.description || "";
  $("event-delete").hidden = false;
  setEventEditorWritable(Boolean(calendar && !calendar.readOnly && !calendar.disabled));
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
  if (!$("event-title").value.trim()) {
    throw new Error("事件标题不能为空");
  }
  if (!$("event-start").value) {
    throw new Error("事件开始时间不能为空");
  }
  if (
    $("event-end").value &&
    $("event-end").value < $("event-start").value
  ) {
    throw new Error("事件结束时间不能早于开始时间");
  }

  setStatus("正在通过 Thunderbird 保存 VEVENT…");
  if (id) {
    await browser.ThunderbirdCalDAV.updateEvent(
      calendarId,
      id,
      eventValues()
    );
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

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultEventRange() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 7);
  const end = new Date(today);
  end.setDate(end.getDate() + 31);
  $("event-range-start").value ||= formatLocalDate(start);
  $("event-range-end").value ||= formatLocalDate(end);
}

function inclusiveEndAsExclusive(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  const end = new Date(year, month - 1, day);
  end.setDate(end.getDate() + 1);
  return formatLocalDate(end);
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
    inclusiveEndAsExclusive($("event-range-end").value)
  );
  renderEvents();
}

async function refreshAll() {
  setStatus("正在直接读取 Thunderbird Calendar/Tasks…");
  state.calendars = await browser.ThunderbirdCalDAV.listCalendars();
  populateCalendars();
  await Promise.all([refreshTasks(), refreshEvents()]);
  resetTaskEditor();
  resetEventEditor();
  setStatus(
    `已读取 ${state.calendars.length} 个 Calendar、${state.tasks.length} 个任务、${state.events.length} 个事件。`
  );
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
    document
      .querySelectorAll(".tab")
      .forEach(x => x.classList.toggle("active", x === button));
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
  globalThis.__thunderbirdCalDAVRefreshTimer = setTimeout(
    () => refreshAll().catch(console.error),
    250
  );
});

defaultEventRange();
refreshAll().catch(error => setStatus(error?.message || String(error), true));
