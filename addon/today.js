"use strict";
const root=document.getElementById("today");
function localDay(iso) {
  const d=new Date(iso);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}
(async()=>{
  const today=localDay(new Date().toISOString());
  const records=(await AssistantStorage.listAudit()).filter(r=>r.scope==="workflow" && localDay(r.timestamp)===today);
  if (!records.length) { root.textContent="今天还没有工作流程记录。"; return; }
  const table=document.createElement("table");
  table.innerHTML="<thead><tr><th>时间</th><th>动作</th><th>Task</th><th>结果</th></tr></thead>";
  const body=document.createElement("tbody");
  for (const r of records) {
    const tr=document.createElement("tr");
    const cells=[
      new Date(r.timestamp).toLocaleTimeString(),
      r.action,
      r.details?.task?.title || "—",
      r.success ? "成功" : "失败",
    ];
    for (const value of cells) { const td=document.createElement("td"); td.textContent=value; tr.appendChild(td); }
    body.appendChild(tr);
  }
  table.appendChild(body); root.appendChild(table);
})();
