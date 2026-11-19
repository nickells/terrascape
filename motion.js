// Camera motion maths shared by the in-page Animate panel, the animate.mjs hook and the tests. Pure: no three.js, no DOM.
//
// A motion is { orbit, zoom, focus } over a loop position t in [0, 1]:
//   orbit: degrees swept around the focus (360 = full turn), or [from, to]; zoom: lens magnification reached at t = 1 (>1 in, <1 out);
//   dolly: how many times closer the camera is to the focus at t = 1 (>1 in, <1 out), with the lens zooming the other way so the focus keeps the
//   same size on screen (the "vertigo" effect: the background stretches or squeezes around a steady subject);
//   focus: [x, y, z] to circle and look at (default: the base camera's own target).

// What the Animate panel offers. amt is the preset's default amount; loop motions end where they began, so frame i of N is at t = i / N.
export const PRESETS = [
  { key: 'push-in', label: 'Slow push-in', amt: 1.15, unit: '× zoom', spec: a => ({ zoom: a }) },
  { key: 'pull-out', label: 'Slow pull-out', amt: 1.15, unit: '× zoom', spec: a => ({ zoom: 1 / a }) },
  { key: 'dolly-in', label: 'Dolly zoom: push in', amt: 1.6, unit: '× dolly', spec: a => ({ dolly: a }) },
  { key: 'dolly-out', label: 'Dolly zoom: pull back', amt: 1.6, unit: '× dolly', spec: a => ({ dolly: 1 / a }) },
  { key: 'turntable', label: 'Turntable', amt: 360, unit: '° around', loop: true, spec: a => ({ orbit: a }) },
  { key: 'sweep', label: 'Sweep', amt: 15, unit: '° each way', spec: a => ({ orbit: [-a, a] }) },
  { key: 'still', label: 'Camera still', amt: 0, unit: '', spec: () => ({}) },   // only the clouds and water move
];
// How far the weather drifts per second of clip (cloud layers in world units, sky clouds and water ripples in noise units). The same amounts
// the script defaults to for a ~5 s clip, so a panel clip and a script clip look alike.
export const DRIFT = { clouds: 100, sky: 0.3, water: 0.6 };
// Sun movement: hours of sun time that pass over a clip, and the latitude that sets how steeply the sun climbs and sets.
export const SUN = { hours: 2, lat: 40 };
const MAX_FOV = 120;   // a dolly zoom that would open the lens wider than this stops widening
export const CLIP = { seconds: 5, fps: 24, maxFrames: 240, maxSide: 1280 };

// Loop position of frame i of n. A loop (turntable) stops one frame short of the start so it repeats seamlessly; anything else
// reaches the full amount on the last frame.
export const timeAt = (i, n, loop = false) => n <= 1 ? 0 : loop ? i / n : i / (n - 1);

// Camera placed for position t, from a base { pos, target, fov }. Orbit keeps the camera's height and its distance from the focus.
export function cameraAt(base, spec, t) {
  const focus = Array.isArray(spec.focus) ? spec.focus : null, target = focus || base.target, { pos } = base;
  const [o0, o1] = Array.isArray(spec.orbit) ? spec.orbit : [0, spec.orbit || 0], a = (o0 + (o1 - o0) * t) * Math.PI / 180;
  const dx = pos[0] - target[0], dz = pos[2] - target[2], c = Math.cos(a), s = Math.sin(a);
  const k = Math.pow(spec.dolly || 1, -t);   // distance to the focus, as a fraction of the start
  const fov0 = base.fov || 50, m = Math.pow(spec.zoom || 1, t) * k;   // zoom is steady in apparent size, so interpolate the magnification; a dolly's lens counter-zoom is 1/k
  const p = [target[0] + dx * c - dz * s, pos[1], target[2] + dx * s + dz * c];
  return {
    pos: k === 1 ? p : [0, 1, 2].map(i => target[i] + (p[i] - target[i]) * k),
    target: target.slice(),
    fov: Math.min(MAX_FOV, 2 * Math.atan(Math.tan(fov0 * Math.PI / 360) / m) * 180 / Math.PI),
  };
}

// ---------- the sun ----------
// The sun turns 15 degrees an hour about the celestial pole, an axis tilted up from the horizon by the latitude. Turning the sun the scene already
// has about that axis keeps it exactly where it is at hour 0, and gives the real arc for that latitude and that sun height, so the time of year
// is already in the start position (a low noon sun is winter) and needn't be asked for. Directions use the app's own axes: azimuth 0 is -z
// (north), 90 is +x (east), y is up; a negative latitude is the southern hemisphere and runs the same way (the sun is still east to west).
const RAD = Math.PI / 180;
const sunVec = (az, el) => { const a = az * RAD, e = el * RAD; return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]; };
const poleAxis = lat => [0, Math.sin(lat * RAD), -Math.cos(lat * RAD)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Where a sun at (az, elev), degrees, is after `hours` (negative = earlier) at a latitude. Elevation goes negative below the horizon.
export function sunAt(az, elev, hours, lat = SUN.lat) {
  const v = sunVec(az, elev), k = poleAxis(lat), th = -15 * hours * RAD, c = Math.cos(th), s = Math.sin(th), kv = dot(k, v), kxv = cross(k, v);
  const r = [0, 1, 2].map(i => v[i] * c + kxv[i] * s + k[i] * kv * (1 - c));   // Rodrigues' rotation of v about k
  return { az: Math.atan2(r[0], -r[2]) / RAD, elev: Math.asin(Math.max(-1, Math.min(1, r[1]))) / RAD };
}
// The sun's declination (degrees north of the celestial equator): the sun's height and the latitude together say which time of year it is.
export const declination = (az, elev, lat = SUN.lat) => Math.asin(Math.max(-1, Math.min(1, dot(sunVec(az, elev), poleAxis(lat))))) / RAD;
// The declination of the sun on day n of the year (1 to 365): a simple sine of the year with the equinox on day 81.
export const declOnDay = n => 23.44 * Math.sin(2 * Math.PI * (n - 81) / 365);
// The two days of the year with that declination (once as the days lengthen, once as they shorten), or null when no real day has it.
export function daysOfDecl(decl) {
  const tilt = 23.44; if (Math.abs(decl) > tilt) return null;
  const d1 = 81 + 365 / (2 * Math.PI) * Math.asin(decl / tilt);
  return [((Math.round(d1) - 1 + 365) % 365) + 1, ((Math.round(344.5 - d1) - 1 + 365) % 365) + 1];
}
const dayDate = d => new Date(Date.UTC(2023, 0, 1) + (d - 1) * 864e5);
export const dayName = d => dayDate(d).toLocaleString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const dayIso = d => dayDate(d).toISOString().slice(0, 10);
export const dayOfIso = iso => { const t = Date.parse(iso + 'T00:00:00Z'); return isFinite(t) ? Math.round((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / 864e5) + 1 : null; };
// The two days as short dates, or null.
export const seasonDates = decl => { const d = daysOfDecl(decl); return d && (d[0] === d[1] ? [dayName(d[0])] : d.map(dayName)); };

// ---------- sun clock ----------
// A sun is a latitude, a declination (how high the day's arc rides: it is the time of year) and a time of day. Local solar time: noon is when the sun
// is highest and due north or south; no time zones, daylight saving or equation of time. A sun the scene already has converts both ways, so a clip
// can start exactly where the edit view's sun is, and run forward or back from there.
const clampLat = lat => Math.max(-89.9, Math.min(89.9, lat));
// The sun of declination decl at solar noon: in the plane of the pole axis and the zenith, on the side that puts it higher.
const noonVec = (decl, lat) => { const k = poleAxis(lat), p = clampLat(lat) * RAD, e1 = [0, Math.cos(p), Math.sin(p)], d = decl * RAD; return [0, 1, 2].map(i => k[i] * Math.sin(d) + e1[i] * Math.cos(d)); };
const toAzEl = r => ({ az: Math.atan2(r[0], -r[2]) / RAD, elev: Math.asin(Math.max(-1, Math.min(1, r[1]))) / RAD });
const turn = (v, k, th) => { const c = Math.cos(th), s = Math.sin(th), kv = dot(k, v), kxv = cross(k, v); return [0, 1, 2].map(i => v[i] * c + kxv[i] * s + k[i] * kv * (1 - c)); };
// north (the compass): the scene azimuth true north points to. The clock works in true azimuths, so turning the compass swings the sun's whole path
// round the scene without changing its time or its day. 0 is the scene's own axes, as before there was a compass.
export function sunAtClock(decl, time, lat = SUN.lat, north = 0) {
  lat = clampLat(lat); const p = toAzEl(turn(noonVec(decl, lat), poleAxis(lat), -15 * (time - 12) * RAD));
  return north ? { az: ((p.az + north + 540) % 360) - 180, elev: p.elev } : p;
}
// The declination and the solar time (0 to 24) of a sun at (az, elev), with the compass at north.
export function sunClock(az, elev, lat = SUN.lat, north = 0) {
  lat = clampLat(lat); az -= north; const v = sunVec(az, elev), k = poleAxis(lat), decl = declination(az, elev, lat), m = noonVec(decl, lat), kv = dot(k, v), km = dot(k, m);
  const vp = [0, 1, 2].map(i => v[i] - k[i] * kv), mp = [0, 1, 2].map(i => m[i] - k[i] * km);
  const turned = Math.atan2(dot(k, cross(mp, vp)), dot(mp, vp)) / RAD;   // degrees the sun has swung from noon, about the pole
  return { decl, time: (((12 - turned / 15) % 24) + 24) % 24 };
}
// Sunrise and sunset (solar time) for a declination and latitude, or { polar: 'day' | 'night' } where the sun never sets or never rises.
export function dayTimes(decl, lat = SUN.lat) {
  const c = -Math.tan(clampLat(lat) * RAD) * Math.tan(decl * RAD);
  if (c >= 1) return { polar: 'night' }; if (c <= -1) return { polar: 'day' };
  const h = Math.acos(c) / RAD / 15; return { rise: 12 - h, set: 12 + h };
}

// ---------- sky grade ----------
// How the sky, light and ambient should look for a sun at elevation e, as 0..1 amounts. The scene's own sun (elevation e0) is the anchor: every
// amount is the identity there, so a clip's first frame looks exactly like the edit view, and the grade only changes as the sun moves away.
//   n: night (stars, moon, deep sky, moonlight), w: golden-hour warmth, sunK: how much of the sun's light is left (it dies into the horizon),
//   moonK: how much moonlight there is (it grows as the moon climbs). night0: the scene is a night scene, so its document sun is really the moon
//   (the true sun is on the opposite side, below the horizon) and the look it starts from is full night.
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const nightAt = e => 1 - smooth(-12, 2, e), warmAt = e => 1 - smooth(2, 22, e), sunKAt = e => smooth(0, 4, e), moonKAt = e => smooth(0, 8, -e);   // the light hands over at the horizon, where both are zero, so it never comes from below ground
const rel = (x, x0) => x0 >= 1 - 1e-3 ? 0 : Math.max(0, Math.min(1, (x - x0) / (1 - x0)));   // x as a share of the room left above the anchor
export function skyGrade(e, e0, night0 = false) {
  const n = night0 ? Math.min(1, nightAt(e) / Math.max(nightAt(e0), 1e-3)) : rel(nightAt(e), nightAt(e0));
  const w = (night0 ? warmAt(e) : rel(warmAt(e), warmAt(e0))) * (1 - n);
  const cap = (k, k0) => Math.min(1, k / Math.max(k0, 1e-3));
  return { n, w, sunK: night0 ? sunKAt(e) : cap(sunKAt(e), sunKAt(e0)), moonK: night0 ? cap(moonKAt(e), moonKAt(e0)) : moonKAt(e) };
}

// ---------- the sky turns ----------
// The stars are fixed to the celestial sphere, which turns about the same pole axis as the sun, 15 degrees an hour. starMatrix gives the matrix that, applied
// to a view direction, finds the fixed star pattern it is looking at after `hours` have passed (negative: before). Zero hours is the identity.
// Column-major, ready for a mat3 uniform. north turns the pole with the compass (see sunAtClock).
export function starMatrix(lat, hours, north = 0) {
  const p = poleAxis(clampLat(lat)), n = north * RAD, th = 15 * hours * RAD;
  const k = [p[0] * Math.cos(n) - p[2] * Math.sin(n), p[1], p[2] * Math.cos(n) + p[0] * Math.sin(n)];   // the azimuth turn sunVec uses
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]].flatMap(e => turn(e, k, th));
}
// How high the day's arc climbs: the sun's elevation at solar noon, for a declination and latitude. And the declination that gives a chosen noon height.
export const noonElev = (decl, lat) => 90 - Math.abs(lat - decl);
// side: which way the arc culminates from the zenith (-1 on the equator side of it, 1 beyond it); defaults to the equator side, where a scene's sun normally is.
export const declForNoon = (h, lat, side = lat >= 0 ? -1 : 1) => lat + side * (90 - h);
// Which side of the zenith a sun of this declination culminates on, so a slider keeps the sun where it is.
export const noonSide = (decl, lat) => decl > lat ? 1 : decl < lat ? -1 : lat >= 0 ? -1 : 1;
// A latitude for a scene that has none: the hemisphere whose noon sun is on the side of the sky the scene's sun is on (a sun in the north half is
// a southern-hemisphere sun), so its clock reads a sensible time and its path is the ordinary one.
export const defaultLat = az => (Math.cos(az * RAD) > 0.05 ? -1 : 1) * Math.abs(SUN.lat);
