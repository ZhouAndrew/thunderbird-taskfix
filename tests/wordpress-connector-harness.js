"use strict";

const fs = require("fs");
const vm = require("vm");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (!global.btoa) global.btoa = value => Buffer.from(value, "binary").toString("base64");
if (!global.atob) global.atob = value => Buffer.from(value, "base64").toString("binary");

const local = {};
const storageWrites = [];
global.browser = {
  storage: {
    local: {
      async get(key) { return {[key]: local[key]}; },
      async set(values) { storageWrites.push(...Object.keys(values)); Object.assign(local, values); },
    },
  },
  permissions: {
    async contains() { return true; },
  },
};

let nextPost = 100;
let nextMedia = 200;
const posts = new Map();
const media = new Map();

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {"Content-Type": "application/json"},
  });
}

global.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^.*\/wp-json\/wp\/v2/, "");
  const method = (options.method || "GET").toUpperCase();

  assert(options.headers.get("Authorization")?.startsWith("Basic "), "missing Basic auth");

  if (path === "/users/me" && method === "GET") {
    return jsonResponse({id: 7, name: "Acceptance User", slug: "acceptance"});
  }

  if (path === "/posts" && method === "GET") {
    const search = parsed.searchParams.get("search") || "";
    return jsonResponse(
      [...posts.values()].filter(post =>
        !search || String(post.title?.raw || post.title?.rendered || "").includes(search)
      )
    );
  }

  if (path === "/posts" && method === "POST") {
    const body = JSON.parse(options.body);
    const id = ++nextPost;
    const post = {
      id,
      status: body.status || "draft",
      link: `http://example.test/?p=${id}`,
      title: {raw: body.title || "", rendered: body.title || ""},
      content: {raw: body.content || "", rendered: body.content || ""},
    };
    posts.set(id, post);
    return jsonResponse(post, 201);
  }

  let match = /^\/posts\/(\d+)$/.exec(path);
  if (match) {
    const id = Number(match[1]);
    const post = posts.get(id);
    if (!post) return jsonResponse({message: "missing"}, 404);
    if (method === "GET") return jsonResponse(post);
    if (method === "POST") {
      const body = JSON.parse(options.body);
      if ("content" in body) post.content = {raw: body.content, rendered: body.content};
      if ("title" in body) post.title = {raw: body.title, rendered: body.title};
      if ("status" in body) post.status = body.status;
      return jsonResponse(post);
    }
    if (method === "DELETE") {
      posts.delete(id);
      return jsonResponse({deleted: true, previous: post});
    }
  }

  if (path === "/media" && method === "POST") {
    const id = ++nextMedia;
    const item = {
      id,
      source_url: `http://example.test/uploads/test-${id}.png`,
      post: 0,
    };
    media.set(id, item);
    return jsonResponse(item, 201);
  }

  match = /^\/media\/(\d+)$/.exec(path);
  if (match) {
    const id = Number(match[1]);
    const item = media.get(id);
    if (!item) return jsonResponse({message: "missing"}, 404);
    if (method === "GET") return jsonResponse(item);
    if (method === "POST") {
      const body = JSON.parse(options.body);
      if ("post" in body) item.post = body.post;
      return jsonResponse(item);
    }
    if (method === "DELETE") {
      media.delete(id);
      return jsonResponse({deleted: true, previous: item});
    }
  }

  return jsonResponse({message: `unhandled ${method} ${path}`}, 500);
};

global.window = global;

for (const path of ["addon/core/storage.js", "addon/core/wordpress.js"]) {
  vm.runInThisContext(fs.readFileSync(path, "utf8"), {filename: path});
}

(async () => {
  await AssistantWordPress.saveConfig({
    baseUrl: "http://example.test/wordpress/",
    username: "acceptance",
    applicationPassword: "secret-app-password",
  });

  await AssistantStorage.saveSettingsWithUndo({taskView: "completed"});
  assert(
    !JSON.stringify(local["caldavAssistant.settingsUndo"]).includes("secret-app-password"),
    "settings undo duplicated the WordPress application password"
  );
  await AssistantStorage.undoSettings();
  assert(
    (await AssistantStorage.getSettings()).wordpress?.applicationPassword === "secret-app-password",
    "targeted settings undo damaged unrelated WordPress configuration"
  );

  const quick = await AssistantWordPress.quickTest();
  assert(quick.success, "WordPress quick test failed after explicit permission grant");
  assert(quick.logSaved === true, "WordPress quick result was not persistently logged");

  const firstAuditWrite = storageWrites.indexOf("caldavAssistant.audit");
  const firstReceiptWrite = storageWrites.indexOf("caldavAssistant.lastReceipt");
  assert(
    firstAuditWrite >= 0 && firstReceiptWrite >= 0 && firstAuditWrite < firstReceiptWrite,
    "WordPress result cache was written before the persistent log"
  );

  const full = await AssistantWordPress.fullWriteTest();
  assert(full.success, "WordPress full write test failed");
  assert(posts.size === 0, "full write test left a TEST post behind");
  assert(media.size === 0, "full write test left TEST media behind");
  assert(
    full.steps.some(step => step.name === "update + read-back TEST post"),
    "full test did not verify post update"
  );
  assert(
    full.steps.some(step => step.name === "read TEST media"),
    "full test did not verify media read-back"
  );

  const file = new Blob(["attachment"], {type: "text/plain"});
  Object.defineProperty(file, "name", {value: "note.txt"});
  const image = new Blob(["png"], {type: "image/png"});
  Object.defineProperty(image, "name", {value: "photo.png"});
  const firstLog = await AssistantWordPress.createLog({
    content: "Completed work.",
    files: [file, image],
  });
  assert(firstLog.success, "WordPress first log append failed");
  assert(firstLog.post?.id, "WordPress log receipt has no Post ID");
  assert(firstLog.post.createdToday === true, "first log did not create today's daily post");
  assert(firstLog.media?.[0]?.id, "WordPress log receipt has no Media ID");
  assert(firstLog.media?.[1]?.id, "WordPress image receipt has no Media ID");
  assert(firstLog.media.every(item => item.parent === firstLog.post.id), "media parent Post ID was not reported");

  const dailyPostId = firstLog.post.id;

  // The older wp-cli finder accepts month abbreviation, arbitrary spacing,
  // and title token order. Keep the add-on compatible with those existing
  // daily posts instead of creating a duplicate.
  const createdTitleParts = String(firstLog.post.title || "").trim().split(/\s+/);
  assert(createdTitleParts.length === 4, "unexpected generated daily title");
  const [monthName, dayNumber, weekdayName, yearNumber] = createdTitleParts;
  posts.get(dailyPostId).title = {
    raw: weekdayName + " " + monthName.slice(0, 3) + " " + dayNumber + " " + yearNumber,
    rendered: weekdayName + " " + monthName.slice(0, 3) + " " + dayNumber + " " + yearNumber,
  };

  const secondLog = await AssistantWordPress.createLog({
    content: "Second work entry.",
    files: [],
  });
  assert(secondLog.success, "WordPress second log append failed");
  assert(secondLog.post?.id === dailyPostId, "second log created a different WordPress post");
  assert(secondLog.post.createdToday === false, "second log did not reuse today's daily post");
  assert(posts.size === 1, "one-by-one logging created more than one daily WordPress post");
  const dailyPost = posts.get(dailyPostId);
  const dailyContent = dailyPost?.content?.raw || "";
  const title = firstLog.post.title || "";
  assert(
    /^[A-Za-z]+ \d{1,2}  [A-Za-z]+  \d{4}$/.test(title),
    "new daily WordPress post title no longer matches the existing helper format"
  );
  assert(dailyContent.includes("Completed work."), "first log entry was lost");
  assert(dailyContent.includes("Second work entry."), "second log entry was not appended");
  assert(/<p>\d{2}:\d{2} Completed work\.<\/p>/.test(dailyContent), "log entry has no HH:MM prefix");
  assert(dailyContent.includes("<!-- wp:file"), "generic attachment is not a Gutenberg file block");
  assert(dailyContent.includes("note.txt"), "attachment link was not appended to the daily log");
  assert(dailyContent.includes("<!-- wp:image"), "image attachment is not a Gutenberg image block");
  assert(dailyContent.includes("photo.png"), "image attachment alt text was not preserved");

  const audits = await AssistantStorage.listAudit();
  assert(audits.some(row => row.scope === "wordpress"), "WordPress log was not audited");
  assert(
    !JSON.stringify(audits).includes("secret-app-password"),
    "WordPress application password leaked into audit logs"
  );

  console.log("wordpress-connector-harness: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
