import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CLIP, DRIFT, SUN, cameraAt, timeAt, sunAt, sunAtClock, sunClock, dayTimes, skyGrade, declination, seasonDates, declOnDay, daysOfDecl, dayIso, dayOfIso, starMatrix, noonElev, declForNoon, noonSide, defaultLat } from '../motion.js';

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

test('dolly zoom: the camera closes in on the focus while the lens widens, so the focus keeps its size on screen', () => {
  const tan = c => Math.tan(c.fov * Math.PI / 360), dist = (c, f) => Math.hypot(...[0, 1, 2].map(i => c.pos[i] - f[i]));
  const d0 = dist(base, base.target);
  for (const t of [0, 0.25, 0.5, 1]) {
    const c = cameraAt(base, { dolly: 1.6 }, t);
    near(dist(c, base.target) * tan(c), d0 * tan(base), 1e-6);   // apparent size of the focus never changes
    assert.deepEqual(c.target, base.target);
  }
  const end = cameraAt(base, { dolly: 1.6 }, 1);
  near(dist(end, base.target), d0 / 1.6, 1e-6); assert.ok(end.fov > base.fov);
  const back = cameraAt(base, { dolly: 1 / 1.6 }, 1);
  near(dist(back, base.target), d0 * 1.6, 1e-6); assert.ok(back.fov < base.fov);
});

test('dolly zoom heads for a chosen focus, not just the camera target, and never opens the lens past 120 degrees', () => {
  const focus = [-82, 18, 235], c = cameraAt(base, { dolly: 2, focus }, 1);
  near(Math.hypot(c.pos[0] - focus[0], c.pos[1] - focus[1], c.pos[2] - focus[2]), Math.hypot(base.pos[0] - focus[0], base.pos[1] - focus[1], base.pos[2] - focus[2]) / 2, 1e-6);
  assert.ok(cameraAt({ ...base, fov: 90 }, { dolly: 5 }, 1).fov <= 120);
  const p = PRESETS.find(p => p.key === 'dolly-in'), q = PRESETS.find(p => p.key === 'dolly-out');
  assert.ok(p.spec(p.amt).dolly > 1 && q.spec(q.amt).dolly < 1);
});

const angle = (p, q) => { const v = ({ az, elev }) => { const a = az * Math.PI / 180, e = elev * Math.PI / 180; return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]; }, [a, b] = [v(p), v(q)];
  return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI; };
const wrap = d => ((d + 540) % 360) - 180;

test('sun: no time passing leaves the sun where the scene put it, and a day later is the same sun', () => {
  const s0 = { az: 123, elev: 31 }, a = sunAt(s0.az, s0.elev, 0), b = sunAt(s0.az, s0.elev, 24);
  near(a.az, s0.az, 1e-9); near(a.elev, s0.elev, 1e-9);
  near(wrap(b.az - s0.az), 0, 1e-9); near(b.elev, s0.elev, 1e-9);
});

test('sun: it turns 15 degrees an hour from east to west and sinks after noon, at 40 north', () => {
  const noon = { az: 180, elev: 50 }, later = sunAt(noon.az, noon.elev, 1, 40), earlier = sunAt(noon.az, noon.elev, -1, 40);
  near(angle(noon, later), 15, 1e-6); near(angle(noon, earlier), 15, 1e-6);   // an equinox sun sweeps the full 15 degrees
  assert.ok(wrap(later.az - 180) > 0 && wrap(earlier.az - 180) < 0);            // later in the day: further round toward the west
  assert.ok(later.elev < 50 && earlier.elev < 50);                               // either side of noon it is lower
  near(later.elev, earlier.elev, 1e-9); near(wrap(later.az - 180), -wrap(earlier.az - 180), 1e-9);
});

test('sun: in the southern hemisphere noon is in the north and the sun still runs east to west', () => {
  const noon = { az: 0, elev: 55 }, later = sunAt(noon.az, noon.elev, 1, -35);
  assert.ok(wrap(later.az) < 0, `${later.az}`);   // from north toward west (azimuth decreasing through 360)
  assert.ok(later.elev < 55);
});

test('sun: the latitude shapes the arc: at the pole the sun circles at a constant height, at the equator it climbs straight up', () => {
  const pole = sunAt(0, 20, 6, 90); near(pole.elev, 20, 1e-9); near(wrap(pole.az - 90), 0, 1e-9);
  near(sunAt(90, 5, 1, 0).elev, 20, 1e-6);                                         // equator sunrise: climbs the full 15 degrees an hour
  assert.ok(sunAt(90, 5, 1, 60).elev < sunAt(90, 5, 1, 0).elev - 5);                // high latitude: a shallow climb
});

test('sun: the start position says the time of year, and impossible suns are called out', () => {
  const equinox = declination(180, 50, 40); near(equinox, 0, 1e-6); assert.deepEqual(seasonDates(equinox), ['Mar 22', 'Sep 21']);
  const june = declination(180, 50 + 23.44, 40); near(june, 23.44, 1e-6); assert.ok(seasonDates(june - 0.05)[0].startsWith('Jun'));
  assert.equal(seasonDates(declination(180, 80, 40)), null);   // 80 degrees up at 40 north never happens
  assert.ok(SUN.hours > 0 && Math.abs(SUN.lat) <= 90);
});

test('sun clock: a sun converts to a latitude-aware time and declination and back to the same sun', () => {
  for (const [az, elev, lat] of [[180, 50, 40], [250, 15, 40], [100, 30, -35], [10, 70, 0], [300, 5, 60], [45, 12, -60]]) {
    const { decl, time } = sunClock(az, elev, lat), back = sunAtClock(decl, time, lat);
    near(wrap(back.az - az), 0, 1e-6); near(back.elev, elev, 1e-6); assert.ok(time >= 0 && time < 24);
  }
  near(sunClock(180, 50, 40).time, 12, 1e-9);   // an equinox sun due south at 50 degrees is solar noon at 40 north
  const later = sunAt(180, 50, 1.5, 40); near(sunClock(later.az, later.elev, 40).time, 13.5, 1e-6);
  const earlier = sunAt(180, 50, -2, 40); near(sunClock(earlier.az, earlier.elev, 40).time, 10, 1e-6);
});

test('sun clock: the same declination at later clock times is the same arc the sun walks', () => {
  const { decl } = sunClock(250, 15, 40);
  const a = sunAtClock(decl, 16, 40), b = sunAtClock(decl, 17, 40);
  assert.ok(angle(a, b) > 5 && angle(a, b) <= 15 + 1e-9);   // a decl of -5 degrees: a bit under the full 15 degrees an hour
  assert.ok(sunAtClock(decl, 12, 40).elev > sunAtClock(decl, 16, 40).elev);   // highest at noon
});

test('day length: sunrise and sunset from the latitude and the time of year', () => {
  const eq = dayTimes(0, 40); near(eq.rise, 6, 1e-9); near(eq.set, 18, 1e-9);
  const summer = dayTimes(23.44, 40), winter = dayTimes(-23.44, 40);
  assert.ok(summer.set - summer.rise > 14 && winter.set - winter.rise < 10);
  assert.equal(dayTimes(23, 70).polar, 'day'); assert.equal(dayTimes(-23, 70).polar, 'night');
  const sun = sunAtClock(0, dayTimes(0, 40).set, 40); near(sun.elev, 0, 1e-6);   // the sun is on the horizon at sunset
});

test('sky grade is the identity at the scene\'s own sun, so a clip starts exactly like the edit view', () => {
  for (const e0 of [1, 7.7, 20, 45, 80]) { const g = skyGrade(e0, e0, false); near(g.n, 0, 1e-9); near(g.w, 0, 1e-9); near(g.sunK, 1, 1e-9); }
  for (const e0 of [-1, -5, -17, -40]) { const g = skyGrade(e0, e0, true); near(g.n, 1, 1e-9); near(g.w, 0, 1e-9); near(g.moonK, 1, 1e-9); near(g.sunK, 0, 1e-9); }
});

test('sky grade: sunset runs day, golden hour, twilight, night; moonlight grows once the sun is down', () => {
  const steps = [40, 20, 10, 4, 1, 0, -2, -5, -8, -12, -20].map(e => skyGrade(e, 40, false));
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i].n >= steps[i - 1].n - 1e-12, 'night only deepens');
    assert.ok(steps[i].sunK <= steps[i - 1].sunK + 1e-12, 'sunlight only fades');
    assert.ok(steps[i].moonK >= steps[i - 1].moonK - 1e-12, 'moonlight only grows');
  }
  const g = e => skyGrade(e, 40, false);
  assert.ok(g(3).w > 0.9 && g(3).n < 0.05);            // golden hour: very warm, still day
  assert.ok(g(-5).n > 0.4 && g(-5).n < 0.8);           // twilight: half way to night
  assert.equal(g(-20).n, 1); assert.equal(g(-20).w, 0);
  assert.equal(g(0).sunK, 0); assert.equal(g(0).moonK, 0); assert.ok(g(-1).sunK === 0 && g(-1).moonK < 0.1);   // both lights are zero at the horizon where the direction flips, so shadows never pop
  const dawn = e => skyGrade(e, -17, true);
  assert.equal(dawn(-17).n, 1); assert.ok(dawn(-4).n < 1 && dawn(5).n === 0 && dawn(5).sunK === 1);   // a night scene can run into morning
});

test('the calendar: declination by day of year, and back', () => {
  near(declOnDay(81), 0, 1e-9); near(declOnDay(172), 23.44 * Math.sin(2 * Math.PI * 91 / 365), 1e-9); assert.ok(declOnDay(172) > 23.3 && declOnDay(355) < -23.3);
  for (const n of [20, 81, 150, 172, 260, 300]) { const [a, b] = daysOfDecl(declOnDay(n)); assert.ok(a === n || b === n, `${n} -> ${a}, ${b}`); }
  assert.equal(daysOfDecl(30), null);
  assert.equal(dayIso(172), '2023-06-21'); assert.equal(dayOfIso('2023-06-21'), 172); assert.equal(dayOfIso('2024-03-01'), 61);
  assert.deepEqual(seasonDates(23.44), ['Jun 21']);   // the solstice is one day, named once
});

test('the stars turn with the sky: identity at hour 0, fixed pole, and a star keeps its place relative to the sun', () => {
  const apply = (M, v) => [0, 1, 2].map(i => M[i] * v[0] + M[3 + i] * v[1] + M[6 + i] * v[2]);
  const sv = ({ az, elev }) => { const a = az * Math.PI / 180, e = elev * Math.PI / 180; return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]; };
  assert.deepEqual(starMatrix(40, 0), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const pole = [0, Math.sin(40 * Math.PI / 180), -Math.cos(40 * Math.PI / 180)], q = apply(starMatrix(40, 5), pole);
  q.forEach((v, i) => near(v, pole[i], 1e-9));   // the pole star stays put
  const { decl } = sunClock(250, 15, 40);
  for (const dh of [1, 3, -2, 7]) {   // the pattern the sun sits against at time T is what it sits against at T + dh, seen turned back by dh hours
    const later = sv(sunAtClock(decl, 16 + dh, 40)), start = sv(sunAtClock(decl, 16, 40)), back = apply(starMatrix(40, dh), later);
    back.forEach((v, i) => near(v, start[i], 1e-9));
  }
  const t = apply(starMatrix(52, 24), [0.3, 0.5, -0.8]); near(t[0], 0.3, 1e-9); near(t[1], 0.5, 1e-9); near(t[2], -0.8, 1e-9);   // a full day brings the stars home
});

test('the compass turns the sun\'s path round the scene and leaves its time, day and stars\' pole in step', () => {
  const apply = (M, v) => [0, 1, 2].map(i => M[i] * v[0] + M[3 + i] * v[1] + M[6 + i] * v[2]);
  const sv = ({ az, elev }) => { const a = az * Math.PI / 180, e = elev * Math.PI / 180; return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]; };
  const wrap = a => ((a % 360) + 540) % 360 - 180;
  for (const north of [0, 35, -120, 179]) for (const [decl, time] of [[10, 9.5], [-20, 15.25], [23.44, 19]]) {
    const plain = sunAtClock(decl, time, 40), turned = sunAtClock(decl, time, 40, north);
    near(turned.elev, plain.elev); near(wrap(turned.az - plain.az - north), 0, 1e-9);   // the same height, swung round by the compass
    const back = sunClock(turned.az, turned.elev, 40, north); near(back.decl, decl, 1e-9); near(back.time, time, 1e-9);   // and it still reads the same clock
  }
  assert.deepEqual(sunAtClock(10, 9.5, 40, 0), sunAtClock(10, 9.5, 40));   // no compass is exactly the old sun
  const north = 70, n = north * Math.PI / 180, p = [0, Math.sin(40 * Math.PI / 180), -Math.cos(40 * Math.PI / 180)];
  const pole = [p[0] * Math.cos(n) - p[2] * Math.sin(n), p[1], p[2] * Math.cos(n) + p[0] * Math.sin(n)];
  apply(starMatrix(40, 5, north), pole).forEach((v, i) => near(v, pole[i], 1e-9));   // the turned pole star stays put
  const later = sv(sunAtClock(15, 18, 40, north)), start = sv(sunAtClock(15, 16, 40, north)), back = apply(starMatrix(40, 2, north), later);
  back.forEach((v, i) => near(v, start[i], 1e-9));   // and the stars still keep their place against the sun
});

test('noon height: the day\'s arc peaks at 90 minus the gap between latitude and declination', () => {
  near(noonElev(0, 40), 50); near(noonElev(23.44, 40), 73.44); near(noonElev(-23.44, -35), 90 - 11.56);
  for (const lat of [40, -35, 0]) for (const h of [10, 45, 90]) near(noonElev(declForNoon(h, lat), lat), h, 1e-9);
  const noon = sunAtClock(0, 12, 40); near(noon.elev, 50, 1e-6); near(noon.az, 180, 1e-6);   // the sun at noon is as high as noonElev says, due south
});

test('a sun in the north half of the sky is read as a southern sun, so its clock and its slider behave', () => {
  assert.equal(defaultLat(0), -40); assert.equal(defaultLat(180), 40); assert.equal(defaultLat(100), 40); assert.equal(defaultLat(-60), -40);
  const noon = sunClock(0, 20, defaultLat(0)); near(noon.time, 12, 1e-6);   // due north at 20 degrees is noon in the southern hemisphere
  const night = sunClock(0, 20, 40); assert.ok(night.time < 0.001 || night.time > 23.999);   // but at 40 north that is the midnight sun
  // the slider keeps the side the sun is on: one nudge from the current height moves the sun a little, never across the sky
  for (const [az, el] of [[0, 20], [180, 20], [-40, 35], [130, 12]]) {
    const lat = defaultLat(az), cur = sunClock(az, el, lat), side = noonSide(cur.decl, lat), h0 = noonElev(cur.decl, lat);
    const moved = sunAtClock(declForNoon(h0 + 2, lat, side), cur.time, lat);
    assert.ok(angle({ az, elev: el }, moved) < 6, `${az} ${el}: moved ${angle({ az, elev: el }, moved)}`);
  }
});
