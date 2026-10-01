"use strict";
const $ = id => document.getElementById(id);
let calendars = [];

function option(select, value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  select.appendChild(item);
}

function renderResult(result) {
  const root = $("test-result");
  root.replaceChildren();
  if (!result) {
    root.textContent = "尚未测试。";
    return;
  }
  const head = document.createElement("div");
  head.className = "result-summary " + (result.success ? "ok" : "fail");
  head.textContent = (result.success ? "✓ " : "✗ ") + (result.summary || result.action);
  root.appendChild(head);

  const list = document.createElement("ul");
  list.className = "result-list";
  for (const step of result.steps || []) {
    const item = document.createElement("li");
    const latency = step.latencyMs !== undefined ? " · " + step.latencyMs + " ms" : "";
    item.textContent = (step.success === false ? "✗ " : "✓ ") +
      (step.name || step.operation || "步骤") + latency;
    list.appendChild(item);
  }
  if (result.logSaved === false) {
    const item = document.createElement("li");
    item.textContent = "⚠ 持久日志保存失败：" + (result.logError || "未知错误");
    list.appendChild(item);
  } else if (result.logSaved === true) {
    const item = document.createElement("li");
    item.textContent = "结果已写入日志";
    list.appendChild(item);
  }
  root.appendChild(list);
}

async function saveSettings() {
  const wordpress = {
    baseUrl: $("wp-url").value,
    username: $("wp-user").value,
    applicationPassword: $("wp-password").value,
  };
  await AssistantWordPress.saveConfig(wordpress);
  await AssistantStorage.saveSettings({
    taskCalendarId: $("task-calendar").value,
    workCalendarId: $("work-calendar").value,
  });

  const result = {
    action: "settings.save",
    success: true,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    summary: "设置已保存。",
    steps: [],
  };
  const stored = await AssistantStorage.persistResult(result, "system");
  $("save-result").textContent = stored.logSaved === false
    ? "⚠ 设置已保存，但日志保存失败。"
    : "✓ 设置已保存，并已写入日志。";
}

async function load() {
  calendars = await browser.ThunderbirdCalDAV.listCalendars();
  const settings = await AssistantStorage.getSettings();
  const wp = await AssistantWordPress.getConfig();

  $("task-calendar").replaceChildren();
  option($("task-calendar"), "", "全部 Task Calendar");
  for (const calendar of calendars.filter(item => item.supportsTasks && !item.disabled)) {
    option(
      $("task-calendar"),
      calendar.id,
      calendar.name + (calendar.readOnly ? " · 只读" : "")
    );
  }

  $("work-calendar").replaceChildren();
  for (const calendar of calendars.filter(item =>
    item.supportsEvents && !item.disabled && !item.readOnly
  )) {
    option($("work-calendar"), calendar.id, calendar.name);
  }

  $("task-calendar").value = settings.taskCalendarId || "";
  if ([...$("work-calendar").options].some(item => item.value === settings.workCalendarId)) {
    $("work-calendar").value = settings.workCalendarId;
  }

  $("wp-url").value = wp.baseUrl || "";
  $("wp-user").value = wp.username || "";
  $("wp-password").value = wp.applicationPassword || "";
}

$("save-settings").addEventListener("click", saveSettings);
$("calendar-quick").addEventListener("click", async () => {
  renderResult(await AssistantConnection.quickCalendarTest());
});
$("calendar-full").addEventListener("click", async () => {
  const calendarId = $("work-calendar").value;
  if (!calendarId) {
    const result = await AssistantStorage.persistResult({
      action: "connection.full-calendar-write",
      success: false,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      summary: "没有可写的 Work Calendar。",
      steps: [],
    }, "connection");
    renderResult(result);
    return;
  }
  renderResult(await AssistantConnection.fullCalendarWriteTest(calendarId));
});
$("wp-quick").addEventListener("click", async () => {
  await saveSettings();
  renderResult(await AssistantWordPress.quickTest());
});
$("wp-full").addEventListener("click", async () => {
  await saveSettings();
  renderResult(await AssistantWordPress.fullWriteTest());
});

load().catch(async error => {
  const result = await AssistantStorage.persistResult({
    action: "tools.load",
    success: false,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    summary: "工具页面读取失败：" + String(error && error.message || error),
    steps: [],
  }, "system");
  renderResult(result);
});
