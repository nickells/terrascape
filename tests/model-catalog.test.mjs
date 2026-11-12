import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getModelCatalogues } from '../model-catalog.js';

const root = fileURLToPath(new URL('../', import.meta.url));
test('both libraries merge without losing source metadata', async () => {
  const {assets, unavailable} = await getModelCatalogues(
    async () => ({chair:{name:'Chair'}}),
    async () => ({'furnimesh:sofa':{name:'Sofa',url:'./sofa.glb'}}),
  );
  assert.deepEqual(unavailable, []);
  assert.equal(assets.chair.source, 'Poly Haven');
  assert.equal(assets['furnimesh:sofa'].source, 'FurniMesh');
});

test('a remote outage leaves the bundled library usable', async () => {
  const {assets, unavailable} = await getModelCatalogues(
    async () => { throw new Error('offline'); },
    async () => ({'furnimesh:sofa':{name:'Sofa'}}),
  );
  assert.deepEqual(unavailable, ['Poly Haven']);
  assert.equal(Object.keys(assets).length, 1);
});

test('a bundled catalog failure leaves Poly Haven usable', async () => {
  const {assets, unavailable} = await getModelCatalogues(
    async () => ({chair:{name:'Chair'}}),
    async () => { throw new Error('unavailable'); },
  );
  assert.deepEqual(unavailable, ['FurniMesh']);
  assert.equal(assets.chair.name, 'Chair');
});

test('saved coastal scene resolves every third-party model', () => {
  const scene = JSON.parse(readFileSync(path.join(root, 'scenes/the-quiet-coast.tsc'), 'utf8'));
  const furniture = JSON.parse(readFileSync(path.join(root, 'assets/furnimesh/catalog.json'), 'utf8'));
  const ids = new Set(furniture.map(asset => asset.id));
  assert.equal(new Set(scene.objects.map(o => o.id)).size, scene.objects.length);
  for (const object of scene.objects.filter(o => o.type === 'model')) assert.ok(ids.has(object.model), object.model);
});

test('FurniMesh retains its own license and public source URLs', async () => {
  const entries = JSON.parse(readFileSync(path.join(root, 'assets/furnimesh/catalog.json'), 'utf8'));
  const supplied = Object.fromEntries(entries.map(entry => [entry.id,entry]));
  const {assets} = await getModelCatalogues(async () => ({}),async () => supplied);
  for (const entry of entries) {
    assert.match(assets[entry.id].license, /FurniMesh/);
    assert.notEqual(assets[entry.id].license, 'CC0');
    assert.match(entry.download_url, /^https:\/\/storage.googleapis.com\/furnimesh-3d\/gbl-files\/.+\.glb$/);
    const bytes = readFileSync(path.resolve(root, entry.url));
    assert.equal(bytes.toString('utf8',0,4), 'glTF');
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.match(entry.source_url, /^https:\/\/furnimesh.com\/library\//);
  }
});

test('curated seed contains 60 prepared, self-contained models with actual previews', () => {
  const entries = JSON.parse(readFileSync(path.join(root, 'assets/furnimesh/catalog.json'), 'utf8'));
  const selection = JSON.parse(readFileSync(path.join(root, 'assets/furnimesh/seed.json'), 'utf8'));
  assert.equal(selection.length,60);
  assert.equal(new Set(selection.map(a=>a.id)).size,60);
  assert.deepEqual(entries.map(a=>a.id),selection.map(a=>'furnimesh:'+a.id));
  for (const asset of entries) {
    const bytes=readFileSync(path.resolve(root,asset.url));
    assert.equal(bytes.length,asset.bytes,asset.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.id);
    const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    assert.deepEqual(gltf.extensionsRequired||[],[],asset.id);
    for(const part of [...(gltf.images||[]),...(gltf.buffers||[])]) assert.ok(!part.uri,asset.id+' requires an external file');
    assert.ok(asset.polycount>0 && asset.polycount<=asset.original_polycount,asset.id);
    assert.ok(asset.displayHeight>0 && Number.isFinite(asset.displayHeight),asset.id);
    assert.match(asset.thumbnail_url,/^\.\/assets\/furnimesh\/.+\.png$/);
    const png=readFileSync(path.resolve(root,asset.thumbnail_url));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),256);
    assert.match(asset.source_photo_url,/^https:\/\//);
  }
});

test('additional curated assets retain their individual source and license', async () => {
  const entries=JSON.parse(readFileSync(path.join(root,'assets/models/catalog.json'),'utf8'));
  const supplied=Object.fromEntries(entries.map(a=>[a.id,a]));
  const {assets,unavailable}=await getModelCatalogues(async()=>({}),async()=>({}),async()=>supplied);
  assert.deepEqual(unavailable,[]);
  assert.equal(assets['local:oil-palm'].source,'Innerscene');
  assert.equal(assets['local:oil-palm'].license,'CC0');
  assert.equal(assets['local:oil-palm'].curated,true);
  for(const asset of entries){
    const data=readFileSync(path.resolve(root,asset.url));
    assert.equal(createHash('sha256').update(data).digest('hex'),asset.sha256);
    assert.equal(data.readUInt32LE(8),data.length);
    const gltf=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
    assert.deepEqual(gltf.extensionsRequired||[],[]);
    assert.ok(gltf.nodes.some(node=>node.extras?.license==='CC0-1.0'));
    assert.ok(readFileSync(path.resolve(root,asset.thumbnail_url)).length>0);
  }
});

test('an additional catalog outage leaves existing libraries available', async () => {
  const {assets,unavailable}=await getModelCatalogues(async()=>({tree:{name:'Tree'}}),async()=>({}),async()=>{throw new Error('offline');});
  assert.deepEqual(unavailable,['Curated models']);
  assert.equal(assets.tree.source,'Poly Haven');
});


test('category filters combine source vocabularies', async () => {
  const {assets}=await getModelCatalogues(
    async()=>({lamp:{name:'Lamp',categories:['lighting','table']}}),
    async()=>({'furnimesh:lamp':{name:'Lamp',categories:['Lighting','Tables']}}),
  );
  assert.deepEqual(assets.lamp.categories,assets['furnimesh:lamp'].categories);
});
