#!/usr/bin/env python3
import json,zipfile,sys,hashlib
from pathlib import Path
root=Path(__file__).resolve().parent
manifest=json.loads((root/'manifest.json').read_text())
output=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root.parents[1]/'dist'/('thunderbird-text-planner-'+manifest['version']+'.xpi')
output.parent.mkdir(parents=True,exist_ok=True)
paths=[root/'manifest.json',root/'background.js',root/'LICENSE']
for folder in ['api','core','editor','vendor']:
 paths+=sorted(p for p in (root/folder).rglob('*') if p.is_file())
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in paths:
  info=zipfile.ZipInfo(p.relative_to(root).as_posix(),date_time=(2026,10,11,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,p.read_bytes())
with zipfile.ZipFile(output) as z:
 assert not z.testzip();m=json.loads(z.read('manifest.json'));assert m['browser_specific_settings']['gecko']['id']!='ZhouAndrew.thunderbird-taskfix@addons.thunderbird.net'
 for key in ['schema','parent']:
  for api in m['experiment_apis'].values():
   path=api[key] if key=='schema' else api[key]['script'];assert path in z.namelist()
 assert 'acceptance' not in z.read('api/TextPlanner/schema.json').decode()
 assert 'nativeAcceptance' not in z.read('api/TextPlanner/implementation.js').decode()
print(output)
print(hashlib.sha256(output.read_bytes()).hexdigest())
