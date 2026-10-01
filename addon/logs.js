"use strict";
const $ = id => document.getElementById(id);
let records = [];

function render() {
  const scope = $("scope").value;
  const search = $("search").value.trim().toLowerCase();
  const filtered = records.filter(record =>
    (!scope || record.scope === scope) &&
    (!search || JSON.stringify(record).toLowerCase().includes(search))
  ).reverse();

  $("logs").replaceChildren();
  if (!filtered.length) {
    $("logs").textContent = "没有匹配的日志。";
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

$("scope").addEventListener("change", render);
$("search").addEventListener("input", render);
$("reload").addEventListener("click", load);
$("clear").addEventListener("click", () => { $("clear-confirm").hidden = false; });
$("clear-no").addEventListener("click", () => { $("clear-confirm").hidden = true; });
$("clear-yes").addEventListener("click", async () => {
  await AssistantStorage.clearAudit();
  $("clear-confirm").hidden = true;
  await load();
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
