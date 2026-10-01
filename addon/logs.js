"use strict";
const $ = id => document.getElementById(id);
let records = [];
let clearing = false;

function setLogStatus(message = "") {
  const node = $("log-status");
  node.textContent = message;
  node.hidden = !message;
}

function render() {
  const scope = $("scope").value;
  const search = $("search").value.trim().toLowerCase();
  const filtered = records.filter(record =>
    (!scope || record.scope === scope) &&
    (!search || JSON.stringify(record).toLowerCase().includes(search))
  ).reverse();

  $("logs").replaceChildren();

  if (clearing) {
    $("logs").hidden = true;
    return;
  }
  $("logs").hidden = false;

  if (!records.length) {
    $("logs").textContent = "尚无操作日志。";
    return;
  }
  if (!filtered.length) {
    $("logs").textContent = "当前筛选没有匹配的日志。";
    return;
  }

  for (const record of filtered) {
    const row = document.createElement("article");
    row.className = "log-record";

    const head = document.createElement("div");
    head.className = "log-head";
    const time = document.createElement("strong");
    time.textContent = new Date(record.timestamp).toLocaleString();
    const scopeBadge = document.createElement("span");
    scopeBadge.className = "badge";
    scopeBadge.textContent = record.scope;
    const result = document.createElement("span");
    result.textContent = record.success ? "✓ 成功" : "✗ 失败";
    head.append(time, scopeBadge, result);

    const summary = document.createElement("p");
    summary.textContent = record.summary || record.action;

    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(record.details, null, 2);
    row.append(head, summary, pre);
    $("logs").appendChild(row);
  }
}

async function load() {
  records = await AssistantStorage.listAudit();
  render();
}

async function loadDiagnostics() {
  try {
    const info = await browser.ThunderbirdCalDAV.diagnosticsInfo();
    const data = await browser.ThunderbirdCalDAV.readDiagnostics(600);
    $("diag-path").textContent = info.path ? "文件：" + info.path : "诊断文件不可用";
    $("diagnostics").textContent = data.text || "尚无诊断日志。";
  } catch (error) {
    $("diagnostics").textContent = "读取技术诊断失败：" + String(error && error.message || error);
  }
}

$("scope").addEventListener("change", () => {
  setLogStatus("");
  render();
});
$("search").addEventListener("input", () => {
  setLogStatus("");
  render();
});
$("reload").addEventListener("click", async () => {
  setLogStatus("");
  await load();
});
$("clear").addEventListener("click", () => {
  clearing = true;
  setLogStatus("");
  $("clear-confirm").hidden = false;
  render();
});
$("clear-no").addEventListener("click", () => {
  clearing = false;
  $("clear-confirm").hidden = true;
  render();
});
$("clear-yes").addEventListener("click", async () => {
  $("clear-yes").disabled = true;
  try {
    await AssistantStorage.clearAudit();
    records = [];
    $("scope").value = "";
    $("search").value = "";
    setLogStatus("✓ 操作日志已清空。");
  } finally {
    clearing = false;
    $("clear-confirm").hidden = true;
    $("clear-yes").disabled = false;
    render();
  }
});
$("diag-reload").addEventListener("click", loadDiagnostics);
$("diag-clear").addEventListener("click", async () => {
  await browser.ThunderbirdCalDAV.clearDiagnostics();
  await loadDiagnostics();
});
$("diag-copy").addEventListener("click", async () => {
  const text = $("diag-path").textContent + "\n" + $("diagnostics").textContent;
  await navigator.clipboard.writeText(text);
});

load();
loadDiagnostics();
