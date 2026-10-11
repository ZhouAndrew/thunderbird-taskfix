import {BEGIN,END,splitDocument,parseVisible,compile} from '../core/codec.mjs';
const $=id=>document.getElementById(id);let file=null,name='',hidden='',busy=false,dirty=false,pending=null;
function text(){return $('source').value.trimEnd()+(hidden?'\n\n'+BEGIN+'\n'+hidden.trimEnd()+'\n'+END+'\n':'\n');}
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function install(value){const p=splitDocument(value);$('source').value=p.visible+'\n';hidden=p.ics;$('ics').value=hidden;dirty=false;preview();}
function filename(){ $('filename').textContent=(name||'未保存计划')+(dirty?' · 已修改':'');}
function preview(){filename();try{const p=parseVisible($('source').value);compile(text(),{plan:p.plan||'preview',uids:p.entries.map((e,i)=>e.uid||'preview-'+i)});$('preview').replaceChildren();for(const e of p.entries){const c=document.createElement('div');c.className='card';const title=document.createElement('strong');title.textContent=e.title;const detail=document.createElement('small');detail.textContent=(e.type==='task'?'Task':'Event')+' · '+e.start+' → '+e.end+' · '+e.zone;c.append(title,detail);$('preview').append(c);}if(p.preserved.length){const c=document.createElement('p');c.textContent=p.preserved.length+' 个复杂对象保留在完整 ICS 中';$('preview').append(c);}status('解析成功；'+(p.entries.length+p.preserved.length)+' 个对象');}catch(e){$('preview').textContent=e.message;status(e.message,true);}}
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('nav button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message,true);}finally{busy=false;document.querySelectorAll('nav button').forEach(b=>b.disabled=false);}}
function discard(){return !dirty||confirm('当前修改尚未保存，继续打开其他文件？');}
$('source').addEventListener('input',()=>{dirty=true;preview();});
$('showics').addEventListener('change',()=>{$('icsarea').hidden=!$('showics').checked;});
$('new').onclick=()=>run(async()=>{if(!discard())return;const cs=await browser.TextPlanner.calendars();$('calendar').replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='请选择可写日历';$('calendar').append(blank);for(const c of cs){const o=document.createElement('option');o.value=c.id;o.textContent=c.name+(c.tasks&&c.events?'':'（仅部分类型）');$('calendar').append(o);}const d=new Date();$('date').value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');$('newdialog').showModal();});
$('newdialog').addEventListener('close',()=>{if($('newdialog').returnValue!=='create')return;file=null;name='';install('#date='+$('date').value+'\n#calendar='+$('calendar').value+'\n#timezone=floating\n\n#task\n\n#event\n');dirty=true;filename();status('模板已创建，添加任务或事件后激活');});
$('open').onclick=()=>run(async()=>{if(!discard())return;const r=await browser.TextPlanner.open();file=r.file;name=r.name;install(r.text);});
async function save(as){const r=await browser.TextPlanner.save(text(),as?undefined:file||undefined);file=r.file;name=r.name;dirty=false;filename();status('TXT 已保存并读取验证');}
$('save').onclick=()=>run(()=>save(false));$('saveas').onclick=()=>run(()=>save(true));
$('activate').onclick=()=>run(async()=>{const r=await browser.TextPlanner.activate(text(),file||undefined);file=r.file;name=r.name;install(r.document);status('已激活 '+r.count+' 个对象；写入、读取、比较、收据已完成');});
$('deactivate').onclick=()=>run(async()=>{pending=await browser.TextPlanner.prepareDeactivate(text());$('deactsummary').textContent='将保存最新快照并删除 '+pending.count+' 个关联对象。'+(pending.missing.length?'已有 '+pending.missing.length+' 个对象不存在，不会复活。':'');$('exportpreview').value=pending.document;$('deactdialog').showModal();});
$('canceldeact').onclick=()=>{$('deactdialog').close();pending=null;};
$('confirmdeact').onclick=()=>{const p=pending;pending=null;$('deactdialog').close();run(async()=>{const r=await browser.TextPlanner.finishDeactivate(p.token);file=r.file;name=r.name;install(r.document);status('快照已保存；'+r.count+' 个对象已删除并读取验证。可再次激活恢复。');});};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
