/* Thunderbird TaskFix 0.3.3 — standalone Thunderbird enhancement */
(() => {
  const win = globalThis;
  const MARKER = "THUNDERBIRD_TASKFIX_ADDON_V3_3";
  if (win.__taskfixAddonState?.marker === MARKER) return;

  try { win.__taskfixAddonCleanup?.(); } catch (e) {
    console.warn("[TaskFix] Previous cleanup failed", e);
  }

  const state = {
    marker: MARKER,
    installed: false,
    retryTimer: null,
    readyObserver: null,
    originals: {},
    contextTree: null,
    contextPopup: null,
    contextPopupShowing: null,
    contextPopupHiding: null,
    keydownHandler: null,
  };
  win.__taskfixAddonState = state;

  function treeTasks(tree) {
    if (!tree) return [];
    try { return Array.from(tree.selectedTasks ?? []).filter(Boolean); }
    catch (e) {
      console.warn("[TaskFix] Could not read selectedTasks", e);
      return [];
    }
  }

  function isTreeVisible(tree) {
    if (!tree || tree.hidden || tree.collapsed) return false;
    try {
      const r = tree.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch { return true; }
  }

  function getTaskFixSelectedTasks() {
    const trees = [
      document.getElementById("calendar-task-tree"),
      document.getElementById("unifinder-todo-tree"),
    ].filter(Boolean);

    if (state.contextTree) {
      const tasks = treeTasks(state.contextTree);
      if (tasks.length) return tasks;
    }

    const active = document.activeElement;
    const focusedTree = active?.classList?.contains("calendar-task-tree")
      ? active
      : active?.closest?.(".calendar-task-tree");
    if (focusedTree) {
      const tasks = treeTasks(focusedTree);
      if (tasks.length) return tasks;
    }

    const selections = trees.map(tree => ({tree, tasks: treeTasks(tree)}));
    const multi = selections.find(x => x.tasks.length > 1);
    if (multi) return multi.tasks;

    const visible = selections.find(x => x.tasks.length && isTreeVisible(x.tree));
    if (visible) return visible.tasks;

    const any = selections.find(x => x.tasks.length);
    if (any) return any.tasks;

    try {
      return typeof getSelectedTasks === "function"
        ? Array.from(getSelectedTasks() ?? []).filter(Boolean)
        : [];
    } catch { return []; }
  }

  function ready() {
    return typeof startBatchTransaction === "function" &&
      typeof endBatchTransaction === "function" &&
      typeof doTransaction === "function" &&
      win.taskDetailsView &&
      document.getElementById("task-actions-toolbar") &&
      document.getElementById("task-actions-markcompleted");
  }

  function refreshUndoRedoCommands() {
    try {
      if (typeof updateUndoRedoMenu === "function") {
        updateUndoRedoMenu();
        return;
      }
      if (typeof goUpdateCommand === "function") {
        goUpdateCommand("cmd_undo");
        goUpdateCommand("cmd_redo");
      }
    } catch (error) {
      console.warn("[TaskFix] Could not refresh calendar Undo/Redo commands", error);
    }
  }

  function taskfixUndo() {
    if (typeof canUndo === "function" && !canUndo()) return false;
    if (typeof undo !== "function") return false;
    // IMPORTANT: Thunderbird calendar/task edits use CalTransactionManager.
    // goDoCommand("cmd_undo") may resolve to the mail/editor undo stack instead.
    undo();
    refreshUndoRedoCommands();
    return true;
  }

  function taskfixRedo() {
    if (typeof canRedo === "function" && !canRedo()) return false;
    if (typeof redo !== "function") return false;
    redo();
    refreshUndoRedoCommands();
    return true;
  }

  function isEditableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const name = String(target.localName || target.tagName || "").toLowerCase();
    if (name === "input" || name === "textarea") return true;
    try {
      return Boolean(target.closest?.("input, textarea, [contenteditable='true'], [contenteditable='']"));
    } catch {
      return false;
    }
  }

  function taskUiIsActive() {
    try {
      if (win.calendarController?.isInMode?.("task")) {
        return true;
      }
    } catch {}

    try {
      const tabmail = document.getElementById("tabmail");
      const tasksMode = tabmail?.tabModes?.tasks;
      if (tasksMode?.tabs?.includes?.(tabmail.selectedTab)) {
        return true;
      }
    } catch {}

    const trees = [
      document.getElementById("calendar-task-tree"),
      document.getElementById("unifinder-todo-tree"),
    ].filter(Boolean);
    return trees.some(isTreeVisible);
  }

  function installUndoShortcutBridge() {
    if (state.keydownHandler || typeof win.addEventListener !== "function") return;

    state.keydownHandler = event => {
      if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      if (String(event.key).toLowerCase() !== "z") return;
      if (!taskUiIsActive() || isEditableTarget(event.target)) return;

      const handled = event.shiftKey ? taskfixRedo() : taskfixUndo();
      if (!handled) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    win.addEventListener("keydown", state.keydownHandler, true);
  }

  function taskfixModifySelectedTasks(mutator) {
    const tasks = getTaskFixSelectedTasks();
    if (!tasks.length) return 0;

    startBatchTransaction();
    try {
      const recurringGroups = new Map();
      const standaloneTasks = [];

      for (const task of tasks) {
        const parent = task.parentItem;
        if (task.recurrenceId && parent?.recurrenceInfo) {
          const key = `${task.calendar?.id ?? ""}\u0000${parent.id}`;
          let group = recurringGroups.get(key);
          if (!group) {
            group = {parent, tasks: []};
            recurringGroups.set(key, group);
          }
          group.tasks.push(task);
        } else {
          standaloneTasks.push(task);
        }
      }

      for (const task of standaloneTasks) {
        const newTask = task.clone().QueryInterface(Ci.calITodo);
        mutator(newTask, task);
        doTransaction("modify", newTask, newTask.calendar, task, null);
      }

      for (const {parent: oldParent, tasks: occurrences} of recurringGroups.values()) {
        const newParent = oldParent.clone().QueryInterface(Ci.calITodo);
        const recurrenceInfo = newParent.recurrenceInfo;
        for (const task of occurrences) {
          const newOccurrence = recurrenceInfo
            .getOccurrenceFor(task.recurrenceId)
            .QueryInterface(Ci.calITodo);
          mutator(newOccurrence, task);
          recurrenceInfo.modifyException(newOccurrence, true);
        }
        doTransaction("modify", newParent, newParent.calendar, oldParent, null);
      }
    } finally {
      endBatchTransaction();
      refreshUndoRedoCommands();
    }
    return tasks.length;
  }

  function patchedProgress(progress) {
    if (gTabmail && gTabmail.currentTabInfo.mode.type == "calendarTask") {
      editToDoStatus(progress);
      return;
    }
    taskfixModifySelectedTasks(newTask => {
      newTask.percentComplete = progress;
      switch (progress) {
        case 0:
          newTask.isCompleted = false;
          break;
        case 100:
          newTask.isCompleted = true;
          break;
        default:
          newTask.status = "IN-PROCESS";
          newTask.completedDate = null;
      }
    });
  }

  function patchedPriority(priority) {
    const tabType = gTabmail && gTabmail.currentTabInfo.mode.type;
    if (tabType == "calendarTask" || tabType == "calendarEvent") {
      editConfigState({priority});
      return;
    }
    taskfixModifySelectedTasks(newTask => {
      newTask.priority = priority;
    });
  }

  function changeStatus(status) {
    const allowed = new Set([null, "NEEDS-ACTION", "IN-PROCESS", "COMPLETED", "CANCELLED"]);
    if (!allowed.has(status)) throw new Error(`Unsupported VTODO status: ${status}`);

    taskfixModifySelectedTasks(newTask => {
      const previousPercent = newTask.percentComplete;
      if (status === "COMPLETED") {
        newTask.isCompleted = true;
        return;
      }

      newTask.isCompleted = false;
      newTask.completedDate = null;

      if (status === null) {
        newTask.deleteProperty("STATUS");
        newTask.percentComplete = 0;
        return;
      }

      newTask.status = status;
      if (status === "NEEDS-ACTION") {
        newTask.percentComplete = 0;
      } else if (status === "IN-PROCESS") {
        newTask.percentComplete =
          previousPercent > 0 && previousPercent < 100 ? previousPercent : 0;
      }
    });
  }

  const STATUS_ITEMS = [
    ["Not specified", null],
    [null, "__sep__"],
    ["Needs Action", "NEEDS-ACTION"],
    ["In Progress", "IN-PROCESS"],
    ["Completed", "COMPLETED"],
    ["Cancelled", "CANCELLED"],
  ];

  function currentUniformStatus() {
    const tasks = getTaskFixSelectedTasks();
    if (!tasks.length) return {hasTasks: false, mixed: false, status: null};
    const values = tasks.map(task => task.getProperty("STATUS") || null);
    const first = values[0];
    return {
      hasTasks: true,
      mixed: values.some(value => value !== first),
      status: first,
    };
  }

  function fillStatusPopup(popup, prefix) {
    popup.replaceChildren();
    for (const [label, value] of STATUS_ITEMS) {
      if (value === "__sep__") {
        popup.appendChild(document.createXULElement("menuseparator"));
        continue;
      }
      const item = document.createXULElement("menuitem");
      item.id = `${prefix}-${value ?? "NONE"}`;
      item.setAttribute("label", label);
      item.setAttribute("type", "radio");
      item.setAttribute("name", prefix);
      item.dataset.taskfixStatus = value ?? "";
      item.addEventListener("command", () => changeStatus(value));
      popup.appendChild(item);
    }
    popup.addEventListener("popupshowing", () => {
      const current = currentUniformStatus();
      for (const item of popup.querySelectorAll("menuitem[data-taskfix-status]")) {
        const value = item.dataset.taskfixStatus || null;
        item.toggleAttribute("checked",
          current.hasTasks && !current.mixed && value === current.status);
      }
    });
  }

  function addToolbarStatusMenu() {
    let button = document.getElementById("task-actions-status");
    if (button) return;

    const completed = document.getElementById("task-actions-markcompleted");
    if (!completed?.parentNode) throw new Error("Task toolbar insertion point not found");

    button = document.createXULElement("toolbarbutton");
    button.id = "task-actions-status";
    button.dataset.taskfixAddon = "1";
    button.setAttribute("type", "menu");
    button.setAttribute("wantdropmarker", "true");
    button.setAttribute("tabindex", "0");
    button.setAttribute("label", "Status");
    button.setAttribute("tooltiptext", "Set status for all selected tasks");
    button.setAttribute("class", "toolbarbutton-1 message-header-view-button");

    const popup = document.createXULElement("menupopup");
    popup.id = "task-actions-status-popup";
    fillStatusPopup(popup, "taskfix-toolbar-status");
    button.appendChild(popup);
    completed.parentNode.insertBefore(button, completed);
  }

  function addContextStatusMenu() {
    const context = document.getElementById("taskitem-context-menu");
    if (!context || document.getElementById("task-context-menu-status")) return;

    const menu = document.createXULElement("menu");
    menu.id = "task-context-menu-status";
    menu.dataset.taskfixAddon = "1";
    menu.setAttribute("label", "Status");
    menu.setAttribute("tooltiptext", "Set status for all selected tasks");

    const popup = document.createXULElement("menupopup");
    popup.id = "task-context-menu-status-popup";
    fillStatusPopup(popup, "taskfix-context-status");
    menu.appendChild(popup);

    const progress = document.getElementById("task-context-menu-progress");
    context.insertBefore(menu, progress ?? document.getElementById("task-context-menu-priority"));
  }

  function installContextSelectionTracking() {
    const popup = document.getElementById("taskitem-context-menu");
    if (!popup || state.contextPopup === popup) return;

    state.contextPopup = popup;
    state.contextPopupShowing = event => {
      if (event.target !== popup) return;
      state.contextTree = popup.triggerNode?.closest?.(".calendar-task-tree") ?? null;
    };
    state.contextPopupHiding = event => {
      if (event.target === popup) state.contextTree = null;
    };
    popup.addEventListener("popupshowing", state.contextPopupShowing, true);
    popup.addEventListener("popuphiding", state.contextPopupHiding, true);
  }

  function loadCategories() {
    const popup = document.getElementById("task-actions-category-popup");
    const tasks = getTaskFixSelectedTasks();
    const fallback = document.getElementById("calendar-task-tree")?.currentTask;
    const item = tasks[0] ?? fallback;
    if (!item) return;

    const selected = tasks.length ? tasks : [item];
    const categories = [...new Set([
      ...cal.category.fromPrefs(),
      ...selected.flatMap(task => task.getCategories()),
    ])].sort(new Intl.Collator().compare);

    while (popup.childElementCount > 2) popup.lastChild.remove();
    this._taskfixCategoryChanges = new Map();

    for (const category of categories) {
      const count = selected.filter(task => task.getCategories().includes(category)).length;
      const mi = document.createXULElement("menuitem");
      mi.setAttribute("class", "calendar-category");
      mi.setAttribute("label", category);
      mi.setAttribute("value", category);
      mi.setAttribute("type", "checkbox");
      if (count === selected.length) mi.toggleAttribute("checked", true);
      else if (count > 0) mi.setAttribute("tooltiptext", "Some selected tasks have this category");
      const cssSafeId = cal.view.formatStringForCSSRule(category);
      mi.style.setProperty("--item-color", `var(--category-${cssSafeId}-color)`);
      mi.addEventListener("command", event => this.taskfixCategoryCommand(event));
      popup.appendChild(mi);
    }
  }

  function categoryCommand(event) {
    const mi = event.target;
    if (!mi?.classList?.contains("calendar-category")) return;
    this._taskfixCategoryChanges ??= new Map();
    this._taskfixCategoryChanges.set(mi.value, mi.hasAttribute("checked"));
  }

  function saveCategories() {
    const changes = this._taskfixCategoryChanges;
    this._taskfixCategoryChanges = null;
    if (!changes?.size) return true;

    taskfixModifySelectedTasks(newItem => {
      let categories = [...newItem.getCategories()];
      for (const [category, shouldHave] of changes) {
        const has = categories.includes(category);
        if (shouldHave && !has) {
          const maxCount = newItem.calendar.getProperty("capabilities.categories.maxCount");
          categories = maxCount == 1 ? [category] : [...categories, category];
        } else if (!shouldHave && has) {
          categories = categories.filter(cat => cat != category);
        }
      }
      newItem.setCategories(categories);
    });
    return false;
  }

  function categoryKeypress(event) {
    let category = event.target.value;
    const popup = document.getElementById("task-actions-category-popup");

    switch (event.key) {
      case " ": {
        const start = event.target.selectionStart;
        event.target.value = category.substring(0, start) + " " +
          category.substring(event.target.selectionEnd);
        event.target.selectionStart = event.target.selectionEnd = start + 1;
        return;
      }
      case "Tab":
      case "ArrowDown":
      case "ArrowUp": {
        event.target.blur();
        event.preventDefault();
        const key = event.key == "ArrowUp" ? "ArrowUp" : "ArrowDown";
        popup.dispatchEvent(new KeyboardEvent("keydown", {key}));
        popup.dispatchEvent(new KeyboardEvent("keyup", {key}));
        return;
      }
      case "Escape":
        if (category) event.target.value = "";
        else popup.hidePopup();
        event.preventDefault();
        return;
      case "Enter":
        category = category.trim();
        if (!category) return;
        break;
      default:
        return;
    }

    event.preventDefault();
    taskfixModifySelectedTasks(newItem => {
      const maxCount = newItem.calendar.getProperty("capabilities.categories.maxCount");
      const categories = newItem.getCategories();
      if (!categories.includes(category)) {
        newItem.setCategories(maxCount == 1 ? [category] : [...categories, category]);
      }
    });
    event.target.value = "";
    this._taskfixCategoryChanges = null;
  }

  function install() {
    if (state.installed || !ready()) return false;

    state.originals.contextChangeTaskProgress = win.contextChangeTaskProgress;
    state.originals.contextChangeTaskPriority = win.contextChangeTaskPriority;
    state.originals.loadCategories = taskDetailsView.loadCategories;
    state.originals.saveCategories = taskDetailsView.saveCategories;
    state.originals.categoryTextboxKeypress = taskDetailsView.categoryTextboxKeypress;
    state.originals.taskfixCategoryCommand = taskDetailsView.taskfixCategoryCommand;

    win.getTaskFixSelectedTasks = getTaskFixSelectedTasks;
    win.taskfixModifySelectedTasks = taskfixModifySelectedTasks;
    win.taskfixUndo = taskfixUndo;
    win.taskfixRedo = taskfixRedo;
    win.contextChangeTaskProgress = patchedProgress;
    win.contextChangeTaskPriority = patchedPriority;
    win.contextChangeTaskStatus = changeStatus;
    taskDetailsView.loadCategories = loadCategories;
    taskDetailsView.saveCategories = saveCategories;
    taskDetailsView.categoryTextboxKeypress = categoryKeypress;
    taskDetailsView.taskfixCategoryCommand = categoryCommand;

    installContextSelectionTracking();
    installUndoShortcutBridge();
    addToolbarStatusMenu();
    addContextStatusMenu();

    state.installed = true;
    console.info("[TaskFix] 0.3.3 installed");
    return true;
  }

  win.__taskfixAddonCleanup = () => {
    if (state.retryTimer !== null) clearInterval(state.retryTimer);
    state.readyObserver?.disconnect();
    state.readyObserver = null;
    if (state.keydownHandler && typeof win.removeEventListener === "function") {
      win.removeEventListener("keydown", state.keydownHandler, true);
      state.keydownHandler = null;
    }
    if (state.contextPopup) {
      if (state.contextPopupShowing)
        state.contextPopup.removeEventListener("popupshowing", state.contextPopupShowing, true);
      if (state.contextPopupHiding)
        state.contextPopup.removeEventListener("popuphiding", state.contextPopupHiding, true);
    }
    document.querySelector('#task-actions-status[data-taskfix-addon="1"]')?.remove();
    document.querySelector('#task-context-menu-status[data-taskfix-addon="1"]')?.remove();

    if (state.installed) {
      win.contextChangeTaskProgress = state.originals.contextChangeTaskProgress;
      win.contextChangeTaskPriority = state.originals.contextChangeTaskPriority;
      delete win.contextChangeTaskStatus;
      delete win.taskfixModifySelectedTasks;
      delete win.taskfixUndo;
      delete win.taskfixRedo;
      delete win.getTaskFixSelectedTasks;
      taskDetailsView.loadCategories = state.originals.loadCategories;
      taskDetailsView.saveCategories = state.originals.saveCategories;
      taskDetailsView.categoryTextboxKeypress = state.originals.categoryTextboxKeypress;
      if (state.originals.taskfixCategoryCommand === undefined)
        delete taskDetailsView.taskfixCategoryCommand;
      else
        taskDetailsView.taskfixCategoryCommand = state.originals.taskfixCategoryCommand;
    }
    delete win.__taskfixAddonState;
    delete win.__taskfixAddonCleanup;
  };

  if (!install()) {
    // Thunderbird creates the Tasks panel lazily. The old 0.3.0 build stopped
    // retrying after 15 seconds, so opening Tasks later left TaskFix inactive.
    // Keep observing the DOM until the real Tasks toolbar exists.
    if (typeof MutationObserver === "function") {
      state.readyObserver = new MutationObserver(() => {
        if (install()) {
          state.readyObserver?.disconnect();
          state.readyObserver = null;
          if (state.retryTimer !== null) {
            clearInterval(state.retryTimer);
            state.retryTimer = null;
          }
        }
      });
      state.readyObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    // Fast path for installations where the Tasks panel appears shortly after
    // startup. The observer remains the correctness path for later creation.
    let attempts = 0;
    state.retryTimer = setInterval(() => {
      attempts++;
      if (install() || attempts >= 150) {
        clearInterval(state.retryTimer);
        state.retryTimer = null;
      }
    }, 100);
  }
})();
