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
    if (!config.baseUrl) throw new Error("WordPress URL is not configured.");
    const origin = new URL(config.baseUrl).origin + "/*";
    const has = await browser.permissions.contains({origins: [origin]});
    if (has) return true;
    return browser.permissions.request({origins: [origin]});
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
    await AssistantStorage.saveLastReceipt(result);
    await AssistantStorage.appendAudit({
      scope: "connection",
      action: result.action,
      success: result.success,
      summary: result.summary,
      details: result,
    });
    return result;
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
    await AssistantStorage.saveLastReceipt(result);
    await AssistantStorage.appendAudit({
      scope: "connection",
      action: result.action,
      success: result.success,
      summary: result.summary,
      details: result,
    });
    return result;
  }

  async function createLog({title, content, status = "draft", files = []}) {
    const result = {
      action: "wordpress.create-log",
      success: false,
      startedAt: new Date().toISOString(),
      steps: [],
      summary: "",
      post: null,
      media: [],
    };
    try {
      const permitted = await ensurePermission();
      if (!permitted) throw new Error("WordPress host permission was not granted.");
      const post = await request("/posts", {
        method: "POST",
        json: {
          title: String(title || "").trim(),
          content: String(content || ""),
          status,
        },
      });
      result.post = {
        id: post.id,
        title: post?.title?.rendered || title,
        status: post.status,
        link: post.link,
      };
      result.steps.push({
        name: "create WordPress post",
        success: true,
        postId: post.id,
        status: post.status,
        link: post.link,
      });

      for (const file of files || []) {
        const media = await uploadMedia(file, file.name || "attachment", post.id);
        result.media.push({
          id: media.id,
          filename: file.name,
          sourceUrl: media.source_url,
          parent: post.id,
        });
        result.steps.push({
          name: "upload WordPress media",
          success: true,
          mediaId: media.id,
          filename: file.name,
          parentPostId: post.id,
        });
      }

      const read = await request(`/posts/${post.id}?context=edit`);
      if (read?.id !== post.id) throw new Error("WordPress post read-back failed.");
      result.steps.push({
        name: "read-back WordPress post",
        success: true,
        postId: read.id,
        status: read.status,
      });

      result.success = true;
      result.summary = `WordPress post ${post.id} was created and verified.`;
    } catch (error) {
      result.summary = `WordPress log failed: ${errorText(error)}`;
      result.steps.push({name: "failure", success: false, error: errorText(error)});
    }

    result.completedAt = new Date().toISOString();
    await AssistantStorage.saveLastReceipt(result);
    await AssistantStorage.appendAudit({
      scope: "wordpress",
      action: result.action,
      success: result.success,
      summary: result.summary,
      details: result,
    });
    return result;
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
