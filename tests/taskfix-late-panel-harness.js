"use strict";

const fs = require("fs");
const vm = require("vm");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

class XulNode {
  constructor(name, id = null) {
    this.localName = name;
    this._id = id;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.parentNode = null;
    this.hidden = false;
    this.collapsed = false;
    this.classList = { contains: () => false };
  }
  get id() { return this._id; }
  set id(v) { this._id = v; if (v) elements.set(v, this); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  hasAttribute(k) { return this.attributes.has(k); }
  toggleAttribute(k, force) {
    if (force === false) this.attributes.delete(k);
    else this.attributes.set(k, "");
  }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, before) {
    n.parentNode = this;
    const i = this.children.indexOf(before);
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  replaceChildren(...nodes) {
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }
  addEventListener() {}
  removeEventListener() {}
  querySelectorAll() { return []; }
  closest() { return null; }
  getBoundingClientRect() { return {width: 100, height: 100}; }
}

const elements = new Map();
global.document = {
  activeElement: null,
  documentElement: {},
  getElementById(id) { return elements.get(id) ?? null; },
  createXULElement(name) { return new XulNode(name); },
  querySelector() { return null; },
};

let observerCallback = null;
let observerDisconnected = false;
global.MutationObserver = class {
  constructor(cb) { observerCallback = cb; }
  observe() {}
  disconnect() { observerDisconnected = true; }
};

let retryFn = null;
global.setInterval = fn => { retryFn = fn; return 1; };
global.clearInterval = () => { retryFn = null; };

global.Ci = {calITodo: Symbol("calITodo")};
global.cal = {
  category: {fromPrefs: () => []},
  view: {formatStringForCSSRule: x => x},
};
global.gTabmail = null;
global.editToDoStatus = () => {};
global.editConfigState = () => {};
global.startBatchTransaction = () => {};
global.endBatchTransaction = () => {};
global.doTransaction = () => {};
global.goUpdateCommand = () => {};
global.goDoCommand = () => {};

const originalProgress = function originalProgress() {};
const originalPriority = function originalPriority() {};
global.contextChangeTaskProgress = originalProgress;
global.contextChangeTaskPriority = originalPriority;

global.taskDetailsView = {
  loadCategories() {},
  saveCategories() {},
  categoryTextboxKeypress() {},
};

const code = fs.readFileSync("addon/content/taskfix-window.js", "utf8");
vm.runInThisContext(code, {filename: "taskfix-window.js"});

assert(global.contextChangeTaskProgress === originalProgress,
  "TaskFix must not install before the lazily-created Tasks toolbar exists");
assert(typeof observerCallback === "function",
  "TaskFix must keep a MutationObserver when Tasks is not open at startup");
assert(typeof retryFn === "function",
  "TaskFix may keep its short fast-path retry while waiting");

const toolbar = new XulNode("hbox");
toolbar.id = "task-actions-toolbar";
const completed = new XulNode("toolbarbutton");
completed.id = "task-actions-markcompleted";
toolbar.appendChild(completed);

const tree = new XulNode("tree");
tree.id = "calendar-task-tree";
tree.classList = {contains: name => name === "calendar-task-tree"};
tree.selectedTasks = [];

observerCallback();

assert(global.contextChangeTaskProgress !== originalProgress,
  "TaskFix must install when the Tasks panel is created later");
assert(global.contextChangeTaskPriority !== originalPriority,
  "Priority multi-select handler must install after delayed panel creation");
assert(elements.has("task-actions-status"),
  "Status toolbar button must appear after delayed Tasks-panel creation");
assert(observerDisconnected,
  "readiness observer must disconnect after successful installation");
assert(retryFn === null,
  "fast-path retry timer must stop after delayed installation succeeds");

global.__taskfixAddonCleanup();
console.log("taskfix-late-panel-harness: PASS");
