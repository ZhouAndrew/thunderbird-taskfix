"use strict";

(() => {
  function errorText(error) {
    return String(error?.message || error || "Unknown error");
  }

  function trimSlash(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function normalizeConfig(config) {
    return {
      baseUrl: trimSlash(config?.baseUrl),
      username: String(config?.username || "").trim(),
      applicationPassword: String(config?.applicationPassword || "").trim(),
    };
  }

  async function getConfig() {
    const settings = await AssistantStorage.getSettings();
    return normalizeConfig(settings.wordpress || {});
  }

  async function saveConfig(config) {
    const normalized = normalizeConfig(config);
    await AssistantStorage.saveSettings({wordpress: normalized});
    return normalized;
  }

  function permissionOrigin(baseUrl) {
    const normalized = trimSlash(baseUrl);
    if (!normalized) throw new Error("WordPress URL is not configured.");
    let parsed;
    try {
      parsed = new URL(normalized);
    } catch (_error) {
      throw new Error("WordPress URL is invalid.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("WordPress URL must use http:// or https://.");
    }
    return parsed.origin + "/*";
  }

  function basicAuth(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = "";
    for (const value of bytes) binary += String.fromCharCode(value);
    return "Basic " + btoa(binary);
  }

  async function request(path, options = {}) {
    const config = await getConfig();
    if (!config.baseUrl || !config.username || !config.applicationPassword) {
      throw new Error("WordPress connection is not configured.");
    }
    const url = config.baseUrl + "/wp-json/wp/v2" + path;
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", basicAuth(config.username, config.applicationPassword));
    if (options.json !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body:
        options.json !== undefined
          ? JSON.stringify(options.json)
          : options.body,
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = text;
      }
    }
    if (!response.ok) {
      throw new Error(
        `WordPress HTTP ${response.status}: ${typeof data === "string" ? data : data?.message || response.statusText}`
      );
    }
    return data;
  }

  async function ensurePermission() {
    const config = await getConfig();
    const origin = permissionOrigin(config.baseUrl);
    return browser.permissions.contains({origins: [origin]});
  }

  async function quickTest() {
    const result = {
      action: "connection.wordpress-quick",
      success: false,
      startedAt: new Date().toISOString(),
      steps: [],
      summary: "",
    };
    try {
      const permitted = await ensurePermission();
      if (!permitted) throw new Error("WordPress host permission was not granted.");
      const started = performance.now();
      const user = await request("/users/me?context=edit");
      result.steps.push({
        name: "authenticate + read users/me",
        success: true,
        latencyMs: Math.round(performance.now() - started),
        userId: user?.id,
        userName: user?.name,
      });
      result.success = true;
      result.summary = `WordPress authenticated as ${user?.name || user?.slug || "user"}.`;
    } catch (error) {
      result.summary = `WordPress quick test failed: ${errorText(error)}`;
      result.steps.push({name: "WordPress read", success: false, error: errorText(error)});
    }
    result.completedAt = new Date().toISOString();
    return AssistantStorage.persistResult(result, "connection");
  }

  function pngBlob() {
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], {type: "image/png"});
  }

  async function uploadMedia(blob, filename, parent = 0) {
    const media = await request("/media", {
      method: "POST",
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    });
    if (parent && media?.id) {
      return request(`/media/${media.id}`, {
        method: "POST",
        json: {post: parent},
      });
    }
    return media;
  }

  async function fullWriteTest() {
    const result = {
      action: "connection.wordpress-full-write",
      success: false,
      startedAt: new Date().toISOString(),
      steps: [],
      summary: "",
      postId: null,
      mediaId: null,
    };
    let postId = null;
    let mediaId = null;
    try {
      const permitted = await ensurePermission();
      if (!permitted) throw new Error("WordPress host permission was not granted.");
      const marker = `CALDAV-ASSISTANT-TEST-${Date.now()}`;
      const post = await request("/posts", {
        method: "POST",
        json: {
          title: marker,
          content: "Temporary CalDAV Assistant connector test.",
          status: "draft",
        },
      });
      postId = post.id;
      result.postId = postId;
      result.steps.push({name: "create TEST draft post", success: true, postId});

      const read = await request(`/posts/${postId}?context=edit`);
      if (read?.id !== postId) throw new Error("WordPress post read-back failed.");
      result.steps.push({name: "read TEST post", success: true, postId});

      const updated = await request(`/posts/${postId}`, {
        method: "POST",
        json: {content: "Temporary CalDAV Assistant connector test. UPDATED."},
      });
      if (updated?.id !== postId) throw new Error("WordPress post update failed.");
      const reread = await request(`/posts/${postId}?context=edit`);
      const rawContent = reread?.content?.raw || reread?.content?.rendered || "";
      if (!String(rawContent).includes("UPDATED")) {
        throw new Error("WordPress post update read-back mismatch.");
      }
      result.steps.push({name: "update + read-back TEST post", success: true, postId});

      const media = await uploadMedia(
        pngBlob(),
        "caldav-assistant-connector-test.png",
        postId
      );
      mediaId = media.id;
      result.mediaId = mediaId;
      result.steps.push({name: "upload TEST media", success: true, mediaId});

      const mediaRead = await request(`/media/${mediaId}?context=edit`);
      if (mediaRead?.id !== mediaId) throw new Error("WordPress media read-back failed.");
      result.steps.push({name: "read TEST media", success: true, mediaId});

      await request(`/media/${mediaId}?force=true`, {method: "DELETE"});
      mediaId = null;
      result.steps.push({name: "delete TEST media", success: true});

      await request(`/posts/${postId}?force=true`, {method: "DELETE"});
      postId = null;
      result.steps.push({name: "delete TEST post", success: true});

      result.success = true;
      result.summary = "WordPress read/write/update/media/delete verification passed.";
    } catch (error) {
      result.summary = `WordPress full write test failed: ${errorText(error)}`;
      result.steps.push({name: "failure", success: false, error: errorText(error)});
    } finally {
      if (mediaId) {
        try {
          await request(`/media/${mediaId}?force=true`, {method: "DELETE"});
          result.steps.push({name: "cleanup TEST media", success: true, mediaId});
        } catch (error) {
          result.steps.push({name: "cleanup TEST media", success: false, error: errorText(error)});
        }
      }
      if (postId) {
        try {
          await request(`/posts/${postId}?force=true`, {method: "DELETE"});
          result.steps.push({name: "cleanup TEST post", success: true, postId});
        } catch (error) {
          result.steps.push({name: "cleanup TEST post", success: false, error: errorText(error)});
        }
      }
    }

    result.completedAt = new Date().toISOString();
    return AssistantStorage.persistResult(result, "connection");
  }

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const WEEKDAY_NAMES = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ];

  function dailyLogTitle(date = new Date()) {
    // Keep the same human title shape as the existing wp-cli helper:
    // "October 1  Thursday  2026".
    return (
      MONTH_NAMES[date.getMonth()] + " " +
      date.getDate() + "  " +
      WEEKDAY_NAMES[date.getDay()] + "  " +
      date.getFullYear()
    );
  }

  function dailyLogSearchText(date = new Date()) {
    // A short month token lets the REST search find both "October" and "Oct"
    // titles. The exact day/weekday/year check is done locally below.
    return MONTH_NAMES[date.getMonth()].slice(0, 3);
  }

  function matchesDailyLogTitle(title, date = new Date()) {
    const text = String(title || "").toLocaleLowerCase();
    const month = MONTH_NAMES[date.getMonth()].toLocaleLowerCase();
    const monthAbbr = month.slice(0, 3);
    const weekday = WEEKDAY_NAMES[date.getDay()].toLocaleLowerCase();
    const year = String(date.getFullYear());
    const day = String(date.getDate());
    const dayPattern = new RegExp("(^|[^0-9])" + day + "([^0-9]|$)");
    return (
      (text.includes(month) || text.includes(monthAbbr)) &&
      dayPattern.test(text) &&
      text.includes(year) &&
      text.includes(weekday)
    );
  }

  function rawTitle(post) {
    return String(post?.title?.raw || post?.title?.rendered || "").trim();
  }

  function rawContent(post) {
    return String(post?.content?.raw || post?.content?.rendered || "");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function logMarker() {
    if (globalThis.crypto?.randomUUID) {
      return "caldav-assistant-log-" + crypto.randomUUID();
    }
    return "caldav-assistant-log-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  async function findDailyLogPost(date = new Date()) {
    const posts = await request(
      "/posts?context=edit&per_page=100&search=" +
      encodeURIComponent(dailyLogSearchText(date))
    );
    return (Array.isArray(posts) ? posts : [])
      .find(post => matchesDailyLogTitle(rawTitle(post), date)) || null;
  }

  async function ensureDailyLogPost(date = new Date()) {
    const title = dailyLogTitle(date);
    let post = await findDailyLogPost(date);
    if (post) return {post, title, created: false};

    post = await request("/posts", {
      method: "POST",
      json: {
        title,
        content: "",
        status: "publish",
      },
    });

    const read = await request(`/posts/${post.id}?context=edit`);
    if (read?.id !== post.id || !matchesDailyLogTitle(rawTitle(read), date)) {
      throw new Error("WordPress daily log create read-back mismatch.");
    }
    return {post: read, title, created: true};
  }

  function currentTimeText(date = new Date()) {
    return (
      String(date.getHours()).padStart(2, "0") + ":" +
      String(date.getMinutes()).padStart(2, "0")
    );
  }

  function mediaBlock(item) {
    const id = Number(item.id || 0);
    const url = escapeHtml(item.sourceUrl || "");
    const filename = escapeHtml(item.filename || "附件");
    const mime = String(item.mimeType || "").toLocaleLowerCase();

    if (mime.startsWith("image/")) {
      return (
        '<!-- wp:image {"id":' + id + ',"sizeSlug":"large"} -->\n' +
        '<figure class="wp-block-image size-large"><img src="' + url +
        '" alt="' + filename + '" class="wp-image-' + id + '"/></figure>\n' +
        '<!-- /wp:image -->'
      );
    }
    if (mime.startsWith("video/")) {
      return (
        '<!-- wp:video {"id":' + id + '} -->\n' +
        '<figure class="wp-block-video"><video controls src="' + url +
        '"></video></figure>\n<!-- /wp:video -->'
      );
    }
    if (mime.startsWith("audio/")) {
      return (
        '<!-- wp:audio {"id":' + id + '} -->\n' +
        '<figure class="wp-block-audio"><audio controls src="' + url +
        '"></audio></figure>\n<!-- /wp:audio -->'
      );
    }
    return (
      '<!-- wp:file {"id":' + id + ',"href":"' + url + '"} -->\n' +
      '<div class="wp-block-file"><a href="' + url + '">' + filename +
      '</a></div>\n<!-- /wp:file -->'
    );
  }

  function buildLogAppend(content, media, marker, date = new Date()) {
    const blocks = [`<!-- ${marker} -->`];
    const text = String(content || "").trim();
    if (text) {
      blocks.push(
        "<!-- wp:paragraph -->\n<p>" +
        currentTimeText(date) + " " +
        escapeHtml(text).replace(/\n/g, "<br>") +
        "</p>\n<!-- /wp:paragraph -->"
      );
    }
    for (const item of media || []) {
      blocks.push(mediaBlock(item));
    }
    return blocks.join("\n");
  }

  async function createLog({content, files = []}) {
    const result = {
      action: "wordpress.append-log",
      success: false,
      startedAt: new Date().toISOString(),
      steps: [],
      summary: "",
      post: null,
      media: [],
    };
    try {
      const text = String(content || "").trim();
      if (!text && !(files || []).length) {
        throw new Error("日志内容或附件不能为空。");
      }

      const permitted = await ensurePermission();
      if (!permitted) throw new Error("WordPress host permission was not granted.");

      const daily = await ensureDailyLogPost();
      const postId = daily.post.id;
      result.post = {
        id: postId,
        title: daily.title,
        status: daily.post.status || "publish",
        link: daily.post.link || "",
        createdToday: daily.created,
      };
      result.steps.push({
        name: daily.created ? "create daily WordPress log post" : "reuse daily WordPress log post",
        success: true,
        postId,
        title: daily.title,
      });

      for (const file of files || []) {
        const uploaded = await uploadMedia(file, file.name || "attachment", postId);
        const item = {
          id: uploaded.id,
          filename: file.name || "attachment",
          sourceUrl: uploaded.source_url || "",
          mimeType: file.type || uploaded.mime_type || "application/octet-stream",
          parent: postId,
        };
        result.media.push(item);
        result.steps.push({
          name: "upload WordPress media",
          success: true,
          mediaId: item.id,
          filename: item.filename,
          parentPostId: postId,
        });
      }

      const before = await request(`/posts/${postId}?context=edit`);
      const marker = logMarker();
      const append = buildLogAppend(text, result.media, marker);
      const previous = rawContent(before);
      const next = previous
        ? previous.replace(/\s+$/, "") + "\n\n" + append
        : append;

      await request(`/posts/${postId}`, {
        method: "POST",
        json: {content: next},
      });

      const read = await request(`/posts/${postId}?context=edit`);
      const verified = rawContent(read);
      if (!verified.includes(marker)) {
        throw new Error("WordPress log append read-back mismatch.");
      }

      result.steps.push({
        name: "append + read-back daily WordPress log",
        success: true,
        postId,
        marker,
      });
      result.success = true;
      result.summary = `已追加到今天的 WordPress 日志（Post ${postId}）。`;
    } catch (error) {
      result.summary = `WordPress log append failed: ${errorText(error)}`;
      result.steps.push({name: "failure", success: false, error: errorText(error)});
    }

    result.completedAt = new Date().toISOString();
    return AssistantStorage.persistResult(result, "wordpress");
  }

  globalThis.AssistantWordPress = Object.freeze({
    getConfig,
    saveConfig,
    ensurePermission,
    quickTest,
    fullWriteTest,
    createLog,
  });
})();
