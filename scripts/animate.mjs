#!/usr/bin/env node
// Short ray-traced animation: node scripts/animate.mjs --scene tbDrift --seed 42 --do orbit,clouds,water --frames 48 --out /tmp/drift
// Writes <out>/frame_0000.png ... and, if ffmpeg is installed, <out>.mp4. Needs Google Chrome (playwright-core), like render.mjs.
// Motion is relative to a loop: --do picks which motions run; amounts are over the whole clip (orbit 360 = a seamless turntable).
// slow-zoom-in / slow-zoom-out are lens zooms from the scene's framing (--zoom 1.3 = 1.3x magnification over the clip); they combine with the rest.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = Object.fromEntries(process.argv.slice(2).reduce((o, v, i, all) => (v.startsWith('--') ? [...o, [v.slice(2), all[i + 1]]] : o), []));
const { scene, seed = '1', size = '640x640', quality = 'draft', frames = '48', fps = '24', out = 'anim', timeout = '600' } = a;
if (!scene) { console.error('usage: animate.mjs --scene <key> [--do orbit,clouds,water] [--frames 48] [--fps 24] [--orbit 60|-15,15] [--focus x,y,z|ObjectName] [--zoom 1.3] [--clouds 600] [--water 3] [--sky 1.5] [--seed n] [--size WxH] [--quality draft|normal|fine] [--out dir]\n  --do: any of orbit (camera swings round the target), clouds (cloud layers + sky clouds drift), water (ripples travel), slow-zoom-in or slow-zoom-out (lens zoom). Default: orbit.\n  amounts: orbit in degrees over the clip (360 = full turn), zoom as a magnification factor over the clip (default 1.3), clouds in world units, water in ripple cells, sky in sky-noise units'); process.exit(1); }
const doing = new Set((a.do || 'orbit').split(','));
const known = ['orbit', 'clouds', 'water', 'slow-zoom-in', 'slow-zoom-out'];
for (const d of doing) if (!known.includes(d)) { console.error(`unknown --do motion "${d}" (expected ${known.join(', ')})`); process.exit(1); }
if (doing.has('slow-zoom-in') && doing.has('slow-zoom-out')) { console.error('pick one of slow-zoom-in and slow-zoom-out'); process.exit(1); }
const zoomBy = Math.abs(+(a.zoom ?? 1.3)) || 1.3;
const spec = { orbit: doing.has('orbit') ? (a.orbit ?? '60').includes(',') ? a.orbit.split(',').map(Number) : +(a.orbit ?? 60) : 0, clouds: doing.has('clouds') ? +(a.clouds ?? 600) : 0, sky: doing.has('clouds') ? +(a.sky ?? 1.5) : 0, water: doing.has('water') ? +(a.water ?? 3) : 0,
  zoom: doing.has('slow-zoom-in') ? zoomBy : doing.has('slow-zoom-out') ? 1 / zoomBy : 1 };
const focus = a.focus ? (/^[-\d.]+,[-\d.]+,[-\d.]+$/.test(a.focus) ? a.focus.split(',').map(Number) : a.focus) : undefined;
if (focus) spec.focus = focus;
const N = Math.max(2, +frames | 0);
mkdirSync(out, { recursive: true });

const port = await new Promise(res => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const server = spawn('python3', ['serve.py', String(port)], { cwd: root, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const name = i => `${out}/frame_${String(i).padStart(4, '0')}.png`;
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://localhost:${port}/?scene=${scene}&seed=${seed}&size=${size}&quality=${quality}&render=1`);
  const grab = async i => writeFileSync(name(i), Buffer.from(await page.evaluate(() => window.terrascape.canvas.toDataURL('image/png').split(',')[1]), 'base64'));
  const t0 = Date.now();
  // wait for the page's own first render (scene loaded), then render every frame through renderFrame so a --focus applies from frame 0
  console.log(`loading ${scene}, ${N} frames at ${size} (${quality})...`);
  await page.waitForFunction(() => window.terrascape?.renderDone && window.terrascape.mode === 'ray', null, { timeout: +timeout * 1000, polling: 500 });
  for (let i = 0; i < N; i++) {
    await page.evaluate(([s, t]) => window.terrascape.renderFrame(s, t), [spec, i / N]);
    await grab(i);
    const el = (Date.now() - t0) / 1000, done = i + 1;
    // one line per update (works in logs and background tasks): every frame for short clips, ~20 lines for long ones
    if (done === N || done % Math.ceil(N / 20) === 0 || N <= 20) console.log(`frame ${done}/${N} (${Math.round(100 * done / N)}%)  ${el.toFixed(0)}s elapsed, ~${(el / done * (N - done)).toFixed(0)}s left`);
  }
  console.log(`wrote ${N} frames to ${out}/ (${spec.orbit}deg orbit, ${spec.zoom === 1 ? 'no zoom' : `${zoomBy}x ${spec.zoom > 1 ? 'zoom-in' : 'zoom-out'}`}, ${spec.clouds} cloud drift, ${spec.water} water)`);
} finally { await browser.close(); stop(); }

const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps, '-i', `${out}/frame_%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', `${out}.mp4`]);
console.log(ff.status === 0 ? `wrote ${out}.mp4` : 'ffmpeg not available or failed; frames are in the folder');
