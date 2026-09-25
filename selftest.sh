#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/app"

python3 - "$TMP/app/omni.ja" <<'PY'
import sys, zipfile
p=sys.argv[1]
utils=r'''function contextChangeTaskProgress(aProgress) {
  if (gTabmail && gTabmail.currentTabInfo.mode.type == "calendarTask") {
    editToDoStatus(aProgress);
  } else {
    startBatchTransaction();
    const tasks = getSelectedTasks();
    for (const task of tasks) {
      const newTask = task.clone().QueryInterface(Ci.calITodo);
      newTask.percentComplete = aProgress;
      switch (aProgress) {
        case 0:
          newTask.isCompleted = false;
          break;
        case 100:
          newTask.isCompleted = true;
          break;
        default:
          newTask.status = "IN-PROCESS";
          newTask.completedDate = null;
          break;
      }
      doTransaction("modify", newTask, newTask.calendar, task, null);
    }
    endBatchTransaction();
  }
}
'''
view=r'''var taskDetailsView = {
  loadCategories() {
    const categoryPopup = document.getElementById("task-actions-category-popup");
    const item = document.getElementById("calendar-task-tree").currentTask;
    const categoryList = [...new Set([...cal.category.fromPrefs(), ...item.getCategories()])].sort(new Intl.Collator().compare);
    while (categoryPopup.childElementCount > 2) { categoryPopup.lastChild.remove(); }
    for (const cat of categoryList) {
      const menuitem = document.createXULElement("menuitem");
      menuitem.setAttribute("class", "calendar-category");
      categoryPopup.appendChild(menuitem);
    }
  },

  saveCategories() {
    const categoryPopup = document.getElementById("task-actions-category-popup");
    const item = document.getElementById("calendar-task-tree").currentTask;
    const categories = Array.from(categoryPopup.querySelectorAll("menuitem.calendar-category[checked]"), menuitem => menuitem.value);
    const newItem = item.clone();
    newItem.setCategories(categories);
    doTransaction("modify", newItem, newItem.calendar, item, null);
    return false;
  },

  categoryTextboxKeypress(event) {
    let category = event.target.value;
    const categoryPopup = document.getElementById("task-actions-category-popup");
    switch (event.key) {
      case "Enter":
        category = category.trim();
        if (category != "") { break; }
        return;
      default:
        return;
    }
    let categoryList = categoryPopup.querySelectorAll("menuitem.calendar-category");
    const item = document.getElementById("calendar-task-tree").currentTask;
    const newItem = item.clone();
    newItem.setCategories([category]);
    doTransaction("modify", newItem, newItem.calendar, item, null);
    event.target.value = "";
  },
};
'''
panels=r'''<hbox id="task-actions-toolbar" class="themeable-brighttext" role="toolbar">
  <toolbarbutton id="task-actions-category" type="menu">
    <menupopup id="task-actions-category-popup"/>
  </toolbarbutton>
                    <toolbarbutton is="toolbarbutton-menu-button" id="task-actions-markcompleted"
                                   type="menu"/>
</hbox>
'''
with zipfile.ZipFile(p,'w',compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr('chrome/calendar/content/calendar/calendar-task-tree-utils.js',utils)
    z.writestr('chrome/calendar/content/calendar/calendar-task-view.js',view)
    z.writestr('chrome/calendar/content/calendar/calendar-tab-panels.inc.xhtml',panels)
    z.writestr('keep.txt',b'unchanged')
PY

python3 "$HERE/patch_omnijar.py" "$TMP/app"
python3 "$HERE/patch_omnijar.py" "$TMP/app" >/dev/null
python3 - "$TMP/app/omni.ja" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None
    u=z.read('chrome/calendar/content/calendar/calendar-task-tree-utils.js').decode()
    v=z.read('chrome/calendar/content/calendar/calendar-task-view.js').decode()
    p=z.read('chrome/calendar/content/calendar/calendar-tab-panels.inc.xhtml').decode()
    assert 'THUNDERBIRD_TASKFIX_BATCH_EDIT_V2' in u
    assert 'function taskfixModifySelectedTasks' in u
    assert 'function contextChangeTaskStatus' in u
    assert 'recurringGroups' in u
    assert 'THUNDERBIRD_TASKFIX_BATCH_EDIT_V2' in v
    assert 'taskfixCategoryCommand(event)' in v
    assert 'taskfixModifySelectedTasks(newItem =>' in v
    assert 'id="task-actions-status"' in p
    assert "contextChangeTaskStatus('IN-PROCESS')" in p
    assert z.read('keep.txt') == b'unchanged'
print('selftest: PASS')
PY
