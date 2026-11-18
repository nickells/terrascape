import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CLIP, DRIFT, cameraAt, timeAt } from '../motion.js';

const base = { pos: [-10, 150, 560], target: [0, 125, 0], fov: 40 };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const dist = (c, f = c.target) => Math.hypot(c.pos[0] - f[0], c.pos[2] - f[2]);

test('t = 0 is the base camera for every preset except the sweep, which is centred on it', () => {
  for (const p of PRESETS.filter(p => p.key !== 'sweep')) {
    const c = cameraAt(base, p.spec(p.amt), 0);
    c.pos.forEach((v, i) => near(v, base.pos[i])); c.target.forEach((v, i) => near(v, base.target[i])); near(c.fov, base.fov);
  }
});

test('zoom magnifies by the requested factor at t = 1 and out is the inverse', () => {
  const tanHalf = f => Math.tan(f * Math.PI / 360);
  near(tanHalf(base.fov) / tanHalf(cameraAt(base, { zoom: 1.5 }, 1).fov), 1.5);
  near(tanHalf(cameraAt(base, { zoom: 1 / 1.5 }, 1).fov) / tanHalf(base.fov), 1.5);
  assert.ok(cameraAt(base, { zoom: 1.15 }, 0.5).fov < base.fov);   // zooming in narrows the lens
  assert.deepEqual(cameraAt(base, { zoom: 1.5 }, 1).pos, base.pos);   // a lens zoom never moves the camera
});

test('zoom is steady: equal steps in t give equal steps in magnification', () => {
  const m = t => Math.tan(base.fov * Math.PI / 360) / Math.tan(cameraAt(base, { zoom: 1.4 }, t).fov * Math.PI / 360);
  near(m(0.5) / m(0.25), m(0.75) / m(0.5));
});

test('orbit keeps height and radius, and 360 returns to the start', () => {
  for (const t of [0.1, 0.37, 0.5, 0.9]) {
    const c = cameraAt(base, { orbit: 360 }, t);
    near(c.pos[1], base.pos[1]); near(dist(c), dist({ pos: base.pos }, base.target), 1e-6);
  }
  const half = cameraAt(base, { orbit: 360 }, 0.5);   // opposite side of the target
  near(half.pos[0], 2 * base.target[0] - base.pos[0], 1e-6); near(half.pos[2], 2 * base.target[2] - base.pos[2], 1e-6);
  const full = cameraAt(base, { orbit: 360 }, 1);
  near(full.pos[0], base.pos[0], 1e-6); near(full.pos[2], base.pos[2], 1e-6);
});

test('a focus is circled and looked at, at the camera\'s own distance from it', () => {
  const focus = [-82, 18, 235];
  for (const t of [0, 0.3, 0.8]) {
    const c = cameraAt(base, { orbit: 360, focus }, t);
    assert.deepEqual(c.target, focus); near(dist(c, focus), Math.hypot(base.pos[0] - focus[0], base.pos[2] - focus[2]), 1e-6);
  }
});

test('sweep is centred on the start view: the middle is the base, the ends are equal angles either side', () => {
  const sw = { orbit: [-15, 15] }, lo = cameraAt(base, sw, 0), hi = cameraAt(base, sw, 1), mid = cameraAt(base, sw, 0.5);
  mid.pos.forEach((v, i) => near(v, base.pos[i], 1e-9));
  const heading = c => Math.atan2(c.pos[0] - c.target[0], c.pos[2] - c.target[2]);
  near(heading(hi) - heading(base), -(heading(lo) - heading(base)), 1e-9); near(Math.abs(heading(hi) - heading(base)), 15 * Math.PI / 180, 1e-9);
});

test('timeAt: loops stop one frame short, other motions reach the end', () => {
  near(timeAt(0, 120, true), 0); near(timeAt(119, 120, true), 119 / 120);
  near(timeAt(0, 120), 0); near(timeAt(119, 120), 1);
  near(timeAt(0, 1), 0);
});

test('clip defaults: 5 s at 24 fps is 120 frames, inside the cap', () => {
  assert.equal(CLIP.seconds * CLIP.fps, 120); assert.ok(CLIP.seconds * CLIP.fps <= CLIP.maxFrames);
});

test('camera still holds the base camera for the whole clip, so only the weather moves', () => {
  const still = PRESETS.find(p => p.key === 'still');
  for (const t of [0, 0.5, 1]) {
    const c = cameraAt(base, still.spec(still.amt), t);
    assert.deepEqual(c.pos, base.pos); assert.deepEqual(c.target, base.target); near(c.fov, base.fov);
  }
});

test('drift amounts for a 5 s clip match the script defaults (600 clouds units is the script\'s, 500 here; 1.5 sky; 3 water)', () => {
  near(DRIFT.sky * CLIP.seconds, 1.5); near(DRIFT.water * CLIP.seconds, 3); near(DRIFT.clouds * CLIP.seconds, 500);
});
