"use strict";

var {
  ExtensionCommon: { ExtensionAPI, EventManager },
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var {
  ExtensionUtils: { ExtensionError },
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");
var { cal } = ChromeUtils.importESModule(
  "resource:///modules/calendar/calUtils.sys.mjs"
);
var { CalTodo } = ChromeUtils.importESModule(
  "resource:///modules/CalTodo.sys.mjs"
);
var { CalEvent } = ChromeUtils.importESModule(
  "resource:///modules/CalEvent.sys.mjs"
);

const TASK_STATUSES = new Set([
  "",
  "NEEDS-ACTION",
  "IN-PROCESS",
  "COMPLETED",
  "CANCELLED",
]);

function calendarObserver(methods = {}) {
  return Object.assign(
    {
      QueryInterface: ChromeUtils.generateQI(["calIObserver"]),
      onStartBatch() {},
      onEndBatch() {},
      onLoad() {},
      onAddItem() {},
      onModifyItem() {},
      onDeleteItem() {},
      onError() {},
      onPropertyChanged() {},
      onPropertyDeleting() {},
    },
    methods
  );
}

function allCalendars() {
  return Array.from(cal.manager.getCalendars());
}

function calendarById(id) {
  const wanted = String(id || "");
  const calendar = allCalendars().find(candidate => String(candidate.id) === wanted);
  if (!calendar) {
    throw new ExtensionError(`Thunderbird calendar not found: ${wanted}`);
  }
  return calendar;
}

function calendarSupports(calendar, kind) {
  const property =
    kind === "task"
      ? "capabilities.tasks.supported"
      : "capabilities.events.supported";
  return calendar.getProperty(property) !== false;
}

function writableCalendarById(id, kind) {
  const calendar = calendarById(id);
  if (calendar.getProperty("disabled")) {
    throw new ExtensionError("Calendar is disabled");
  }
  if (calendar.readOnly) {
    throw new ExtensionError("Calendar is read-only");
  }
  if (!calendarSupports(calendar, kind)) {
    throw new ExtensionError(
      kind === "task"
        ? "Calendar does not support tasks"
        : "Calendar does not support events"
    );
  }
  return calendar;
}

function selectedCalendars(calendarId) {
  if (calendarId) {
    return [calendarById(calendarId)];
  }
  return allCalendars().filter(calendar => !calendar.getProperty("disabled"));
}

function calendarView(calendar) {
  return {
    id: String(calendar.id || ""),
    name: String(calendar.name || ""),
    type: String(calendar.type || ""),
    readOnly: Boolean(calendar.readOnly),
    disabled: Boolean(calendar.getProperty("disabled")),
    supportsTasks: calendarSupports(calendar, "task"),
    supportsEvents: calendarSupports(calendar, "event"),
  };
}

function categoriesOf(item) {
  try {
    return Array.from(item.getCategories() || [], value => String(value));
  } catch (_error) {
    return [];
  }
}

function dateView(value) {
  if (!value) return null;
  return {
    icalString: String(value.icalString || ""),
    isDate: Boolean(value.isDate),
    timezone: String(value.timezone?.tzid || ""),
  };
}

function taskView(item) {
  const status = String(
    item.getProperty("STATUS") || item.status || ""
  ).toUpperCase();
  return {
    id: String(item.id || ""),
    calendarId: String(
      item.calendar?.superCalendar?.id || item.calendar?.id || ""
    ),
    calendarName: String(
      item.calendar?.superCalendar?.name || item.calendar?.name || ""
    ),
    title: String(item.title || ""),
    status,
    completed: status === "COMPLETED" || Boolean(item.isCompleted),
    percentComplete: Number(item.percentComplete || 0),
    priority: Number(item.priority || 0),
    categories: categoriesOf(item),
    due: dateView(item.dueDate),
    start: dateView(item.entryDate),
    completedDate: dateView(item.completedDate),
    description: String(item.getProperty("DESCRIPTION") || ""),
    recurring: Boolean(item.recurrenceInfo || item.recurrenceId),
  };
}

function eventView(item) {
  return {
    id: String(item.id || ""),
    calendarId: String(
      item.calendar?.superCalendar?.id || item.calendar?.id || ""
    ),
    calendarName: String(
      item.calendar?.superCalendar?.name || item.calendar?.name || ""
    ),
    title: String(item.title || ""),
    start: dateView(item.startDate),
    end: dateView(item.endDate),
    status: String(item.getProperty("STATUS") || item.status || ""),
    categories: categoriesOf(item),
    description: String(item.getProperty("DESCRIPTION") || ""),
    recurring: Boolean(item.recurrenceInfo || item.recurrenceId),
  };
}

function fromInputDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();

  if (/^\d{8}$/.test(text) || /^\d{8}T\d{6}Z?$/.test(text)) {
    return cal.createDateTime(text);
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    return cal.createDateTime(
      `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`
    );
  }

  const local =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      text
    );
  if (local) {
    const dt = cal.createDateTime(
      `${local[1]}${local[2]}${local[3]}T${local[4]}${local[5]}${local[6] || "00"}`
    );
    dt.timezone = cal.dtz.defaultTimezone;
    return dt;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.valueOf())) {
    return cal.dtz.jsDateToDateTime(parsed, cal.dtz.UTC);
  }

  throw new ExtensionError(`Unsupported date/time: ${text}`);
}

async function readItems(calendar, filter, start = null, end = null) {
  try {
    return await calendar.getItemsAsArray(filter, 0, start, end);
  } catch (error) {
    console.error("[ThunderbirdCalDAV] read failed", calendar.name, error);
    throw error;
  }
}

async function findItem(calendar, itemId, kind) {
  const id = String(itemId || "");
  const direct = await calendar.getItem(id);
  if (direct) {
    if (kind === "task" && !direct.isTodo?.()) {
      throw new ExtensionError(`Item is not a task: ${id}`);
    }
    if (kind === "event" && !direct.isEvent?.()) {
      throw new ExtensionError(`Item is not an event: ${id}`);
    }
    return direct;
  }

  throw new ExtensionError(`Calendar item not found: ${id}`);
}

function setDescription(item, value) {
  if (value === null || value === undefined || value === "") {
    item.deleteProperty("DESCRIPTION");
  } else {
    item.setProperty("DESCRIPTION", String(value));
  }
}

function setCategories(item, values) {
  const categories = Array.isArray(values)
    ? values.map(value => String(value).trim()).filter(Boolean)
    : String(values || "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
  item.setCategories([...new Set(categories)]);
}

function normalizePriority(value) {
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < 0 || priority > 9) {
    throw new ExtensionError("Priority must be an integer from 0 to 9");
  }
  return priority;
}

function normalizePercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new ExtensionError("Percent complete must be from 0 to 100");
  }
  return Math.round(percent);
}

function normalizeTaskStatus(value) {
  const status =
    value === null || value === undefined
      ? ""
      : String(value).trim().toUpperCase();
  if (!TASK_STATUSES.has(status)) {
    throw new ExtensionError(`Unsupported VTODO status: ${status}`);
  }
  return status;
}

function applyTaskChanges(item, changes) {
  if ("title" in changes) item.title = String(changes.title || "");
  if ("description" in changes) setDescription(item, changes.description);
  if ("priority" in changes) item.priority = normalizePriority(changes.priority);
  if ("categories" in changes) setCategories(item, changes.categories);
  if ("due" in changes) item.dueDate = fromInputDate(changes.due);
  if ("start" in changes) item.entryDate = fromInputDate(changes.start);

  if ("status" in changes) {
    const status = normalizeTaskStatus(changes.status);
    if (!status) {
      item.deleteProperty("STATUS");
      item.isCompleted = false;
      item.completedDate = null;
      if (!("percentComplete" in changes)) item.percentComplete = 0;
    } else if (status === "COMPLETED") {
      item.status = "COMPLETED";
      item.isCompleted = true;
      item.percentComplete = 100;
    } else {
      item.status = status;
      item.isCompleted = false;
      item.completedDate = null;
      if (status === "NEEDS-ACTION" && !("percentComplete" in changes)) {
        item.percentComplete = 0;
      }
    }
  }

  if ("percentComplete" in changes) {
    const value = normalizePercent(changes.percentComplete);
    item.percentComplete = value;
    if (value === 100) {
      item.status = "COMPLETED";
      item.isCompleted = true;
    } else if (item.isCompleted) {
      item.isCompleted = false;
      item.completedDate = null;
      if (item.status === "COMPLETED") {
        item.status = "IN-PROCESS";
      }
    }
  }
}

function applyEventChanges(item, changes) {
  if ("title" in changes) item.title = String(changes.title || "");
  if ("description" in changes) setDescription(item, changes.description);
  if ("categories" in changes) setCategories(item, changes.categories);
  if ("start" in changes) item.startDate = fromInputDate(changes.start);
  if ("end" in changes) item.endDate = fromInputDate(changes.end);
  if ("status" in changes) {
    const status = String(changes.status || "").trim().toUpperCase();
    if (status) item.status = status;
    else item.deleteProperty("STATUS");
  }
}

function validateEvent(item) {
  if (!item.startDate) {
    throw new ExtensionError("Event start is required");
  }
  if (!item.endDate) {
    item.endDate = item.startDate.clone();
  }
  if (item.endDate.compare(item.startDate) < 0) {
    throw new ExtensionError("Event end must not be before its start");
  }
}

async function modifyItem(calendar, oldItem, mutator) {
  if (oldItem.recurrenceId && oldItem.parentItem?.recurrenceInfo) {
    const oldParent = oldItem.parentItem;
    const newParent = oldParent.clone();
    const recurrenceInfo = newParent.recurrenceInfo;
    const occurrence = recurrenceInfo.getOccurrenceFor(oldItem.recurrenceId);
    if (!occurrence) {
      throw new ExtensionError("Recurring occurrence was not found");
    }
    mutator(occurrence);
    recurrenceInfo.modifyException(occurrence, true);
    const storedParent = await calendar.modifyItem(newParent, oldParent);
    const storedOccurrence =
      storedParent?.recurrenceInfo?.getOccurrenceFor?.(oldItem.recurrenceId);
    return storedOccurrence || occurrence;
  }

  const changed = oldItem.clone();
  mutator(changed);
  return (await calendar.modifyItem(changed, oldItem)) || changed;
}

async function listCalendarsApi() {
  return allCalendars().map(calendarView);
}

async function listTasksApi(calendarId = "") {
  const filter =
    Ci.calICalendar.ITEM_FILTER_TYPE_TODO |
    Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;
  const batches = await Promise.all(
    selectedCalendars(calendarId)
      .filter(calendar => calendarSupports(calendar, "task"))
      .map(async calendar =>
        (await readItems(calendar, filter))
          .filter(item => item?.isTodo?.())
          .map(taskView)
      )
  );
  return batches.flat();
}

async function listEventsApi(calendarId = "", start = "", end = "") {
  const filter = Ci.calICalendar.ITEM_FILTER_TYPE_EVENT;
  const startDate = fromInputDate(start);
  const endDate = fromInputDate(end);
  const batches = await Promise.all(
    selectedCalendars(calendarId)
      .filter(calendar => calendarSupports(calendar, "event"))
      .map(async calendar =>
        (await readItems(calendar, filter, startDate, endDate))
          .filter(item => item?.isEvent?.())
          .map(eventView)
      )
  );
  return batches.flat();
}

async function createTaskApi(calendarId, values) {
  const calendar = writableCalendarById(calendarId, "task");
  const task = new CalTodo();
  task.id = cal.getUUID();
  task.calendar = calendar;
  applyTaskChanges(task, values || {});
  const added = await calendar.addItem(task);
  return taskView(added || task);
}

async function updateTaskApi(calendarId, itemId, changes) {
  const calendar = writableCalendarById(calendarId, "task");
  const oldItem = await findItem(calendar, itemId, "task");
  const changed = await modifyItem(calendar, oldItem, item =>
    applyTaskChanges(item, changes || {})
  );
  return taskView(changed);
}

async function deleteTaskApi(calendarId, itemId) {
  const calendar = writableCalendarById(calendarId, "task");
  const item = await findItem(calendar, itemId, "task");
  await calendar.deleteItem(item);
  return { ok: true, id: String(itemId) };
}

async function createEventApi(calendarId, values) {
  const calendar = writableCalendarById(calendarId, "event");
  const event = new CalEvent();
  event.id = cal.getUUID();
  event.calendar = calendar;
  applyEventChanges(event, values || {});
  validateEvent(event);
  const added = await calendar.addItem(event);
  return eventView(added || event);
}

async function updateEventApi(calendarId, itemId, changes) {
  const calendar = writableCalendarById(calendarId, "event");
  const oldItem = await findItem(calendar, itemId, "event");
  const changed = await modifyItem(calendar, oldItem, item => {
    applyEventChanges(item, changes || {});
    validateEvent(item);
  });
  return eventView(changed);
}

async function deleteEventApi(calendarId, itemId) {
  const calendar = writableCalendarById(calendarId, "event");
  const item = await findItem(calendar, itemId, "event");
  await calendar.deleteItem(item);
  return { ok: true, id: String(itemId) };
}

this.ThunderbirdCalDAV = class extends ExtensionAPI {
  getAPI(context) {
    return {
      ThunderbirdCalDAV: {
        listCalendars: listCalendarsApi,
        listTasks: listTasksApi,
        listEvents: listEventsApi,
        createTask: createTaskApi,
        updateTask: updateTaskApi,
        deleteTask: deleteTaskApi,
        createEvent: createEventApi,
        updateEvent: updateEventApi,
        deleteEvent: deleteEventApi,

        onItemsChanged: new EventManager({
          context,
          name: "ThunderbirdCalDAV.onItemsChanged",
          register: fire => {
            const observer = calendarObserver({
              onLoad() {
                fire.async();
              },
              onAddItem() {
                fire.async();
              },
              onModifyItem() {
                fire.async();
              },
              onDeleteItem() {
                fire.async();
              },
            });
            cal.manager.addCalendarObserver(observer);
            return () => cal.manager.removeCalendarObserver(observer);
          },
        }).api(),
      },
    };
  }
};
