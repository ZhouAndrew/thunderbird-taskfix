"use strict";
const $ = id => document.getElementById(id);

function render(result) {
  const root = $("result");
  root.replaceChildren();
  if (!result) {
    root.textContent = "尚未写入。";
    return;
  }

  const head = document.createElement("div");
  head.className = "result-summary " + (result.success ? "ok" : "fail");
  head.textContent = result.success ? "✓ " + result.summary : "✗ " + result.summary;
  root.appendChild(head);

  const lines = [];
  if (result.post) {
    lines.push("Post ID: " + result.post.id);
    lines.push("Status: " + result.post.status);
    if (result.post.link) lines.push("URL: " + result.post.link);
  }
  for (const media of result.media || []) {
    lines.push("Media ID: " + media.id + " · " + (media.filename || "附件"));
  }
  if (result.logSaved === false) {
    lines.push("⚠ 持久日志保存失败：" + (result.logError || "未知错误"));
  } else if (result.logSaved === true) {
    lines.push("结果已写入日志");
  }

  if (lines.length) {
    const list = document.createElement("ul");
    list.className = "result-list";
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    }
    root.appendChild(list);
  }
}

$("submit").addEventListener("click", async () => {
  $("submit").disabled = true;
  try {
    const result = await AssistantWordPress.createLog({
      title: $("title").value,
      content: $("content").value,
      status: $("post-status").value,
      files: [...$("files").files],
    });
    render(result);
  } finally {
    $("submit").disabled = false;
  }
});

AssistantStorage.listAudit().then(records => {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].scope === "wordpress" && records[i].details) {
      render(records[i].details);
      break;
    }
  }
});
