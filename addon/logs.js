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
async function load() { records = await AssistantStorage.listAudit(); render(); }
$("scope").addEventListener("change", render);
$("search").addEventListener("input", render);
$("reload").addEventListener("click", load);
$("clear").addEventListener("click", () => {$("clear-confirm").hidden = false;});
$("clear-no").addEventListener("click", () => {$("clear-confirm").hidden = true;});
$("clear-yes").addEventListener("click", async () => {
  await AssistantStorage.clearAudit();
  $("clear-confirm").hidden = true;
  await load();
});
load();
