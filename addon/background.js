"use strict";

const SPACE_NAME = "thunderbird_caldav_lab";

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
  await activateTaskEnhancements();
  await ensureWorkspace();
}

browser.runtime.onInstalled.addListener(() => startup().catch(console.error));
browser.runtime.onStartup.addListener(() => startup().catch(console.error));
startup().catch(error => console.error("[ThunderbirdCalDAV] startup failed", error));
