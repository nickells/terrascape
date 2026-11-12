#!/usr/bin/env python3
"""Install the actual-model PNG previews exported by preview_furnimesh.html."""
import argparse
import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def apply_previews(export_file, catalog_file=None):
    catalog_file = catalog_file or ROOT/'assets/furnimesh/catalog.json'
    directory = catalog_file.parent
    catalog = json.loads(catalog_file.read_text())
    exported = json.loads(Path(export_file).read_text())
    if exported.get('errors'): raise ValueError('Resolve preview errors before installing thumbnails')
    previews = {entry['id']:entry['png'] for entry in exported['previews']}
    if set(previews) != {entry['id'] for entry in catalog}: raise ValueError('Preview IDs do not match the catalog')
    prepared = []
    for entry in catalog:
        ident = entry['id'].split(':',1)[-1]
        if not ident or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in ident): raise ValueError('Invalid asset ID')
        prefix = 'data:image/png;base64,'
        if not previews[entry['id']].startswith(prefix): raise ValueError('Expected PNG preview')
        data = base64.b64decode(previews[entry['id']][len(prefix):],validate=True)
        if data[:8] != b'\x89PNG\r\n\x1a\n': raise ValueError('Invalid PNG')
        prepared.append((directory/(ident+'.png'),data))
        entry['thumbnail_url'] = './'+(directory/(ident+'.png')).relative_to(ROOT).as_posix()
    for filename,data in prepared: filename.write_bytes(data)
    catalog_file.write_text(json.dumps(catalog,indent=2)+'\n')
    print(f'Installed {len(prepared)} actual-model previews.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export_file',type=Path)
    parser.add_argument('--catalog',type=Path)
    args=parser.parse_args()
    apply_previews(args.export_file,args.catalog.resolve() if args.catalog else None)
