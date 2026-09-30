"use strict";

(async () => {
  try {
    await browser.TaskFix.activate();
    console.info("[TaskFix] background activation completed");
  } catch (error) {
    console.error("[TaskFix] background activation failed", error);
  }
})();
