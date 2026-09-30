"use strict";

var {
  ExtensionCommon: { ExtensionAPI, EventManager },
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { cal } = ChromeUtils.importESModule(
  "resource:///modules/calendar/calUtils.sys.mjs"
);

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
  const calendar = allCalendars().find(candidate => String(candidate.id) === String(id));
  if (!calendar) {
    throw new ExtensionError(`Thunderbird calendar not found: ${id}`);
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
    supportsTasks: calendar.getProperty("capabilities.tasks.supported") !== false,
    supportsEvents: calendar.getProperty("capabilities.events.supported") !== false,
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
  const status = String(item.getProperty("STATUS") || item.status || "").toUpperCase();
  return {
    id: String(item.id || ""),
    calendarId: String(item.calendar?.superCalendar?.id || item.calendar?.id || ""),
    calendarName: String(item.calendar?.superCalendar?.name || item.calendar?.name || ""),
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
    calendarId: String(item.calendar?.superCalendar?.id || item.calendar?.id || ""),
    calendarName: String(item.calendar?.superCalendar?.name || item.calendar?.name || ""),
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
    return cal.createDateTime(`${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`);
  }

  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
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

async function findItem(calendar, itemId, typeFilter) {
  const items = await readItems(calendar, typeFilter);
  const item = items.find(candidate => String(candidate.id) === String(itemId));
  if (!item) {
    throw new ExtensionError(`Calendar item not found: ${itemId}`);
  }
  return item;
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
    : String(values || "").split(",").map(value => value.trim()).filter(Boolean);
  item.setCategories([...new Set(categories)]);
}

function applyTaskChanges(item, changes) {
  if ("title" in changes) item.title = String(changes.title || "");
  if ("description" in changes) setDescription(item, changes.description);
  if ("priority" in changes) item.priority = Number(changes.priority || 0);
  if ("categories" in changes) setCategories(item, changes.categories);
  if ("due" in changes) item.dueDate = fromInputDate(changes.due);
  if ("start" in changes) item.entryDate = fromInputDate(changes.start);

  if ("status" in changes) {
    const status = changes.status === null ? "" : String(changes.status || "").toUpperCase();
    if (!status) {
      item.deleteProperty("STATUS");
      item.isCompleted = false;
      item.completedDate = null;
      if (!("percentComplete" in changes)) item.percentComplete = 0;
    } else if (status === "COMPLETED") {
      item.isCompleted = true;
      item.status = "COMPLETED";
      item.percentComplete = 100;
    } else {
      item.isCompleted = false;
      item.completedDate = null;
      item.status = status;
      if (status === "NEEDS-ACTION" && !("percentComplete" in changes)) {
        item.percentComplete = 0;
      }
    }
  }

  if ("percentComplete" in changes) {
    const value = Math.max(0, Math.min(100, Number(changes.percentComplete || 0)));
    item.percentComplete = value;
    if (value === 100) {
      item.isCompleted = true;
    } else if (item.isCompleted) {
      item.isCompleted = false;
      item.completedDate = null;
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
    const status = String(changes.status || "").trim();
    if (status) item.status = status;
    else item.deleteProperty("STATUS");
  }
}

async function modifyItem(calendar, oldItem, mutator) {
  if (oldItem.recurrenceId && oldItem.parentItem?.recurrenceInfo) {
    const oldParent = oldItem.parentItem;
    const newParent = oldParent.clone();
    const recurrenceInfo = newParent.recurrenceInfo;
    const occurrence = recurrenceInfo.getOccurrenceFor(oldItem.recurrenceId);
    mutator(occurrence);
    recurrenceInfo.modifyException(occurrence, true);
    await calendar.modifyItem(newParent, oldParent);
    return occurrence;
  }

  const changed = oldItem.clone();
  mutator(changed);
  await calendar.modifyItem(changed, oldItem);
  return changed;
}

this.ThunderbirdCalDAV = class extends ExtensionAPI {
  getAPI(context) {
    return {
      ThunderbirdCalDAV: {
        async listCalendars() {
          return allCalendars().map(calendarView);
        },

        async listTasks(calendarId = "") {
          const filter =
            Ci.calICalendar.ITEM_FILTER_TYPE_TODO |
            Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;
          const batches = await Promise.all(
            selectedCalendars(calendarId)
              .filter(calendar => calendar.getProperty("capabilities.tasks.supported") !== false)
              .map(async calendar => (await readItems(calendar, filter))
                .filter(item => item?.isTodo?.())
                .map(taskView))
          );
          return batches.flat();
        },

        async listEvents(calendarId = "", start = "", end = "") {
          const filter = Ci.calICalendar.ITEM_FILTER_TYPE_EVENT;
          const startDate = fromInputDate(start);
          const endDate = fromInputDate(end);
          const batches = await Promise.all(
            selectedCalendars(calendarId)
              .filter(calendar => calendar.getProperty("capabilities.events.supported") !== false)
              .map(async calendar => (await readItems(calendar, filter, startDate, endDate))
                .filter(item => item?.isEvent?.())
                .map(eventView))
          );
          return batches.flat();
        },

        async createTask(calendarId, values) {
          const calendar = calendarById(calendarId);
          if (calendar.readOnly) throw new ExtensionError("Calendar is read-only");
          const task = cal.createTodo();
          task.calendar = calendar;
          applyTaskChanges(task, values || {});
          const added = await calendar.addItem(task);
          return taskView(added || task);
        },

        async updateTask(calendarId, itemId, changes) {
          const calendar = calendarById(calendarId);
          if (calendar.readOnly) throw new ExtensionError("Calendar is read-only");
          const filter =
            Ci.calICalendar.ITEM_FILTER_TYPE_TODO |
            Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;
          const oldItem = await findItem(calendar, itemId, filter);
          const changed = await modifyItem(calendar, oldItem, item => applyTaskChanges(item, changes || {}));
          return taskView(changed);
        },

        async deleteTask(calendarId, itemId) {
          const calendar = calendarById(calendarId);
          if (calendar.readOnly) throw new ExtensionError("Calendar is read-only");
          const filter =
            Ci.calICalendar.ITEM_FILTER_TYPE_TODO |
            Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;
          const item = await findItem(calendar, itemId, filter);
          await calendar.deleteItem(item);
          return {ok: true, id: itemId};
        },

        async createEvent(calendarId, values) {
          const calendar = calendarById(calendarId);
          if (calendar.readOnly) throw new ExtensionError("Calendar is read-only");
          const event = cal.createEvent();
          event.calendar = calendar;
          applyEventChanges(event, values || {});
          if (!event.startDate) throw new ExtensionError("Event start is required");
          if (!event.endDate) event.endDate = event.startDate.clone();
          const added = await calendar.addItem(event);
          return eventView(added || event);
        },

        async updateEvent(calendarId, itemId, changes) {
          const calendar = calendarById(calendarId);
          if (calendar.readOnly) throw new ExtensionError("Calendar is read-only");
          const filter = Ci.calICalendar.ITEM_FILTER_TYPE_EVENT;
          const oldItem = await findItem(calendar, itemId, filter);
          const changed = await modifyItem(calendar, oldItem, item => applyEventChanges(item, changes || {}));
          return eventView(changed);
        },

        async deleteEvent(calendarId, itemId) {
          const calendar = calendarById(calendarId);
          if (calendar.readOnly) throw new ExtensionError("Calendar is read-only");
          const filter = Ci.calICalendar.ITEM_FILTER_TYPE_EVENT;
          const item = await findItem(calendar, itemId, filter);
          await calendar.deleteItem(item);
          return {ok: true, id: itemId};
        },

        onItemsChanged: new EventManager({
          context,
          name: "ThunderbirdCalDAV.onItemsChanged",
          register: fire => {
            const observer = calendarObserver({
              onLoad() { fire.async(); },
              onAddItem() { fire.async(); },
              onModifyItem() { fire.async(); },
              onDeleteItem() { fire.async(); },
            });
            cal.manager.addCalendarObserver(observer);
            return () => cal.manager.removeCalendarObserver(observer);
          },
        }).api(),
      },
    };
  }
};
