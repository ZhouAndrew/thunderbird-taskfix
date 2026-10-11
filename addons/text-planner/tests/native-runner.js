// Inserted into an acceptance-only copy of the production Experiment API.
async function nativeAcceptance(){
  const checks=[],assert=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  const c=cal.manager.createCalendar('storage',Services.io.newURI('moz-storage-calendar://'));
  c.name='Text Planner Acceptance';cal.manager.registerCalendar(c);
  const file=id(),path=PathUtils.join(PathUtils.profileDir,'acceptance-plan.txt');files.set(file,path);
  const raw='#date=2026-10-11\n#calendar='+c.id+'\n#task\n09:00-09:35 Anki\n09:05-09:40 Mars\n#event\n14:00-15:00 English';
  let a=await executor.activate(raw,file);const p=codec.parseVisible(codec.splitDocument(a.document).visible),uids=p.entries.map(e=>e.uid);
  assert(a.count===3,'activation creates two Tasks and one Event');
  assert(await IOUtils.readUTF8(path)===a.document,'real TXT file write and read-back');
  assert((await c.getItem(uids[0])).isTodo(),'native VTODO exists');
  assert((await c.getItem(uids[2])).isEvent(),'native VEVENT exists');
  a=await executor.activate(a.document,file);assert(true,'repeat activation is idempotent');
  let item=await c.getItem(uids[0]),changed=item.clone();changed.title='Edited Anki';changed.dueDate=changed.dueDate.clone();changed.dueDate.hour=10;changed.dueDate.minute=0;changed.setProperty('DESCRIPTION','Reviewed 50 cards\n中文');changed.setCategories(['Study','Anki']);changed.isCompleted=true;changed.setProperty('X-ACCEPTANCE-CUSTOM','keep');await c.modifyItem(changed,item);
  const capture=await executor.prepareDeactivate(a.document);
  assert(capture.document.includes('Edited Anki'),'captures latest Thunderbird title');
  assert(capture.document.includes('STATUS:COMPLETED'),'captures completed status');
  assert(capture.document.includes('Reviewed 50 cards'),'captures description');
  assert(capture.document.includes('CATEGORIES:'),'captures categories');
  assert(capture.document.includes('X-ACCEPTANCE-CUSTOM:keep'),'preserves custom property');
  let prevented=false;try{await executor.finishDeactivate(capture,file);}catch(e){prevented=/original plan/.test(e.message);}
  assert(prevented,'deactivation cannot overwrite original plan');
  const backup=id(),backupPath=PathUtils.join(PathUtils.profileDir,'acceptance-deactivated.txt');files.set(backup,backupPath);
  const d=await executor.finishDeactivate(capture,backup);
  assert(await IOUtils.readUTF8(backupPath)===d.document,'deactivation snapshot saved and verified');
  for(const uid of uids)assert(!(await c.getItem(uid)),'deletion read-back '+uid);
  assert(await IOUtils.readUTF8(path)===a.document,'original TXT retained');
  await executor.activate(d.document,backup);
  const restored=await c.getItem(uids[0]);assert(restored.title==='Edited Anki'&&restored.isCompleted,'reactivation restores title and completion');
  assert(restored.getProperty('DESCRIPTION')==='Reviewed 50 cards\n中文','reactivation restores multiline description');
  assert(restored.getProperty('X-ACCEPTANCE-CUSTOM')==='keep','reactivation restores extension property');
  const backup2=id();files.set(backup2,PathUtils.join(PathUtils.profileDir,'second-deactivation.txt'));
  let protectedExport=await executor.prepareDeactivate(d.document);
  item=await c.getItem(uids[1]);changed=item.clone();changed.title='Concurrent edit';await c.modifyItem(changed,item);
  let rejected=false;try{await executor.finishDeactivate(protectedExport,backup2);}catch(e){rejected=/Changed since export/.test(e.message);}
  assert(rejected,'concurrent edits block deletion');
  for(const uid of uids)assert(!!(await c.getItem(uid)),'conflict preserves object '+uid);
  protectedExport=await executor.prepareDeactivate(d.document);
  // A nonexistent parent forces an actual OS-level write failure.
  const bad=id();files.set(bad,PathUtils.profileDir);
  rejected=false;try{await executor.finishDeactivate(protectedExport,bad);}catch{rejected=true;}
  assert(rejected,'real filesystem save failure blocks deletion');
  for(const uid of uids)assert(!!(await c.getItem(uid)),'save failure preserves object '+uid);
  await executor.finishDeactivate(await executor.prepareDeactivate(d.document),backup2);
  const complexPlan=id(),complexUID=id(),complexFile=id();files.set(complexFile,PathUtils.join(PathUtils.profileDir,'complex-plan.txt'));
  const complexICS='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ZhouAndrew//Text Planner//EN\r\nBEGIN:VEVENT\r\nUID:'+complexUID+'\r\nDTSTAMP:20261011T010000Z\r\nDTSTART:20261011T090000Z\r\nDTEND:20261011T100000Z\r\nSUMMARY:Recurring alarm\r\nRRULE:FREQ=DAILY;COUNT=3\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:'+complexUID+'\r\nDTSTAMP:20261011T010000Z\r\nRECURRENCE-ID:20261012T090000Z\r\nDTSTART:20261012T110000Z\r\nDTEND:20261012T120000Z\r\nSUMMARY:Moved occurrence\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const complexTXT=codec.decompile(complexICS,{date:'2026-10-11',calendar:c.id,plan:complexPlan});
  const complex=await executor.activate(complexTXT,complexFile),native=await c.getItem(complexUID);
  assert(!!native.recurrenceInfo&&native.getAlarms().length===1,'native recurring event and alarm are created');
  assert(native.recurrenceInfo.getExceptionIds().length===1,'native recurrence exception is grouped under parent UID');
  const complexSnapshot=await executor.prepareDeactivate(complex.document),complexBackup=id();files.set(complexBackup,PathUtils.join(PathUtils.profileDir,'complex-deactivated.txt'));
  const complexDeactivated=await executor.finishDeactivate(complexSnapshot,complexBackup);await executor.activate(complexDeactivated.document,complexBackup);
  const restoredComplex=await c.getItem(complexUID);assert(restoredComplex.getAlarms().length===1&&restoredComplex.recurrenceInfo.getExceptionIds().length===1,'native alarm and recurrence exception survive deactivate/reactivate');
  cal.manager.unregisterCalendar(c);
  return {ok:true,version:Services.appinfo.version,checks,calendarId:c.id};
}
