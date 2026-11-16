#!/usr/bin/env node
// Headless render: node scripts/render.mjs --scene tbDrift --seed 42 --size 2560x2560 --quality fine --out drift.png
// Needs Google Chrome installed (uses playwright-core, no browser download). Starts serve.py on a free port and stops it afterwards.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = Object.fromEntries(process.argv.slice(2).reduce((o, v, i, all) => (v.startsWith('--') ? [...o, [v.slice(2), all[i + 1]]] : o), []));
const { scene, seed = '1', size = '800x800', quality = 'normal', out = 'render.png', timeout = '1800' } = a;
if (!scene) { console.error('usage: render.mjs --scene <key> [--seed n] [--size WxH] [--quality draft|normal|fine] [--out file.png] [--timeout seconds]'); process.exit(1); }

const port = await new Promise(res => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const server = spawn('python3', ['serve.py', String(port)], { cwd: root, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://localhost:${port}/?scene=${scene}&seed=${seed}&size=${size}&quality=${quality}&render=1`);
  console.log('GPU:', await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));
  const t0 = Date.now();
  let last = '';
  await page.waitForFunction(() => window.terrascape?.renderDone && window.terrascape.mode === 'ray', null, { timeout: +timeout * 1000, polling: 500 }).catch(async e => { throw e; });
  console.log(`rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s (after load)`);
  const data = await page.evaluate(() => window.terrascape.canvas.toDataURL('image/png').split(',')[1]);
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('wrote', out);
} finally { await browser.close(); stop(); }
