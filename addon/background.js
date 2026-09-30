"use strict";

const SPACE_NAME = "thunderbird_caldav_lab";

async function diagnostic(event, details = {}) {
  try {
    await browser.ThunderbirdCalDAV.writeDiagnostic(
      "background",
      event,
      details
    );
  } catch (error) {
    console.warn("[ThunderbirdCalDAV] diagnostics unavailable", error);
  }
}

async function activateTaskEnhancements() {
  await browser.TaskFix.activate();
}

async function ensureWorkspace() {
  if (!browser.spaces) {
    console.warn("[ThunderbirdCalDAV] spaces API is unavailable");
    return null;
  }
  const existing = await browser.spaces.query({
    isSelfOwned: true,
    name: SPACE_NAME,
  });
  if (existing.length) return existing[0];

  return browser.spaces.create(
    SPACE_NAME,
    "workspace.html",
    {title: "Thunderbird CalDAV"}
  );
}

async function startup() {
  const manifest = browser.runtime.getManifest();
  await diagnostic("startup.begin", {version: manifest.version});
  try {
    await activateTaskEnhancements();
    const space = await ensureWorkspace();
    await diagnostic("startup.success", {
      version: manifest.version,
      spaceId: space?.id ?? null,
    });
  } catch (error) {
    await diagnostic("startup.error", {
      version: manifest.version,
      name: error?.name || "Error",
      message: error?.message || String(error),
    });
    throw error;
  }
}

browser.runtime.onInstalled.addListener(() => startup().catch(console.error));
browser.runtime.onStartup.addListener(() => startup().catch(console.error));
startup().catch(error => console.error("[ThunderbirdCalDAV] startup failed", error));
