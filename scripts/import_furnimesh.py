#!/usr/bin/env python3
"""Import a public, free FurniMesh GLB into Terrascape's catalog.

Usage: python3 scripts/import_furnimesh.py MODEL_PAGE --id NAME --height 11
Requires Python 3 and macOS sips for embedded texture resizing.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 100 * 1024 * 1024


class ModelPage(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ''
        self.image = ''
        self.downloads = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'h1': self.in_title = True
        if tag == 'meta' and attrs.get('property') == 'og:image':
            self.image = attrs.get('content', '')
        if tag == 'a':
            href = attrs.get('href', '')
            parsed = urlparse(href)
            if (parsed.scheme == 'https' and parsed.netloc == 'storage.googleapis.com'
                    and parsed.path.startswith('/furnimesh-3d/') and parsed.path.endswith('.glb')):
                self.downloads.append(href)

    def handle_endtag(self, tag):
        if tag == 'h1': self.in_title = False

    def handle_data(self, data):
        if self.in_title: self.title += data


def parse_model_page(html):
    page = ModelPage()
    page.feed(html)
    if not page.downloads:
        raise ValueError('No public GLB download link found. Paid or account-only models are not imported.')
    return {'name': re.sub(r'\s+3D Model\s*$', '', page.title).strip(),
            'download_url': page.downloads[0], 'thumbnail_url': page.image}


def request_bytes(url, max_bytes=MAX_BYTES):
    request = Request(url, headers={'User-Agent': 'Terrascape model importer'})
    with urlopen(request, timeout=45) as response:
        if int(response.headers.get('Content-Length', '0')) > max_bytes:
            raise ValueError('Model exceeds the importer size limit')
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes: raise ValueError('Download exceeds the importer size limit')
    return data


def unpack_glb(data):
    if len(data) < 28 or data[:4] != b'glTF' or struct.unpack_from('<I', data, 4)[0] != 2:
        raise ValueError('Expected a glTF 2 binary model')
    if struct.unpack_from('<I', data, 8)[0] != len(data): raise ValueError('Incomplete GLB download')
    length, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4e4f534a: raise ValueError('Missing GLB JSON chunk')
    model = json.loads(data[20:20+length])
    offset = 20 + length
    binary_length, kind = struct.unpack_from('<II', data, offset)
    if kind != 0x004e4942: raise ValueError('Missing GLB binary chunk')
    binary = data[offset+8:offset+8+binary_length]
    if model.get('extensionsRequired'): raise ValueError('Model needs an unsupported GLTF extension')
    if any(item.get('uri') for item in model.get('buffers', []) + model.get('images', [])):
        raise ValueError('Model must contain its geometry and textures in a single GLB')
    for view in model.get('bufferViews', []):
        if view.get('byteOffset', 0) + view['byteLength'] > len(binary):
            raise ValueError('Model buffer is out of range')
    return model, binary


def prepare_glb(data, texture_size=1024):
    model, original = unpack_glb(data)
    triangles = sum(model['accessors'][p['indices']]['count']//3 if 'indices' in p
                    else model['accessors'][p['attributes']['POSITION']]['count']//3
                    for mesh in model.get('meshes', []) for p in mesh['primitives'])
    if triangles > 1_000_000: raise ValueError('Model exceeds the one-million-triangle import budget')
    images = {image['bufferView']: image for image in model.get('images', [])}
    binary = bytearray()
    with tempfile.TemporaryDirectory(prefix='terrascape-textures-') as temporary:
        for i, view in enumerate(model['bufferViews']):
            start = view.get('byteOffset', 0)
            payload = original[start:start+view['byteLength']]
            if i in images and texture_size:
                if not shutil.which('sips'): raise ValueError('Texture preparation requires macOS sips')
                raw, resized = Path(temporary)/f'{i}.image', Path(temporary)/f'{i}.png'
                raw.write_bytes(payload)
                subprocess.run(['sips', '-Z', str(texture_size), '-s', 'format', 'png', str(raw), '--out', str(resized)],
                               check=True, capture_output=True)
                payload = resized.read_bytes()
                images[i]['mimeType'] = 'image/png'
            binary.extend(b'\0' * (-len(binary) % 4))
            view['byteOffset'], view['byteLength'] = len(binary), len(payload)
            binary.extend(payload)
    model['buffers'][0]['byteLength'] = len(binary)
    binary.extend(b'\0' * (-len(binary) % 4))
    encoded = json.dumps(model, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    result = (struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(binary))
              + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
              + struct.pack('<II', len(binary), 0x004e4942) + binary)
    return result, triangles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('page')
    parser.add_argument('--id', required=True, help='Stable catalog key; existing scene references keep working')
    parser.add_argument('--height', type=float, default=11, help='Displayed height in scene units')
    parser.add_argument('--name', help='Short label for the model browser')
    parser.add_argument('--category', default='Furniture')
    parser.add_argument('--texture-size', type=int, default=1024)
    args = parser.parse_args()
    parsed = urlparse(args.page)
    if parsed.scheme != 'https' or parsed.netloc not in ('furnimesh.com', 'www.furnimesh.com') or not parsed.path.startswith('/library/'):
        parser.error('Use a public FurniMesh library model page')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', args.id): parser.error('ID must contain lowercase letters, numbers and hyphens')
    if not 0 < args.height <= 200: parser.error('Displayed height must be between 0 and 200')
    if not 128 <= args.texture_size <= 4096: parser.error('Texture size must be between 128 and 4096')
    entry = parse_model_page(request_bytes(args.page, 8*1024*1024).decode('utf-8'))
    cache = Path(tempfile.gettempdir())/'terrascape-model-imports'
    cache.mkdir(exist_ok=True)
    raw_path = cache/(hashlib.sha256(entry['download_url'].encode()).hexdigest()+'.glb')
    if not raw_path.exists(): raw_path.write_bytes(request_bytes(entry['download_url']))
    original = raw_path.read_bytes()
    optimized, triangles = prepare_glb(original, args.texture_size)
    directory = ROOT/'assets/furnimesh'
    directory.mkdir(parents=True, exist_ok=True)
    model_file = directory/f'{args.id}.glb'
    model_file.write_bytes(optimized)
    entry.update(id=f'furnimesh:{args.id}', name=args.name or entry['name'], source='FurniMesh',
                 categories=[args.category], tags=re.findall(r'[a-z]+', (args.name or entry['name']).lower()),
                 license='FurniMesh commercial-use license', source_url=args.page,
                 license_url='https://furnimesh.com/terms/', url=f'./assets/furnimesh/{args.id}.glb',
                 polycount=triangles, displayHeight=args.height,
                 original_bytes=len(original), bytes=len(optimized), texture_size=args.texture_size,
                 sha256=hashlib.sha256(optimized).hexdigest())
    catalog_file = directory/'catalog.json'
    catalog = json.loads(catalog_file.read_text()) if catalog_file.exists() else []
    old = next((i for i, item in enumerate(catalog) if item['id'] == entry['id']), None)
    if old is None: catalog.append(entry)
    else:
        if not entry['thumbnail_url']: entry['thumbnail_url'] = catalog[old].get('thumbnail_url', '')
        catalog[old] = entry
    catalog_file.write_text(json.dumps(catalog, indent=2)+'\n')
    print(f"Imported {entry['name']}: {triangles:,} triangles, {len(optimized)/1e6:.1f} MB. Catalog updated.")


if __name__ == '__main__': main()
