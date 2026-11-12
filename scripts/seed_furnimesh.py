#!/usr/bin/env python3
"""Rebuild Terrascape's curated FurniMesh seed from its checked-in selection."""
import argparse
import concurrent.futures
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
from import_furnimesh import ROOT, parse_model_page, prepare_glb, request_bytes, unpack_glb


def prepare_choice(choice, triangle_budget):
    cache = Path(tempfile.gettempdir())/'terrascape-model-imports'
    cache.mkdir(exist_ok=True)
    page_file = cache/(hashlib.sha256(choice['page'].encode()).hexdigest()+'.html')
    if not page_file.exists(): page_file.write_bytes(request_bytes(choice['page'],8*1024*1024))
    metadata = parse_model_page(page_file.read_text())
    original_file = cache/(hashlib.sha256(metadata['download_url'].encode()).hexdigest()+'.glb')
    if not original_file.exists(): original_file.write_bytes(request_bytes(metadata['download_url']))
    original = original_file.read_bytes()
    prepared, original_triangles = prepare_glb(original,1024)
    with tempfile.TemporaryDirectory(prefix='terrascape-seed-') as temporary:
        input_file, output_file = Path(temporary)/'source.glb', Path(temporary)/'prepared.glb'
        input_file.write_bytes(prepared)
        process = subprocess.run(['node',str(ROOT/'scripts/simplify_model.mjs'),str(input_file),str(output_file),str(triangle_budget)],
                                 capture_output=True,text=True,check=True,cwd=ROOT)
        report = json.loads(process.stdout.strip().splitlines()[-1])
        final = output_file.read_bytes()
    unpack_glb(final)
    height = choice['height']
    dimensions = [b-a for a,b in zip(report['min'],report['max'])]
    if choice.get('width'):
        height = choice['width'] * dimensions[1] / max(dimensions[0], dimensions[2])
    if not math.isfinite(height) or height <= 0: raise ValueError('Invalid normalized dimensions')
    directory = ROOT/'assets/furnimesh'
    filename = directory/(choice['id']+'.glb')
    temporary = filename.with_suffix('.glb.tmp')
    temporary.write_bytes(final); temporary.replace(filename)
    return dict(id='furnimesh:'+choice['id'],name=choice['name'],source='FurniMesh',
                categories=[choice['category']],tags=choice.get('tags',[])+choice['name'].lower().replace('-',' ').split(),
                license='FurniMesh commercial-use license',license_url='https://furnimesh.com/terms/',
                source_url=choice['page'],download_url=metadata['download_url'],
                thumbnail_url=choice['thumbnail_url'],source_photo_url=choice['thumbnail_url'],
                url='./assets/furnimesh/'+filename.name,polycount=report['polycount'],original_polycount=original_triangles,
                displayHeight=height,original_bytes=len(original),bytes=len(final),texture_size=1024,
                triangle_budget=triangle_budget,simplification_error=.001,sha256=hashlib.sha256(final).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers',type=int,default=2)
    parser.add_argument('--triangle-budget',type=int,default=80000)
    parser.add_argument('--refresh',action='store_true',help='Rebuild even when this seed entry is already prepared')
    args = parser.parse_args()
    if not 1 <= args.workers <= 4: parser.error('Use one to four workers')
    if not 10000 <= args.triangle_budget <= 1000000: parser.error('Triangle budget must be between 10,000 and 1,000,000')
    if not (ROOT/'node_modules/@gltf-transform/core').exists(): parser.error('Run npm install before preparing a seed')
    directory=ROOT/'assets/furnimesh';plan=json.loads((directory/'seed.json').read_text())
    if len(set(choice['id'] for choice in plan)) != len(plan): parser.error('Duplicate model IDs in the selection')
    catalog_file=directory/'catalog.json'
    existing={entry['id']:entry for entry in json.loads(catalog_file.read_text())}
    selected={}
    pending=[]
    for choice in plan:
        entry=existing.get('furnimesh:'+choice['id'])
        if (not args.refresh and entry and entry.get('triangle_budget')==args.triangle_budget
                and entry.get('source_url')==choice['page'] and (ROOT/entry['url']).exists()):
            selected[entry['id']]={**entry, 'name':choice['name'], 'categories':[choice['category']],
                                   'displayHeight':choice['height'] if not choice.get('width') else entry['displayHeight']}
        else: pending.append(choice)
    failures=[]
    def save():
        # Preserve unrelated user-curated entries while checkpointing each completed model.
        merged={**existing,**selected}
        order=['furnimesh:'+choice['id'] for choice in plan]
        records=[merged[key] for key in order if key in merged]
        records.extend(entry for key,entry in merged.items() if key not in order)
        temporary=catalog_file.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(records,indent=2)+'\n');temporary.replace(catalog_file)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures={pool.submit(prepare_choice,choice,args.triangle_budget):choice for choice in pending}
        for future in concurrent.futures.as_completed(futures):
            choice=futures[future]
            try:
                entry=future.result();selected[entry['id']]=entry;save()
                print(f"{len(selected)}/{len(plan)} {entry['name']} — {entry['polycount']:,} triangles, {entry['bytes']/1e6:.1f} MB",flush=True)
            except Exception as error:
                failures.append({'id':choice['id'],'error':str(error)})
                print(f"FAILED {choice['name']}: {error}",flush=True)
    (directory/'seed-report.json').write_text(json.dumps(dict(selected=len(plan),ready=len(selected),failures=failures),indent=2)+'\n')
    save()
    if failures: raise SystemExit(1)
    print(f"Ready: {len(selected)} curated FurniMesh models.")


if __name__=='__main__':main()
