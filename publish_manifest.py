import hashlib,json,pathlib
r=pathlib.Path('dist'); m={}
for p in sorted(r.rglob('*')):
 if p.is_file(): m['/'+str(p.relative_to(r)).replace('\\','/')]=hashlib.md5(p.read_bytes()).hexdigest()
pathlib.Path('pages-manifest.json').write_text(json.dumps(m,separators=(',',':')))
print(json.dumps(m))
