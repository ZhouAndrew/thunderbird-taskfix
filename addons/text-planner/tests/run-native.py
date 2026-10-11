#!/usr/bin/env python3
"""Runs the actual production boundary/core in an isolated Thunderbird profile.
Acceptance-only instrumentation bypasses interactive file pickers with explicit
profile-local paths. No user profile or user calendar is opened.
"""
import json,os,sys,tempfile,zipfile,subprocess,time,threading,urllib.request,urllib.error,socket
from pathlib import Path
from http.server import BaseHTTPRequestHandler,HTTPServer
root=Path(__file__).resolve().parents[1]
output=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'native-report.json'
binary=os.environ.get('TB_BINARY','thunderbird')
with tempfile.TemporaryDirectory(prefix='text-planner-acceptance-') as tmp:
 tmp=Path(tmp); profile=tmp/'profile'; (profile/'extensions').mkdir(parents=True)
 result=[]
 radicale=None;davurl=None
 if os.environ.get('TEST_CALDAV')=='1':
  sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
  rights=tmp/'rights';rights.write_text('[all]\nuser = .*\ncollection = .*\npermissions = RrWw\n')
  config=tmp/'radicale.conf';config.write_text(f'[server]\nhosts = 127.0.0.1:{port}\n[auth]\ntype = none\n[rights]\ntype = from_file\nfile = {rights}\n[storage]\nfilesystem_folder = {tmp}/radicale-data\n[logging]\nlevel = info\n')
  radicale=subprocess.Popen([sys.executable,'-m','radicale','-C',str(config)],stdout=(tmp/'radicale.log').open('w'),stderr=subprocess.STDOUT)
  davurl=f'http://127.0.0.1:{port}/test/calendar/'
  for attempt in range(80):
   try:
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:opener.open(urllib.request.Request(f'http://127.0.0.1:{port}/test/',method='MKCOL'))
    except urllib.error.HTTPError as e:
     if e.code!=405:raise
    request=urllib.request.Request(davurl,data=b'<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype></D:prop></D:set></D:mkcol>',method='MKCOL',headers={'Content-Type':'application/xml'})
    urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request);break
   except Exception as e:
    last_error=str(e);time.sleep(.1)
  else:raise SystemExit('Radicale startup failed ('+last_error+'): '+(tmp/'radicale.log').read_text())
 class Handler(BaseHTTPRequestHandler):
  def do_POST(self):
   result.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))));self.send_response(204);self.send_header('Access-Control-Allow-Origin','*');self.end_headers()
  def log_message(self,*a):pass
 server=HTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 manifest=json.loads((root/'manifest.json').read_text());manifest['permissions']=['http://127.0.0.1/*','tabs'];schema=json.loads((root/'api/TextPlanner/schema.json').read_text());schema[0]['functions'].append({'name':'acceptance','type':'function','async':True,'parameters':[],'returns':{'type':'any'}})
 implementation=(root/'api/TextPlanner/implementation.js').read_text().replace('const executor=createExecutor(io);','const executor=createExecutor(io);\n'+(root/'tests/native-runner.js').read_text()).replace('calendars:serial(',"acceptance:serial(async()=>{try{return await nativeAcceptance();}catch(e){return {ok:false,message:e.message||String(e),stack:e.stack||String(e)};}}),\n      calendars:serial(")
 if davurl:
  implementation=implementation.replace('async function nativeAcceptance(){', (root/'tests/caldav-runner.js').read_text().replace('__CALDAV_URL__',davurl)+'\nasync function nativeAcceptance(){').replace('return {ok:true,version:Services.appinfo.version,checks,calendarId:c.id};','return {ok:true,version:Services.appinfo.version,checks,caldav:await caldavAcceptance()};')
 # Native UI test uses production event handlers and methods, with deterministic
 # file selections in this acceptance-only package.
 implementation=implementation.replace('const win=Services.wm.getMostRecentWindow', "return PathUtils.join(PathUtils.profileDir,save?'ui-'+name:'ui-plan.txt');\n      const win=Services.wm.getMostRecentWindow",1)
 implementation=implementation.replace('const checks=[],assert=', "const uiCalendar=cal.manager.createCalendar('storage',Services.io.newURI('moz-storage-calendar://'));uiCalendar.name='Text Planner UI Acceptance';cal.manager.registerCalendar(uiCalendar);\n  const checks=[],assert=",1)
 bg=(root/'background.js').read_text()+f'''
let nativeResult;
async function report(r){{await fetch('http://127.0.0.1:{server.server_port}/report',{{method:'POST',body:JSON.stringify(r)}});}}
browser.runtime.onMessage.addListener(async m=>{{if(m.uiAcceptance)await report({{...nativeResult,ui:m.uiAcceptance,ok:nativeResult.ok&&m.uiAcceptance.ok}});}});
setTimeout(async()=>{{try{{nativeResult=await browser.TextPlanner.acceptance();if(!nativeResult.ok)return report(nativeResult);await browser.tabs.create({{url:browser.runtime.getURL('editor/editor.html')}});}}catch(e){{await report({{ok:false,message:e.message||String(e),stack:e.stack||String(e)}});}}}},8000);'''
 overrides={'manifest.json':json.dumps(manifest),'api/TextPlanner/schema.json':json.dumps(schema),'api/TextPlanner/implementation.js':implementation,'background.js':bg,'editor/editor.html':(root/'editor/editor.html').read_text().replace('</body>', '<script type="module" src="../tests/ui-driver.mjs"></script></body>'),'tests/ui-driver.mjs':(root/'tests/ui-driver.mjs').read_text()}
 with zipfile.ZipFile(profile/'extensions'/ (manifest['browser_specific_settings']['gecko']['id']+'.xpi'),'w',zipfile.ZIP_DEFLATED) as z:
  for directory in ['core','vendor','editor','api']:
   for p in (root/directory).rglob('*'):
    if p.is_file():rel=p.relative_to(root).as_posix();z.writestr(rel,overrides.pop(rel,p.read_bytes()))
  overrides.pop('api/TextPlanner/implementation.js',None)
  for p,v in overrides.items():z.writestr(p,v)
 prefs={'app.update.enabled':False,'extensions.autoDisableScopes':0,'extensions.enabledScopes':15,'xpinstall.signatures.required':False,'mail.provider.suppress_dialog_on_startup':True,'mailnews.start_page.url':'about:blank','mailnews.start_page.override_url':'about:blank','browser.shell.checkDefaultBrowser':False,'calendar.timezone.local':'Asia/Taipei','datareporting.healthreport.uploadEnabled':False}
 (profile/'user.js').write_text('\n'.join('user_pref('+json.dumps(k)+','+json.dumps(v)+');' for k,v in prefs.items()))
 env=dict(os.environ,MOZ_DISABLE_CONTENT_SANDBOX='1',MOZ_DISABLE_RDD_SANDBOX='1',MOZ_DISABLE_GPU_SANDBOX='1')
 if not env.get('DISPLAY'):env['MOZ_HEADLESS']='1'
 with (tmp/'stdout.log').open('w') as stdout,(tmp/'stderr.log').open('w') as stderr:
  process=subprocess.Popen([binary,'-no-remote','-profile',str(profile)],env=env,stdout=stdout,stderr=stderr)
  try:
   deadline=time.monotonic()+150
   while not result and process.poll() is None and time.monotonic()<deadline:time.sleep(.25)
  finally:
   process.terminate()
   try:process.wait(timeout=8)
   except subprocess.TimeoutExpired:process.kill();process.wait()
 server.shutdown()
 if radicale:radicale.terminate();radicale.wait(timeout=8)
 if not result:
  if (profile/'stage.txt').exists():print('STAGE:',(profile/'stage.txt').read_text())
  if (tmp/'radicale.log').exists():print((tmp/'radicale.log').read_text()[-8000:])
  print('\n'.join(x for x in (tmp/'stderr.log').read_text().splitlines() if x.strip() and not any(k in x for k in ['Gtk-', 'gtk_', 'WARNING:', 'glib warning', '(thunderbird-esr:', 'Sandbox:']))[-8000:]);print((tmp/'stdout.log').read_text()[-4000:]);raise SystemExit('No acceptance report')
 
 if not result[0].get('ok'):print('\n'.join(x for x in (tmp/'stderr.log').read_text().splitlines() if x.strip() and not any(k in x for k in ['Gtk-', 'gtk_', 'WARNING:', 'glib warning', '(thunderbird-esr:', 'Sandbox:']))[-8000:]);print((tmp/'stdout.log').read_text()[-4000:])
 output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result[0],indent=2)+'\n');print(output.read_text());sys.exit(0 if result[0].get('ok') else 1)
