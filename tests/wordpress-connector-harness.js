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
let permissionGranted = false;
global.browser = {
  storage: {
    local: {
      async get(key) { return {[key]: local[key]}; },
      async set(values) { storageWrites.push(...Object.keys(values)); Object.assign(local, values); },
    },
  },
  permissions: {
    async contains() { return permissionGranted; },
    async request() { permissionGranted = true; return true; },
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

  if (path === "/posts" && method === "POST") {
    const body = JSON.parse(options.body);
    const id = ++nextPost;
    const post = {
      id,
      status: body.status || "draft",
      link: `http://example.test/?p=${id}`,
      title: {rendered: body.title || ""},
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
      if ("title" in body) post.title = {rendered: body.title};
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

  const quick = await AssistantWordPress.quickTest();
  assert(quick.success, "WordPress quick test failed");
  assert(quick.logSaved === true, "WordPress quick result was not persistently logged");
  assert(permissionGranted, "host permission was not requested");

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
  const log = await AssistantWordPress.createLog({
    title: "Production log",
    content: "Completed work.",
    status: "draft",
    files: [file],
  });
  assert(log.success, "WordPress log create failed");
  assert(log.post?.id, "WordPress log receipt has no Post ID");
  assert(log.media?.[0]?.id, "WordPress log receipt has no Media ID");
  assert(log.media[0].parent === log.post.id, "media parent Post ID was not reported");

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
