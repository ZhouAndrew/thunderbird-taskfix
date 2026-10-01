"use strict";
const $ = id => document.getElementById(id);

function renderResult(result) {
  const root = $("result");
  root.replaceChildren();
  if (!result) { root.textContent = "尚未测试。"; return; }
  const head = document.createElement("div");
  head.className = "receipt-summary " + (result.success ? "ok" : "fail");
  head.textContent = (result.success ? "✓ " : "✗ ") + (result.summary || result.action);
  root.appendChild(head);
  for (const step of result.steps || []) {
    const row = document.createElement("div");
    row.className = "receipt-step";
    const title = document.createElement("strong");
    title.textContent = (step.success === false ? "✗ " : "✓ ") + (step.name || step.operation || "");
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(step, null, 2);
    row.append(title, pre);
    root.appendChild(row);
  }
}

async function load() {
  const calendars = await browser.ThunderbirdCalDAV.listCalendars();
  $("calendar").replaceChildren();
  for (const calendar of calendars.filter(x => x.supportsEvents && !x.disabled && !x.readOnly)) {
    const option = document.createElement("option");
    option.value = calendar.id;
    option.textContent = calendar.name;
    $("calendar").appendChild(option);
  }
  const config = await AssistantWordPress.getConfig();
  $("wp-url").value = config.baseUrl || "";
  $("wp-user").value = config.username || "";
  $("wp-password").value = config.applicationPassword || "";
  renderResult(await AssistantStorage.getLastReceipt());
}

$("calendar-quick").addEventListener("click", async () => {
  renderResult(await AssistantConnection.quickCalendarTest());
});
$("calendar-full").addEventListener("click", async () => {
  if (!$("calendar").value) {
    renderResult({success:false,summary:"没有可写的 VEVENT Calendar。",steps:[]});
    return;
  }
  renderResult(await AssistantConnection.fullCalendarWriteTest($("calendar").value));
});
$("wp-save").addEventListener("click", async () => {
  await AssistantWordPress.saveConfig({
    baseUrl: $("wp-url").value,
    username: $("wp-user").value,
    applicationPassword: $("wp-password").value,
  });
  renderResult({
    success:true,
    summary:"WordPress 连接设置已保存。密码不会写入操作日志。",
    steps:[{name:"save settings",success:true}],
  });
});
$("wp-quick").addEventListener("click", async () => {
  await AssistantWordPress.saveConfig({
    baseUrl: $("wp-url").value,
    username: $("wp-user").value,
    applicationPassword: $("wp-password").value,
  });
  renderResult(await AssistantWordPress.quickTest());
});
$("wp-full").addEventListener("click", async () => {
  await AssistantWordPress.saveConfig({
    baseUrl: $("wp-url").value,
    username: $("wp-user").value,
    applicationPassword: $("wp-password").value,
  });
  renderResult(await AssistantWordPress.fullWriteTest());
});
load().catch(error => renderResult({success:false,summary:String(error?.message || error),steps:[]}));
