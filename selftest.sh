#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/app/chrome"

python3 - "$TMP/app/chrome/calendar.jar" "$TMP/app/chrome/messenger.jar" <<'PY'
import sys, zipfile
calendar_jar, messenger_jar = sys.argv[1:3]

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

messenger=r'''<window>
  <hbox id="task-actions-toolbar" class="themeable-brighttext" role="toolbar">
    <toolbarbutton id="task-actions-category" type="menu">
      <menupopup id="task-actions-category-popup"/>
    </toolbarbutton>
                    <toolbarbutton is="toolbarbutton-menu-button" id="task-actions-markcompleted"
                                   type="menu"/>
  </hbox>
</window>
'''

with zipfile.ZipFile(calendar_jar,'w',compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr('content/calendar-task-tree-utils.js',utils)
    z.writestr('content/calendar-task-view.js',view)
    z.writestr('keep-calendar.txt',b'unchanged-calendar')

with zipfile.ZipFile(messenger_jar,'w',compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr('content/messenger/messenger.xhtml',messenger)
    z.writestr('keep-messenger.txt',b'unchanged-messenger')
PY

python3 "$HERE/patch_omnijar.py" "$TMP/app"
python3 "$HERE/patch_omnijar.py" "$TMP/app" >/dev/null

python3 - "$TMP/app/chrome/calendar.jar" "$TMP/app/chrome/messenger.jar" <<'PY'
import sys, zipfile
calendar_jar, messenger_jar = sys.argv[1:3]

with zipfile.ZipFile(calendar_jar) as z:
    assert z.testzip() is None
    u=z.read('content/calendar-task-tree-utils.js').decode()
    v=z.read('content/calendar-task-view.js').decode()
    assert 'THUNDERBIRD_TASKFIX_BATCH_EDIT_V2' in u
    assert 'function taskfixModifySelectedTasks' in u
    assert 'function contextChangeTaskStatus' in u
    assert 'recurringGroups' in u
    assert 'THUNDERBIRD_TASKFIX_BATCH_EDIT_V2' in v
    assert 'taskfixCategoryCommand(event)' in v
    assert 'taskfixModifySelectedTasks(newItem =>' in v
    assert z.read('keep-calendar.txt') == b'unchanged-calendar'

with zipfile.ZipFile(messenger_jar) as z:
    assert z.testzip() is None
    p=z.read('content/messenger/messenger.xhtml').decode()
    assert 'id="task-actions-status"' in p
    assert "contextChangeTaskStatus('IN-PROCESS')" in p
    assert z.read('keep-messenger.txt') == b'unchanged-messenger'

print('selftest: PASS')
PY
