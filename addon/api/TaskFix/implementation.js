"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);
var { Services } = ChromeUtils.importESModule(
  "resource://gre/modules/Services.sys.mjs"
);

const MESSENGER_URL = "chrome://messenger/content/messenger.xhtml";

this.TaskFix = class extends ExtensionCommon.ExtensionAPI {
  onStartup() {
    const extension = this.extension;
    const scriptURL = extension.rootURI.resolve("content/taskfix-window.js");
    const inject = window => {
      if (!window || window.closed || window.location?.href !== MESSENGER_URL) {
        return;
      }
      try {
        Services.scriptloader.loadSubScript(scriptURL, window, "UTF-8");
      } catch (error) {
        console.error("[TaskFix Lab] Failed to inject task window patch", error);
      }
    };

    ExtensionSupport.registerWindowListener(extension.id, {
      chromeURLs: [MESSENGER_URL],
      onLoadWindow(window) {
        inject(window);
      },
    });

    for (const window of Services.wm.getEnumerator(null)) {
      inject(window);
    }
  }

  onShutdown(isAppShutdown) {
    try {
      ExtensionSupport.unregisterWindowListener(this.extension.id);
    } catch (error) {
      console.error("[TaskFix Lab] Failed to unregister window listener", error);
    }
    for (const window of Services.wm.getEnumerator(null)) {
      try {
        window.__taskfixAddonCleanup?.();
      } catch (error) {
        console.error("[TaskFix Lab] Failed to clean up a window", error);
      }
    }
    if (!isAppShutdown) {
      Services.obs.notifyObservers(null, "startupcache-invalidate");
    }
  }

  getAPI() {
    return { TaskFix: {} };
  }
};
