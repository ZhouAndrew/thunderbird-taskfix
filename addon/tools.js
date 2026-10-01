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

async function saveWordPressFromForm() {
  await AssistantWordPress.saveConfig({
    transport: $("wp-transport").value,
    baseUrl: $("wp-url").value,
    username: $("wp-user").value,
    applicationPassword: $("wp-password").value,
    wordpressPath: $("wp-path").value,
    wpCliCommand: $("wp-cli").value,
  });
}

async function saveSettings() {
  await saveWordPressFromForm();

  const changed = await AssistantStorage.saveSettingsWithUndo({
    taskView: $("task-view").value || "incomplete",
    taskCalendarId: $("task-calendar").value,
    workCalendarId: $("work-calendar").value,
  });

  const result = {
    action: "settings.save",
    success: true,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    summary: "设置已保存。",
    steps: [{
      component: "Settings",
      operation: "save defaults",
      success: true,
      details: {
        keys: changed.keys,
      },
    }],
  };
  const stored = await AssistantStorage.persistResult(result, "system");
  $("save-result").textContent = stored.logSaved === false
    ? "⚠ 设置已保存，但日志保存失败。可以撤销刚才的 Calendar / 视图设置。"
    : "✓ 设置已保存。可以继续使用，也可以撤销刚才的 Calendar / 视图设置。";
  $("undo-settings").hidden = false;
}

async function undoSettings() {
  const restored = await AssistantStorage.undoSettings();
  if (!restored) {
    $("save-result").textContent = "没有可以撤销的设置修改。";
    $("undo-settings").hidden = true;
    return;
  }

  const result = await AssistantStorage.persistResult({
    action: "settings.undo",
    success: true,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    summary: "已撤销刚才的 Calendar / 视图设置。",
    steps: [{
      component: "Settings",
      operation: "undo defaults",
      success: true,
      details: {keys: ["taskView", "taskCalendarId", "workCalendarId"]},
    }],
  }, "system");

  await load();
  $("save-result").textContent = result.logSaved === false
    ? "⚠ 设置已撤销，但日志保存失败。"
    : "✓ 已撤销刚才的 Calendar / 视图设置。";
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

  $("task-view").value = settings.taskView || "incomplete";

  const taskCalendarExists = [...$("task-calendar").options]
    .some(item => item.value === (settings.taskCalendarId || ""));
  $("task-calendar").value = taskCalendarExists ? (settings.taskCalendarId || "") : "";

  if ([...$("work-calendar").options].some(item => item.value === settings.workCalendarId)) {
    $("work-calendar").value = settings.workCalendarId;
  }

  $("wp-transport").value = wp.transport || "auto";
  $("wp-url").value = wp.baseUrl || "";
  $("wp-user").value = wp.username || "";
  $("wp-password").value = wp.applicationPassword || "";
  $("wp-path").value = wp.wordpressPath || "/var/www/html/wordpress";
  $("wp-cli").value = wp.wpCliCommand || "wp";

  $("undo-settings").hidden = !(await AssistantStorage.getSettingsUndo());

  if (settings.taskCalendarId && !taskCalendarExists) {
    $("save-result").textContent =
      "原来的默认 Task Calendar 目前不可用。请选择新的 Calendar，或选择“全部 Task Calendar”。";
  }
}

$("save-settings").addEventListener("click", saveSettings);
$("undo-settings").addEventListener("click", undoSettings);
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
async function runWordPressConnectionTest(action, label, runner) {
  try {
    await saveWordPressFromForm();
    renderResult(await runner());
  } catch (error) {
    const message = String(error?.message || error || "Unknown error");
    const result = await AssistantStorage.persistResult({
      action,
      success: false,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      summary: label + " failed: " + message,
      steps: [{name: "WordPress connection", success: false, error: message}],
    }, "connection");
    renderResult(result);
  }
}

$("wp-quick").addEventListener("click", () => {
  void runWordPressConnectionTest(
    "connection.wordpress-quick",
    "WordPress quick test",
    () => AssistantWordPress.quickTest()
  );
});
$("wp-full").addEventListener("click", () => {
  void runWordPressConnectionTest(
    "connection.wordpress-full-write",
    "WordPress full write test",
    () => AssistantWordPress.fullWriteTest()
  );
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
