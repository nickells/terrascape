import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the same generator the editor and tracer use, without loading WebGL.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('let seed = 1;'), html.indexOf('// ---------- scene ----------'));
function generator(settings) {
  const context = vm.createContext({});
  vm.runInContext(source + `
    terr = terrainSettings(${JSON.stringify(settings)});
    seed = 1234; rand.seed(seed); phase = rand() * 10;
    globalThis.generator = {
      settings: terr,
      height: heightAt,
      restore: value => { terr = terrainSettings(value); return terr; },
    };
  `, context);
  return context.generator;
}
const points = [[0, 0], [30, 270], [-300, -900], [900, 100], [0, 1500], [1000, -1400]];
const heights = g => points.map(([x, z]) => g.height(x, z));

for (const [name, settings] of Object.entries({
  river: { riverWidth: 380 },
  basin: { riverWidth: 0, basin: 1 },
  coast: { riverWidth: 0, coast: 1 },
  clearing: { riverWidth: 0, stage: 260, stageFloor: -14 },
  archipelago: { waterY: 80, riverWidth: 0, coast: .6, basin: .4 },
})) {
  test(`${name}: moving water or a floor does not reshape terrain`, () => {
    const g = generator(settings), before = heights(g);
    assert.ok(before.every(Number.isFinite));
    for (const level of [-60, 0, 50, 200]) {
      g.settings.waterY = level;
      assert.deepEqual(heights(g), before);
    }
  });
}

test('legacy scenes retain their initial terrain reference when first loaded', () => {
  const g = generator({ waterY: 80 });
  assert.equal(g.settings.landLevel, 80);
  const before = heights(g);
  g.settings.waterY = -20;
  const restored = g.restore(JSON.parse(JSON.stringify(g.settings)));
  assert.equal(restored.landLevel, 80);
  assert.equal(restored.waterY, -20);
  assert.deepEqual(heights(g), before);
});

test('terrain controls still change the terrain independently', () => {
  const g = generator({ stage: 260, stageFloor: -14, riverWidth: 0 });
  const before = g.height(0, 270);
  g.settings.stageFloor = 10;
  assert.notEqual(g.height(0, 270), before);
});
