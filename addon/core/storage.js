"use strict";

(() => {
  const KEY_SETTINGS = "caldavAssistant.settings";
  const KEY_RUNTIME = "caldavAssistant.runtime";
  const KEY_AUDIT = "caldavAssistant.audit";
  const KEY_RECEIPT = "caldavAssistant.lastReceipt";
  const MAX_AUDIT_RECORDS = 1000;

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix = "audit") {
    if (globalThis.crypto?.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function getValue(key, fallback) {
    const values = await browser.storage.local.get(key);
    return values[key] === undefined ? fallback : values[key];
  }

  async function setValue(key, value) {
    await browser.storage.local.set({[key]: value});
    return value;
  }

  async function getSettings() {
    return getValue(KEY_SETTINGS, {});
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const next = {...current, ...(patch || {})};
    return setValue(KEY_SETTINGS, next);
  }

  async function getRuntime() {
    return getValue(KEY_RUNTIME, {
      state: "idle",
      currentTask: null,
      currentWorkEvent: null,
      segmentStartedAtMs: null,
      accumulatedMs: 0,
    });
  }

  async function setRuntime(runtime) {
    return setValue(KEY_RUNTIME, runtime);
  }

  async function clearRuntime() {
    return setRuntime({
      state: "idle",
      currentTask: null,
      currentWorkEvent: null,
      segmentStartedAtMs: null,
      accumulatedMs: 0,
    });
  }

  async function appendAudit(entry) {
    const record = {
      id: entry?.id || makeId(),
      timestamp: entry?.timestamp || nowIso(),
      scope: String(entry?.scope || "system"),
      action: String(entry?.action || "unknown"),
      success: entry?.success !== false,
      summary: String(entry?.summary || ""),
      details: entry?.details ?? null,
    };
    const records = await getValue(KEY_AUDIT, []);
    const next = Array.isArray(records) ? [...records, record] : [record];
    if (next.length > MAX_AUDIT_RECORDS) {
      next.splice(0, next.length - MAX_AUDIT_RECORDS);
    }
    await setValue(KEY_AUDIT, next);
    return record;
  }

  async function listAudit() {
    const records = await getValue(KEY_AUDIT, []);
    return Array.isArray(records) ? records : [];
  }

  async function clearAudit() {
    await setValue(KEY_AUDIT, []);
  }

  async function saveLastReceipt(receipt) {
    await setValue(KEY_RECEIPT, receipt);
    return receipt;
  }

  async function getLastReceipt() {
    return getValue(KEY_RECEIPT, null);
  }

  globalThis.AssistantStorage = Object.freeze({
    getSettings,
    saveSettings,
    getRuntime,
    setRuntime,
    clearRuntime,
    appendAudit,
    listAudit,
    clearAudit,
    saveLastReceipt,
    getLastReceipt,
  });
})();
