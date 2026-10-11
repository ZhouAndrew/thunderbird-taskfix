'use strict';
var {ExtensionCommon}=ChromeUtils.importESModule('resource://gre/modules/ExtensionCommon.sys.mjs');
var {CalDavGenericRequest,CalDavDeleteItemRequest}=ChromeUtils.importESModule('resource:///modules/caldav/CalDavRequest.sys.mjs');
var {cal}=ChromeUtils.importESModule('resource:///modules/calendar/calUtils.sys.mjs');
this.TextPlanner=class extends ExtensionCommon.ExtensionAPI {
  onShutdown(){this._cleanup?.();this._api=null;}
  getAPI(context){
    if(this._api)return this._api;
    const root='text-planner-'+Services.uuid.generateUUID().toString().replace(/[^a-z0-9]/gi,'').toLowerCase();
    const protocol=Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler);
    protocol.setSubstitution(root,this.extension.rootURI);
    const {createExecutor}=ChromeUtils.importESModule('resource://'+root+'/core/executor.mjs');
    const codec=ChromeUtils.importESModule('resource://'+root+'/core/codec.mjs');
    const files=new Map(),prepared=new Map(),remoteSnapshots=new Map();let queue=Promise.resolve();
    const id=()=>Services.uuid.generateUUID().toString().slice(1,-1);
    const directory=PathUtils.join(PathUtils.profileDir,'text-planner');
    const getCalendar=calendarId=>{const c=cal.manager.getCalendarById(calendarId);if(!c||c.readOnly||c.getProperty('disabled'))throw Error('Calendar missing, disabled or read-only');return c;};
    const pathFor=plan=>{if(!/^[\w.-]{1,128}$/.test(plan))throw Error('Invalid plan identity');return PathUtils.join(directory,plan+'.json');};
    async function picker(save,name){
      const win=Services.wm.getMostRecentWindow('mail:3pane');if(!win)throw Error('Open Thunderbird main window first');
      const p=Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
      p.init(win.browsingContext,save?'Save Text Planner':'Open Text Planner',save?Ci.nsIFilePicker.modeSave:Ci.nsIFilePicker.modeOpen);
      p.appendFilter('Text plans','*.txt');p.appendFilters(Ci.nsIFilePicker.filterAll);if(save){p.defaultString=name;p.defaultExtension='txt';}
      const r=await new Promise(resolve=>p.open(resolve));if(r===Ci.nsIFilePicker.returnCancel)throw Error('File selection cancelled');return p.file.path;
    }
    async function save(file,text,name,avoid){
      const path=file?files.get(file):await picker(true,name);if(!path)throw Error('File handle expired; open file again');
      const native=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);native.initWithPath(path);try{native.normalize();}catch{}const identity=native.path;
      if(avoid&&identity===avoid)throw Error('Choose a different output file; original plan must be retained');
      await IOUtils.writeUTF8(path,text,{tmpPath:path+'.text-planner-tmp'});
      if(await IOUtils.readUTF8(path)!==text)throw Error('File read-back mismatch');
      const token=file||id();files.set(token,path);return {file:token,name:PathUtils.filename(path),identity};
    }
    function items(ics){const parser=Cc['@mozilla.org/calendar/ics-parser;1'].createInstance(Ci.calIIcsParser);parser.parseString(ics);const result=parser.getItems();if(result.length!==1)throw Error('Expected one UID group');return result[0];}
    function exportItem(item){const serializer=Cc['@mozilla.org/calendar/ics-serializer;1'].createInstance(Ci.calIIcsSerializer);serializer.addItems([item]);return serializer.serializeToString();}
    function content(ics,ignoreVolatile){const c=codec.calendar(ics);c.removeAllProperties('prodid');c.removeAllProperties('version');c.removeAllProperties('calscale');if(ignoreVolatile)for(const o of codec.objects(c))for(const key of ['dtstamp','created','last-modified','x-moz-generation','x-moz-lastack'])o.removeAllProperties(key);return codec.semantic(c.toString());}
    function davProvider(c){if(c.type!=='caldav')return null;let p=c.wrappedJSObject;if(p.mUncachedCalendar)p=p.mUncachedCalendar.wrappedJSObject||p.mUncachedCalendar;if(!p.session||!p.makeUri||!p.mItemInfoCache)throw Error('Unsupported Thunderbird CalDAV provider');if(Services.io.offline)throw Error('CalDAV is offline; no mutation allowed');return p;}
    async function readRemote(c,uid){
      const p=davProvider(c),info=p.mItemInfoCache[uid];
      if(!info){const cached=await c.getItem(uid);if(cached)throw Error('CalDAV resource mapping unavailable; refresh calendar first');return null;}
      const uri=p.makeUri(info.locationPath);if(uri.spec===p.calendarUri.spec)throw Error('Unsafe CalDAV object URI');
      const response=await new CalDavGenericRequest(p.session,p,'GET',uri,{'Cache-Control':'no-cache'}).commit();
      if(response.status===404)return null;if(response.status!==200)throw Error('CalDAV read failed: '+response.status);
      const ics=response.text,groups=codec.individualCalendars(ics);if(groups.length!==1||groups[0].uid!==uid)throw Error('CalDAV UID read-back mismatch');
      let etag;try{etag=response.nsirequest.getResponseHeader('ETag');}catch{throw Error('CalDAV server returned no ETag; safe deletion unavailable');}
      remoteSnapshots.set(c.id+'|'+uid,{uri,etag,ics,provider:p});
      const parent=codec.objects(codec.calendar(ics)).find(o=>!o.hasProperty('recurrence-id'));
      return {plan:parent?.getFirstPropertyValue('x-text-planner-plan'),ics};
    }
    const io={
      id,
      async validateCalendar(cid){getCalendar(cid);},
      async load(plan){const p=pathFor(plan);return await IOUtils.exists(p)?IOUtils.readJSON(p):null;},
      async store(plan,state){await IOUtils.makeDirectory(directory,{ignoreExisting:true});const p=pathFor(plan);await IOUtils.writeJSON(p,state,{tmpPath:p+'.tmp'});},
      save,
      async verifyFile(saved,text){const p=files.get(saved.file);if(!p||await IOUtils.readUTF8(p)!==text)throw Error('Saved backup changed or unreadable');},
      async read(cid,uid){const c=getCalendar(cid);if(c.type==='caldav')return readRemote(c,uid);const item=await c.getItem(uid);return item?{plan:item.getProperty('X-TEXT-PLANNER-PLAN'),ics:exportItem(item)}:null;},
      async equivalent(a,b){return content(a,true)===content(b,true);},
      async sameSnapshot(a,b){return content(a,false)===content(b,false);},
      async add(cid,ics){const c=getCalendar(cid),item=items(ics);if(item.isTodo()&&c.getProperty('capabilities.tasks.supported')===false)throw Error('Calendar does not support Tasks');if(item.isEvent()&&c.getProperty('capabilities.events.supported')===false)throw Error('Calendar does not support Events');item.calendar=c;await c.addItem(item);},
      async remove(cid,uid,expected){const c=getCalendar(cid);
        if(c.type==='caldav'){
          const latest=await readRemote(c,uid);if(!latest||content(latest.ics,false)!==content(expected,false))throw Error('Delete conflict');
          const snap=remoteSnapshots.get(cid+'|'+uid),response=await new CalDavDeleteItemRequest(snap.provider.session,snap.provider,snap.uri,snap.etag).commit();
          if(response.conflict)throw Error('CalDAV ETag conflict; no forced deletion');if(!response.ok)throw Error('CalDAV deletion failed: '+response.status);
          const verify=await new CalDavGenericRequest(snap.provider.session,snap.provider,'GET',snap.uri,{'Cache-Control':'no-cache'}).commit();
          if(verify.status!==404)throw Error('Server delete read-back failed: '+verify.status);
          // Tell the native provider to remove its matching local cache entry.
          const path=snap.provider.ensureDecodedPath(snap.uri.pathQueryRef);
          if(snap.provider.mHrefIndex[path])await snap.provider.deleteTargetCalendarItem(path);
          remoteSnapshots.delete(cid+'|'+uid);return;
        }
        const item=await c.getItem(uid);if(!item||content(exportItem(item),false)!==content(expected,false))throw Error('Delete conflict');await c.deleteItem(item);}
    };
    const executor=createExecutor(io);
    const serial=f=>(...args)=>{const run=queue.then(()=>f(...args));queue=run.catch(()=>{});return run;};
    this._cleanup=()=>{protocol.setSubstitution(root,null);files.clear();prepared.clear();remoteSnapshots.clear();};
    return this._api={TextPlanner:{
      calendars:serial(async()=>cal.manager.getCalendars().filter(c=>!c.readOnly&&!c.getProperty('disabled')).map(c=>({id:c.id,name:c.name,tasks:c.getProperty('capabilities.tasks.supported')!==false,events:c.getProperty('capabilities.events.supported')!==false}))),
      open:serial(async()=>{const path=await picker(false),file=id();files.set(file,path);return {file,name:PathUtils.filename(path),text:await IOUtils.readUTF8(path)};}),
      save:serial(async(text,file)=>save(file,text,'plan.txt')),
      activate:serial(async(text,file)=>executor.activate(text,file)),
      prepareDeactivate:serial(async text=>{const value=await executor.prepareDeactivate(text),token=id();prepared.set(token,value);return {token,count:value.count,missing:value.missing,document:value.document};}),
      finishDeactivate:serial(async token=>{const value=prepared.get(token);if(!value)throw Error('Export token expired; preview again');prepared.delete(token);return executor.finishDeactivate(value,null);})
    }};
  }
};
