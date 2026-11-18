// Camera motion maths shared by the in-page Animate panel, the animate.mjs hook and the tests. Pure: no three.js, no DOM.
//
// A motion is { orbit, zoom, focus } over a loop position t in [0, 1]:
//   orbit: degrees swept around the focus (360 = full turn), or [from, to]; zoom: lens magnification reached at t = 1 (>1 in, <1 out);
//   focus: [x, y, z] to circle and look at (default: the base camera's own target).

// What the Animate panel offers. amt is the preset's default amount; loop motions end where they began, so frame i of N is at t = i / N.
export const PRESETS = [
  { key: 'push-in', label: 'Slow push-in', amt: 1.15, unit: '× zoom', spec: a => ({ zoom: a }) },
  { key: 'pull-out', label: 'Slow pull-out', amt: 1.15, unit: '× zoom', spec: a => ({ zoom: 1 / a }) },
  { key: 'turntable', label: 'Turntable', amt: 360, unit: '° around', loop: true, spec: a => ({ orbit: a }) },
  { key: 'sweep', label: 'Sweep', amt: 15, unit: '° each way', spec: a => ({ orbit: [-a, a] }) },
  { key: 'still', label: 'Camera still', amt: 0, unit: '', spec: () => ({}) },   // only the clouds and water move
];
// How far the weather drifts per second of clip (cloud layers in world units, sky clouds and water ripples in noise units). The same amounts
// the script defaults to for a ~5 s clip, so a panel clip and a script clip look alike.
export const DRIFT = { clouds: 100, sky: 0.3, water: 0.6 };
export const CLIP = { seconds: 5, fps: 24, maxFrames: 240, maxSide: 1280 };

// Loop position of frame i of n. A loop (turntable) stops one frame short of the start so it repeats seamlessly; anything else
// reaches the full amount on the last frame.
export const timeAt = (i, n, loop = false) => n <= 1 ? 0 : loop ? i / n : i / (n - 1);

// Camera placed for position t, from a base { pos, target, fov }. Orbit keeps the camera's height and its distance from the focus.
export function cameraAt(base, spec, t) {
  const focus = Array.isArray(spec.focus) ? spec.focus : null, target = focus || base.target, { pos } = base;
  const [o0, o1] = Array.isArray(spec.orbit) ? spec.orbit : [0, spec.orbit || 0], a = (o0 + (o1 - o0) * t) * Math.PI / 180;
  const dx = pos[0] - target[0], dz = pos[2] - target[2], c = Math.cos(a), s = Math.sin(a);
  const fov0 = base.fov || 50, m = Math.pow(spec.zoom || 1, t);   // zoom is steady in apparent size, so interpolate the magnification
  return {
    pos: [target[0] + dx * c - dz * s, pos[1], target[2] + dx * s + dz * c],
    target: target.slice(),
    fov: 2 * Math.atan(Math.tan(fov0 * Math.PI / 360) / m) * 180 / Math.PI,
  };
}
