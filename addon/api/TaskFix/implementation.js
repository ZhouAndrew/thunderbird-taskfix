"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);
const MESSENGER_URL = "chrome://messenger/content/messenger.xhtml";

const scriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"]
  .getService(Ci.mozIJSSubScriptLoader);
const windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"]
  .getService(Ci.nsIWindowMediator);
const observerService = Cc["@mozilla.org/observer-service;1"]
  .getService(Ci.nsIObserverService);

this.TaskFix = class extends ExtensionCommon.ExtensionAPI {
  _activated = false;
  _inject = null;

  _isMessengerWindow(window) {
    if (!window || window.closed) {
      return false;
    }
    const href = window.location?.href ?? "";
    const windowType =
      window.document?.documentElement?.getAttribute?.("windowtype") ?? "";
    return href.startsWith(MESSENGER_URL) || windowType === "mail:3pane";
  }

  _activate() {
    const extension = this.extension;
    const scriptURL = extension.rootURI.resolve("content/taskfix-window.js");

    if (!this._inject) {
      this._inject = window => {
        if (!this._isMessengerWindow(window)) {
          return;
        }
        try {
          scriptLoader.loadSubScript(scriptURL, window, "UTF-8");
        } catch (error) {
          console.error("[TaskFix] Failed to inject task window integration", error);
        }
      };
    }

    if (!this._activated) {
      ExtensionSupport.registerWindowListener(extension.id, {
        chromeURLs: [MESSENGER_URL],
        onLoadWindow: window => this._inject(window),
      });
      this._activated = true;
    }

    for (const window of windowMediator.getEnumerator(null)) {
      this._inject(window);
    }
  }

  onStartup() {
    try {
      this._activate();
    } catch (error) {
      console.error("[TaskFix] startup activation failed", error);
    }
  }

  onShutdown(isAppShutdown) {
    if (this._activated) {
      try {
        ExtensionSupport.unregisterWindowListener(this.extension.id);
      } catch (error) {
        console.error("[TaskFix] Failed to unregister window listener", error);
      }
    }

    for (const window of windowMediator.getEnumerator(null)) {
      try {
        window.__taskfixAddonCleanup?.();
      } catch (error) {
        console.error("[TaskFix] Failed to clean up a window", error);
      }
    }

    this._activated = false;
    this._inject = null;

    if (!isAppShutdown) {
      observerService.notifyObservers(null, "startupcache-invalidate");
    }
  }

  getAPI() {
    return {
      TaskFix: {
        activate: () => {
          this._activate();
        },
      },
    };
  }
};
