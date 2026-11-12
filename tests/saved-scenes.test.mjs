import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SAVED_SCENES, loadSavedScene } from '../saved-scenes.js';

const localFetch = async url => ({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))});

test('saved home preset restores its camera and every furniture reference', async () => {
  const scene=await loadSavedScene('quietcoast',localFetch);
  const catalog=JSON.parse(await readFile(new URL('../assets/furnimesh/catalog.json',import.meta.url),'utf8'));
  const ids=new Set(catalog.map(a=>a.id));
  assert.equal(scene.scene,'quietcoast');
  assert.equal(scene.name,'The Quiet Coast');
  assert.equal(new Set(scene.objects.map(a=>a.id)).size,scene.objects.length);
  assert.deepEqual(scene.camera.pos,[14,22,56]);
  for(const object of scene.objects.filter(a=>a.type==='model')) assert.ok(ids.has(object.model),object.model);
  assert.ok(scene.objects.some(a=>a.name==='Deep floating roof'));
  assert.equal(scene.terrain.water,true);
});

test('reopening the home restores the saved composition after edits', async () => {
  const first=await loadSavedScene('quietcoast',localFetch);
  first.objects.pop();first.camera.pos[0]=900;
  const reopened=await loadSavedScene('quietcoast',localFetch);
  assert.equal(reopened.objects.length,first.objects.length+1);
  assert.equal(reopened.camera.pos[0],14);
  assert.ok(SAVED_SCENES[reopened.scene].file);
});

test('failed preset downloads and invalid documents are reported', async () => {
  await assert.rejects(loadSavedScene('quietcoast',async()=>({ok:false})),/Could not load/);
  await assert.rejects(loadSavedScene('quietcoast',async()=>({ok:true,json:async()=>({})})),/Invalid saved scene/);
});
