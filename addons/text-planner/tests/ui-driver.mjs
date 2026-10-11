const $=id=>document.getElementById(id),checks=[];
function assert(v,label){if(!v)throw Error(label);checks.push(label);}
async function wait(fn,label){const start=Date.now();while(Date.now()-start<20000){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('UI timeout '+label+': '+$('status').textContent);}
try{
 await new Promise(r=>setTimeout(r,800));
 $('new').click();await wait(()=>$('newdialog').open,'new dialog');
 assert($('date').required&&$('calendar').required,'new file requires date and calendar');
 $('date').value='2026-10-11';const cs=await browser.TextPlanner.calendars();const c=cs.find(x=>x.name==='Text Planner UI Acceptance');$('calendar').value=c.id;$('create').click();await wait(()=>$('source').value.includes('#calendar='+c.id),'template');
 assert($('source').value.includes('#date=2026-10-11')&&$('source').value.includes('#calendar='+c.id),'chosen metadata is written into template');
 $('source').value+='#task\n09:00-09:35 UI Task\n09:05-09:40 UI Overlap\n#event\n14:00-15:00 UI Event\n';$('source').dispatchEvent(new Event('input'));
 assert($('preview').querySelectorAll('.card').length===3,'live preview parses three objects');
 $('save').click();await wait(()=>$('status').textContent.includes('TXT 已保存'),'save');
 $('activate').click();await wait(()=>$('status').textContent.includes('已激活 3'),'activate');
 assert($('icsarea').hidden&&$('ics').value.includes('BEGIN:VCALENDAR'),'ICS saved and hidden by default');
 $('showics').click();assert(!$('icsarea').hidden,'ICS can be shown');$('showics').click();assert($('icsarea').hidden,'ICS can be hidden');
 $('deactivate').click();await wait(()=>$('deactdialog').open,'deactivate preview');
 assert($('deactsummary').textContent.includes('3 个')&&$('exportpreview').value.includes('UI Task'),'deactivation shows concrete export and deletion count');
 $('confirmdeact').click();await wait(()=>$('status').textContent.includes('快照已保存'),'deactivate');
 $('activate').click();await wait(()=>$('status').textContent.includes('已激活 3'),'reactivate');
 assert($('filename').textContent.includes('plan.deactivated.txt'),'reactivation uses saved deactivation file');
 $('saveas').click();await wait(()=>$('status').textContent.includes('TXT 已保存'),'save as');
 $('open').click();await wait(()=>$('source').value.includes('UI Task')&&!$('activate').disabled,'open');
 assert($('ics').value.includes('BEGIN:VCALENDAR'),'opening TXT restores embedded ICS');
 await browser.runtime.sendMessage({uiAcceptance:{ok:true,checks}});
}catch(e){await browser.runtime.sendMessage({uiAcceptance:{ok:false,message:e.message,stack:e.stack,checks}});}
