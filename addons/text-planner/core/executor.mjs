import {compile,parseVisible,splitDocument,individualCalendars,combineCalendars,decompile,semantic,fail} from './codec.mjs';
// Every effect is supplied by the boundary. No clock, random, DOM or I/O here.
export function createExecutor(io) {
  async function load(plan) {return await io.load(plan);}
  async function checked(calendar,uid,plan){const r=await io.read(calendar,uid);if(r&&r.plan!==plan)fail('Ownership conflict: '+uid);return r;}
  async function persist(s){await io.store(s.plan,s);const r=await io.load(s.plan);if(JSON.stringify(r)!==JSON.stringify(s))fail('Journal read-back failed');}
  return {
    async activate(text,file){
      const p=parseVisible(splitDocument(text).visible),result=compile(text,{plan:p.plan||io.id(),uids:p.entries.map(e=>e.uid||io.id())});
      await io.validateCalendar(result.calendar);
      const entries=individualCalendars(result.ics),old=await load(result.plan);
      if(old&&old.calendar!==result.calendar)fail('Plan already bound to another calendar');
      if(old&&old.state!=='inactive'&&JSON.stringify(old.uids)!==JSON.stringify(entries.map(x=>x.uid)))fail('Active plan membership cannot change; deactivate first');
      const existing=[];
      for(const e of entries){const r=await checked(result.calendar,e.uid,result.plan);if(r&&!(await io.equivalent(r.ics,e.ics)))fail('Existing object differs; deactivate to capture Thunderbird edits: '+e.uid);if(!r&&old?.state==='active')fail('Object deleted externally; will not resurrect: '+e.uid);existing.push(r);}
      // Persist identities before the first calendar mutation.
      const saved=await io.save(file,result.document,'plan.txt');
      const s={plan:result.plan,calendar:result.calendar,uids:entries.map(x=>x.uid),document:result.document,state:'activating',sourceIdentity:saved.identity||null,receipts:old?.receipts||{}};
      await persist(s);
      for(const [i,e] of entries.entries()){
        // Re-read immediately before adding; never replace a collision.
        let r=await checked(s.calendar,e.uid,s.plan);
        if(r&&!(await io.equivalent(r.ics,e.ics)))fail('Concurrent change: '+e.uid);
        if(!r){await io.add(s.calendar,e.ics);r=await checked(s.calendar,e.uid,s.plan);}
        if(!r||!(await io.equivalent(r.ics,e.ics)))fail('Write read-back mismatch: '+e.uid);
        s.receipts[e.uid]={ics:r.ics};await persist(s);
      }
      s.state='active';await persist(s);return {...saved,document:result.document,plan:s.plan,count:entries.length};
    },
    async prepareDeactivate(text){
      const p=parseVisible(splitDocument(text).visible),s=await load(p.plan);
      if(!s||s.state==='inactive')fail('No active association in this Thunderbird profile');
      if(semantic(compile(text).ics)!==semantic(compile(s.document).ics))fail('Editor differs from activated document. Save a copy, then reopen the activated file before deactivation.');
      await io.validateCalendar(s.calendar);
      const current=[],missing=[],snapshot={};
      for(const uid of s.uids){const r=await checked(s.calendar,uid,s.plan);if(r){current.push(r.ics);snapshot[uid]=r.ics;}else{missing.push(uid);if(s.state==='deactivating'&&s.archive?.[uid])current.push(s.archive[uid]);}}
      if(!current.length)fail('All associated objects are missing; original file retained');
      const ics=combineCalendars(current),document=decompile(ics,{date:p.date,calendar:s.calendar,plan:s.plan});
      if(semantic(splitDocument(document).ics)!==semantic(ics))fail('Export validation failed');
      return {plan:s.plan,calendar:s.calendar,document,snapshot,missing,count:Object.keys(snapshot).length};
    },
    async finishDeactivate(prepared,file){
      const s=await load(prepared.plan);if(!s||s.state==='inactive')fail('Plan no longer active');
      // io.save returns only after exact durable file read-back.
      const saved=await io.save(file,prepared.document,'plan.deactivated.txt',s.sourceIdentity);
      // Preflight every object before deleting any of them.
      for(const [uid,ics] of Object.entries(prepared.snapshot)){const r=await checked(s.calendar,uid,s.plan);if(!r||!(await io.sameSnapshot(r.ics,ics)))fail('Changed since export; nothing deleted: '+uid);}
      s.state='deactivating';s.archive={...s.archive,...prepared.snapshot};s.exportFile=saved;await persist(s);
      for(const [uid,ics] of Object.entries(prepared.snapshot)){
        await io.verifyFile(saved,prepared.document);
        const r=await checked(s.calendar,uid,s.plan);if(!r||!(await io.sameSnapshot(r.ics,ics)))fail('Concurrent edit during deletion: '+uid);
        await io.remove(s.calendar,uid,r.ics);
        if(await io.read(s.calendar,uid))fail('Delete read-back failed: '+uid);
        s.receipts[uid]={deleted:true};await persist(s);
      }
      s.state='inactive';s.document=prepared.document;await persist(s);
      return {...saved,document:prepared.document,count:prepared.count,missing:prepared.missing};
    }
  };
}
