import ICAL from '../vendor/ical.mjs';
export const BEGIN = '#--- BEGIN TEXT-PLANNER-ICS ---';
export const END = '#--- END TEXT-PLANNER-ICS ---';
export function fail(message) { throw new Error(message); }
export function splitDocument(text) {
  const a=text.indexOf(BEGIN), b=text.indexOf(END);
  if(a<0&&b<0)return {visible:text.trimEnd(),ics:''};
  if(a<0||b<a||text.indexOf(BEGIN,a+BEGIN.length)>=0||text.slice(b+END.length).trim())fail('Invalid embedded ICS boundaries');
  return {visible:text.slice(0,a).trimEnd(),ics:text.slice(a+BEGIN.length,b).trim()};
}
export function calendar(ics) {
  let c;try{c=new ICAL.Component(ICAL.parse(ics));}catch(e){fail('Invalid ICS: '+e.message);}
  if(c.name!=='vcalendar')fail('Expected VCALENDAR');return c;
}
export function objects(c){return c.getAllSubcomponents().filter(x=>['vtodo','vevent'].includes(x.name));}
export function semantic(ics){
  const norm=c=>({name:c.name,properties:c.getAllProperties().map(p=>p.toJSON()).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),children:c.getAllSubcomponents().map(norm).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
  return JSON.stringify(norm(calendar(ics)));
}
export function dateValid(d){const t=new Date(d+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(t)&&t.toISOString().slice(0,10)===d;}
function stamp(s,date){const v=s.length===5?date+'T'+s:s;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)||!dateValid(v.slice(0,10))||Number(v.slice(11,13))>23||Number(v.slice(14))>59)fail('Invalid date/time: '+v);return v+':00';}
export function parseVisible(text){
  let date='',target='',zone='floating',plan='',mode='',last=null;const entries=[],preserved=[];
  for(const [n,line] of text.split(/\r?\n/).entries()){
    const s=line.trim();if(!s||s.startsWith('//'))continue;
    const uid=/^\s+#uid=(.+)$/.exec(line);if(uid){if(!last||last.uid)fail('Line '+(n+1)+': misplaced UID');last.uid=uid[1];continue;}
    if(/^#(task|event)$/.test(s)){mode=s.slice(1);last=null;continue;}
    const h=/^#(date|calendar|timezone|plan|preserved)=(.+)$/.exec(s);
    if(h){last=null;const k=h[1],v=h[2];if(k==='date'){if(!dateValid(v))fail('Invalid date');date=v;}if(k==='calendar')target=v;if(k==='timezone')zone=v;if(k==='plan'){if(plan&&plan!==v)fail('Multiple plan IDs');plan=v;}if(k==='preserved')preserved.push(v);continue;}
    const m=/^(\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2})-(\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\s+(.+)$/.exec(s);
    if(!m||!mode||!date||!target)fail('Line '+(n+1)+': expected date, calendar, section and time range');
    let title=m[3];if(title.startsWith('"')){try{title=JSON.parse(title);}catch{fail('Invalid quoted title');}}
    const start=stamp(m[1],date),end=stamp(m[2],date);if(end<start||(mode==='event'&&end===start))fail('End must follow start (use full dates for overnight items)');
    if(typeof title!=='string'||!title.trim())fail('Empty title');
    last={type:mode,title,start,end,calendar:target,zone,uid:null};entries.push(last);
  }
  if(!date||!target)fail('Choose #date and #calendar');
  if(entries.some(x=>x.calendar!==target))fail('One target calendar per document');
  const ids=[...entries.filter(x=>x.uid).map(x=>x.uid),...preserved];if(new Set(ids).size!==ids.length)fail('Duplicate UID');
  return {date,calendar:target,zone,plan,entries,preserved};
}
function setTime(c,name,value,zone){const old=c.getFirstProperty(name),p=old?new ICAL.Property(JSON.parse(JSON.stringify(old.toJSON()))):new ICAL.Property(name);p.removeParameter('tzid');p.setValue(ICAL.Time.fromDateTimeString(value+(zone==='UTC'?'Z':'')));if(zone!=='UTC'&&zone!=='floating')p.setParameter('tzid',zone);c.removeAllProperties(name);c.addProperty(p);}
export function compile(text,identities={}){
  const parts=splitDocument(text),parsed=parseVisible(parts.visible),c=parts.ics?calendar(parts.ics):new ICAL.Component('vcalendar');
  if(!c.hasProperty('version'))c.addPropertyWithValue('version','2.0');if(!c.hasProperty('prodid'))c.addPropertyWithValue('prodid','-//ZhouAndrew//Text Planner//EN');
  const prior=new Map();for(const o of objects(c)){if(o.hasProperty('recurrence-id'))continue;const uid=o.getFirstPropertyValue('uid');if(!uid||prior.has(uid))fail('Missing or duplicate ICS UID');prior.set(uid,o);}
  for(const o of objects(c))if(o.hasProperty('recurrence-id')&&!prior.has(o.getFirstPropertyValue('uid')))fail('Orphan recurrence exception');
  const plan=parsed.plan||identities.plan;if(!plan||/[\r\n]/.test(plan))fail('Plan identity required');
  const used=new Set(parsed.preserved);for(const uid of parsed.preserved)if(!prior.has(uid))fail('Preserved UID absent from ICS');
  for(const [i,e] of parsed.entries.entries()){
    const uid=e.uid||identities.uids?.[i];if(!uid||/[\r\n]/.test(uid)||used.has(uid))fail('Stable unique UID required');used.add(uid);let o=prior.get(uid);
    if(e.uid&&!o)fail('UID has no embedded ICS; do not guess identity');if(o&&o.name!==(e.type==='task'?'vtodo':'vevent'))fail('Cannot change object type');
    if(!o){o=new ICAL.Component(e.type==='task'?'vtodo':'vevent');o.addPropertyWithValue('uid',uid);c.addSubcomponent(o);}
    o.updatePropertyWithValue('summary',e.title);setTime(o,'dtstart',e.start,e.zone);setTime(o,e.type==='task'?'due':'dtend',e.end,e.zone);o.removeAllProperties('duration');o.updatePropertyWithValue('x-text-planner-plan',plan);
  }
  for(const o of objects(c)){const uid=o.getFirstPropertyValue('uid');if(!used.has(uid))fail('Removing a linked line requires explicit object removal; UID '+uid);o.updatePropertyWithValue('x-text-planner-plan',plan);}
  if(!objects(c).length)fail('No Task/Event in plan');const ics=c.toString(),document=decompile(ics,{date:parsed.date,calendar:parsed.calendar,plan});
  if(semantic(splitDocument(document).ics)!==semantic(ics))fail('Round-trip validation failed');
  return {ics,document,plan,calendar:parsed.calendar,count:objects(c).length};
}
function timeInfo(o,name){const p=o.getFirstProperty(name),v=p?.getFirstValue();if(!v||v.isDate)return null;const value=v.toString().replace(/Z$/,'');if(!value.endsWith(':00'))return null;return {value:value.slice(0,16),zone:p.getParameter('tzid')||(v.zone?.tzid==='UTC'?'UTC':'floating')};}
export function decompile(ics,meta){
  if(!dateValid(meta.date)||!meta.calendar||!meta.plan)fail('Document metadata required');const c=calendar(ics),lines=['#date='+meta.date,'#calendar='+meta.calendar,'#plan='+meta.plan,''],seen=new Set();
  for(const o of objects(c)){
    if(o.hasProperty('recurrence-id'))continue;
    const uid=o.getFirstPropertyValue('uid');if(!uid||seen.has(uid))fail('Missing or duplicate UID');seen.add(uid);
    const a=timeInfo(o,'dtstart'),b=timeInfo(o,o.name==='vtodo'?'due':'dtend'),summary=o.getFirstPropertyValue('summary')||'';
    if(!a||!b||a.zone!==b.zone||b.value<a.value||!summary||o.hasProperty('recurrence-id')){lines.push('#preserved='+uid,'');continue;}
    const date=a.value.slice(0,10);lines.push('#date='+date,'#timezone='+a.zone,o.name==='vtodo'?'#task':'#event');
    const start=a.value.slice(11),end=b.value.slice(0,10)===date?b.value.slice(11):b.value,title=/[\r\n]|^"|^\s|\s$/.test(summary)?JSON.stringify(summary):summary;
    lines.push(start+'-'+end+' '+title,'  #uid='+uid,'');
  }
  return lines.join('\n').trimEnd()+'\n\n'+BEGIN+'\n'+c.toString().trimEnd()+'\n'+END+'\n';
}
export function individualCalendars(ics){
  const c=calendar(ics),groups=new Map();
  for(const o of objects(c)){const uid=o.getFirstPropertyValue('uid');if(!groups.has(uid))groups.set(uid,[]);groups.get(uid).push(o);}
  return [...groups].map(([uid,group])=>{const out=new ICAL.Component('vcalendar');for(const p of c.getAllProperties())out.addProperty(new ICAL.Property(JSON.parse(JSON.stringify(p.toJSON()))));for(const z of c.getAllSubcomponents('vtimezone'))out.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(z.toJSON()))));for(const o of group)out.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(o.toJSON()))));return {uid,ics:out.toString()};});
}
export function combineCalendars(values){const out=new ICAL.Component('vcalendar');out.addPropertyWithValue('version','2.0');out.addPropertyWithValue('prodid','-//ZhouAndrew//Text Planner//EN');const zones=new Map();for(const v of values){const c=calendar(v);for(const z of c.getAllSubcomponents('vtimezone')){const id=z.getFirstPropertyValue('tzid');if(zones.has(id)&&zones.get(id)!==z.toString())fail('Conflicting timezone definitions');if(!zones.has(id)){zones.set(id,z.toString());out.addSubcomponent(z);}}for(const o of objects(c))out.addSubcomponent(o);}return out.toString();}
