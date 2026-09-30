"use strict";
const $ = id => document.getElementById(id);
function render(result) {
  const root = $("result"); root.replaceChildren();
  if (!result) { root.textContent = "尚未写入。"; return; }
  const head=document.createElement("div");
  head.className="receipt-summary " + (result.success ? "ok" : "fail");
  head.textContent=(result.success?"✓ ":"✗ ") + result.summary;
  root.appendChild(head);
  if (result.post) {
    const post=document.createElement("div"); post.className="receipt-step";
    post.textContent=`Post ID: ${result.post.id}\nStatus: ${result.post.status}\nURL: ${result.post.link || "—"}`;
    post.style.whiteSpace="pre-line"; root.appendChild(post);
  }
  for (const media of result.media || []) {
    const row=document.createElement("div"); row.className="receipt-step";
    row.textContent=`Media ID: ${media.id}\nFile: ${media.filename}\nParent Post: ${media.parent}\nURL: ${media.sourceUrl || "—"}`;
    row.style.whiteSpace="pre-line"; root.appendChild(row);
  }
  for (const step of result.steps || []) {
    const pre=document.createElement("pre"); pre.textContent=JSON.stringify(step,null,2);
    const row=document.createElement("div"); row.className="receipt-step"; row.appendChild(pre); root.appendChild(row);
  }
}
$("submit").addEventListener("click", async () => {
  $("submit").disabled=true;
  try {
    const result=await AssistantWordPress.createLog({
      title:$("title").value,
      content:$("content").value,
      status:$("post-status").value,
      files:[...$("files").files],
    });
    render(result);
  } finally {
    $("submit").disabled=false;
  }
});
AssistantStorage.getLastReceipt().then(result => {
  if (result?.action === "wordpress.create-log") render(result);
});
