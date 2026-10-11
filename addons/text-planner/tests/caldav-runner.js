async function caldavAcceptance(){
  const checks=[],assert=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  const c=cal.manager.createCalendar('caldav',Services.io.newURI('__CALDAV_URL__'));c.setProperty('username','test');
  const login=Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);login.init(c.uri.prePath,null,'Radicale - Password Required','test','acceptance','','');await Services.logins.addLoginAsync(login);
  c.name='Text Planner CalDAV Acceptance';c.setProperty('cache.enabled',false);cal.manager.registerCalendar(c);
  const wait=async(fn,label)=>{const start=Date.now();while(Date.now()-start<45000){if(await fn())return;await new Promise(r=>Services.wm.getMostRecentWindow('mail:3pane').setTimeout(r,100));}throw Error('Timeout '+label);};
  await IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir,'stage.txt'),'CalDAV refresh');c.refresh();await wait(()=>c.wrappedJSObject.mFirstRefreshDone,'CalDAV initial refresh');
  await IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir,'stage.txt'),'CalDAV activation');const file=id();files.set(file,PathUtils.join(PathUtils.profileDir,'dav-plan.txt'));
  const a=await executor.activate('#date=2026-10-11\n#calendar='+c.id+'\n#task\n09:00-09:35 CalDAV Task\n#event\n14:00-15:00 CalDAV Event',file);
  const uids=codec.parseVisible(codec.splitDocument(a.document).visible).entries.map(e=>e.uid);
  assert(a.count===2,'real CalDAV activation writes Task and Event');
  for(const uid of uids){const remote=await readRemote(c,uid);assert(!!remote,'HTTP GET confirms server object '+uid);}
  let task=await c.getItem(uids[0]),updated=task.clone();updated.title='CalDAV edited';updated.isCompleted=true;updated.setProperty('DESCRIPTION','server round trip');await c.modifyItem(updated,task);
  await IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir,'stage.txt'),'CalDAV export');const p=await executor.prepareDeactivate(a.document);assert(p.document.includes('CalDAV edited')&&p.document.includes('STATUS:COMPLETED'),'CalDAV export captures current server modifications');
  const backup=id();files.set(backup,PathUtils.join(PathUtils.profileDir,'dav-deactivated.txt'));
  const d=await executor.finishDeactivate(p,backup);
  for(const uid of uids)assert(!(await readRemote(c,uid)),'HTTP GET 404 verifies deletion '+uid);
  await executor.activate(d.document,backup);assert((await c.getItem(uids[0])).isCompleted,'CalDAV reactivation restores completed state');
  const backup2=id();files.set(backup2,PathUtils.join(PathUtils.profileDir,'dav-second-deactivation.txt'));
  const conflict=await executor.prepareDeactivate(d.document),provider=davProvider(c),snap=remoteSnapshots.get(c.id+'|'+uids[0]);
  const modified=snap.ics.replace('SUMMARY:CalDAV edited','SUMMARY:Remote third-party edit');
  const put=await new CalDavGenericRequest(provider.session,provider,'PUT',snap.uri,{'If-Match':snap.etag},modified,'text/calendar; charset=utf-8').commit();assert(put.ok,'independent server edit succeeds');
  let rejected=false;try{await executor.finishDeactivate(conflict,backup2);}catch(e){rejected=/Changed since export/.test(e.message);}
  assert(rejected,'server-side concurrent change prevents deletion without refresh');
  for(const uid of uids)assert(!!(await readRemote(c,uid)),'server conflict retains object '+uid);
  const etagExport=await executor.prepareDeactivate(d.document);
  const originalCommit=CalDavDeleteItemRequest.prototype.commit;let raced=false;
  CalDavDeleteItemRequest.prototype.commit=async function(...args){
    if(!raced){raced=true;const current=remoteSnapshots.get(c.id+'|'+uids[0]);const changed=current.ics.replace('SUMMARY:Remote third-party edit','SUMMARY:ETag race edit');const res=await new CalDavGenericRequest(provider.session,provider,'PUT',current.uri,{'If-Match':current.etag},changed,'text/calendar; charset=utf-8').commit();if(!res.ok)throw Error('Race setup failed');}
    return originalCommit.apply(this,args);
  };
  rejected=false;try{await executor.finishDeactivate(etagExport,backup2);}catch(e){rejected=/ETag conflict/.test(e.message);}finally{CalDavDeleteItemRequest.prototype.commit=originalCommit;}
  assert(rejected,'If-Match rejects a race after final GET with HTTP 412');
  for(const uid of uids)assert(!!(await readRemote(c,uid)),'ETag race retains server object '+uid);
  await executor.finishDeactivate(await executor.prepareDeactivate(d.document),backup2);
  cal.manager.unregisterCalendar(c);return {ok:true,checks};
}
