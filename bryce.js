// Bryce-style interface for Terrascape: a mode column on the left (Create, Edit, Sky&Fog, Render),
// a shelf of little rendered objects across the top, a trackball and arrow pads for the camera,
// a big render ball, and the editor's panels in one floating palette.
// It rearranges the classic page around the same engine; index.html exposes window.terrascape.
// Active only when <html> has the "bryce" class (?ui=bryce); otherwise this file does nothing.
(() => {
'use strict';
if (!document.documentElement.classList.contains('bryce')) return;

const $ = id => document.getElementById(id);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
let T = null;          // window.terrascape, once the engine is up
let tab = 'create';

// ---------- textures: speckled grey for the panels, sand for the shelf ----------
function speckle(size, base, spots) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.55; i++) {
    const [col, a] = spots[(Math.random() * spots.length) | 0];
    g.globalAlpha = a * Math.random();
    g.fillStyle = col; g.fillRect((Math.random() * size) | 0, (Math.random() * size) | 0, 1, 1);
  }
  return `url(${c.toDataURL()})`;
}
const rootStyle = document.documentElement.style;
rootStyle.setProperty('--bz-noise', speckle(96, '#3c3c40', [['#000', 0.5], ['#fff', 0.18], ['#5a5048', 0.6]]));
rootStyle.setProperty('--bz-sand', speckle(96, '#c9a676', [['#6e4b2a', 0.55], ['#fff2d8', 0.6], ['#a07850', 0.8], ['#3a2818', 0.35]]));
rootStyle.setProperty('--bz-slate', speckle(96, '#4a5568', [['#1a2030', 0.6], ['#a8b4d0', 0.4], ['#2c3446', 0.8]]));

// ---------- layout: move the classic page's parts into the Bryce arrangement ----------
const win = $('win');
const well = win.querySelector('.well');
const status = win.querySelector('.status');
const toolbar = win.querySelector('.toolbar');
const titleBar = win.querySelector(':scope > .title');

const mac = h('div', 'bz-mac');
mac.append(h('span', 'bz-logo', '<i></i>'), $('menubar'), h('span', 'bz-spacer'));
const docLbl = h('span', 'bz-doc'); docLbl.append($('docname')); mac.append(docLbl, h('span', 'bz-clock'));

const left = h('div', 'bz-left');
left.innerHTML = `
  <nav class="bz-modes" aria-label="Palettes">
    <button data-tab="create">Create</button><button data-tab="edit">Edit</button>
    <button data-tab="sky">Sky&amp;Fog</button><button data-tab="render">Render</button>
  </nav>
  <button class="bz-nano" title="Last render · click to render again"><canvas width="116" height="87"></canvas><span>no render yet</span></button>
  <div class="bz-views" aria-label="Camera views">
    <button data-view="top" title="View from above">Top</button><button data-view="front" title="View from the front">Front</button>
    <button data-view="side" title="View from the side">Side</button><button data-view="iso" title="Three-quarter view">¾</button>
  </div>
  <div class="bz-pad" aria-label="Move camera">
    <button class="bz-ar up" data-pan="0,1" title="Raise camera"></button>
    <button class="bz-ar lf" data-pan="-1,0" title="Slide camera left"></button>
    <button class="bz-ar rt" data-pan="1,0" title="Slide camera right"></button>
    <button class="bz-ar dn" data-pan="0,-1" title="Lower camera"></button>
    <span class="bz-hub"></span>
  </div>
  <div class="bz-fly" aria-label="Fly camera">
    <button class="bz-ar fw" data-fly="1" title="Fly forward"></button><button class="bz-ar bk" data-fly="-1" title="Fly back"></button>
  </div>
  <div class="bz-ball" title="Trackball: drag to orbit the camera around its target"></div>
  <div class="bz-round"><button data-zoom="1.12" title="Zoom out">−</button><button data-zoom="0.89" title="Zoom in">+</button></div>
  <button class="bz-render" title="Render (Enter)"><i></i></button>
  <div class="bz-lcd" aria-live="off"><b class="t">00:00.0</b><span class="p">READY</span><span class="s"></span></div>`;
const round = left.querySelector('.bz-round');
for (const [id, glyph] of [['btnUndo', '↶'], ['btnRedo', '↷']]) { const b = $(id); b.textContent = glyph; round.append(b); }

const shelf = h('div', 'bz-shelf');
shelf.innerHTML = '<div class="bz-hint"></div><div class="bz-tiles"></div>';
const hint = shelf.querySelector('.bz-hint'), tiles = shelf.querySelector('.bz-tiles');

const viewWrap = h('div', 'bz-viewwrap');
const float = h('div', 'bz-float');
float.innerHTML = '<div class="bz-fhead"><span class="bz-ftitle"></span><button class="bz-fdock"></button><button class="bz-fmin" title="Roll up">▴</button></div><div class="bz-fbody"></div>';
const fbody = float.querySelector('.bz-fbody');
fbody.append($('startPage'), $('worldPage'), $('objPage'));
const btnEdit = $('btnEdit');   // look it up before the move: $() only finds elements in the page
btnEdit.textContent = '◀ Back to edit';
viewWrap.append(well, btnEdit);

const stage = h('div', 'bz-stage');
stage.append(shelf, viewWrap, status);
const body = h('div', 'bz-body');
body.append(left, stage, float);   // docked: a column right of the view; floating: anywhere in the window
const stash = h('div', 'bz-stash'); stash.hidden = true;
stash.append(toolbar, titleBar);
win.querySelector('.main').remove();
win.prepend(mac);
mac.after(body);
win.append(stash);

// ---------- hint line ----------
const TAB_HINT = {
  create: 'Create · click an object to drop it into the scene',
  edit: 'Edit · tools act on the selected object; click a sphere to change its material',
  sky: 'Sky & Fog · palette, time of day, weather; drag the sun dial',
  render: 'Render · choose quality and size, then hit the red ball',
};
const setHint = t => { hint.textContent = t || TAB_HINT[tab]; };
shelf.addEventListener('pointerover', e => { const t = e.target.closest('[data-hint]'); setHint(t && t.dataset.hint); });
shelf.addEventListener('pointerleave', () => setHint());
left.addEventListener('pointerover', e => { const t = e.target.closest('[title]'); if (t) setHint(t.title); });
left.addEventListener('pointerleave', () => setHint());

// ---------- shelf contents ----------
const icons = {};   // key -> data URL of a little rendered object
const tile = (key, hintText, inner, extra = '') =>
  `<button class="bz-tile ${extra}" data-k="${key}" data-hint="${hintText}" aria-label="${hintText}">${inner}</button>`;
const img = key => icons[key] ? `<img src="${icons[key]}" alt="" draggable="false">` : `<span class="bz-ph"></span>`;
const group = (label, html, cls = '') => `<div class="bz-group ${cls}"><div class="bz-gt">${html}</div><div class="bz-gl">${label}</div></div>`;

const CREATE = [
  ['Landscape', [['terrain', 'Hill: a terrain patch'], ['floater', 'Floating isle'], ['clouds', 'Cloud layer'], ['lamp', 'Lamp: a point light'], ['@floor', 'Infinite plane: floor or water']]],
  ['Shapes', ['sphere', 'cube', 'cylinder', 'cone', 'torus', 'pyramid', 'octahedron'].map(k => [k])],
  ['Architecture', [['arch'], ['archwall', 'Arched wall'], ['column']]],
  ['Library', [['@models', 'Model library: trees, statues, furniture…'], ['@scenes', 'New scene: presets and landscapes']]],
];
const TOOLS = [
  ['translate', 'Move (W)', '<path d="M20 4v32M4 20h32M20 4l-5 5M20 4l5 5M20 36l-5-5M20 36l5-5M4 20l5-5M4 20l5 5M36 20l-5-5M36 20l-5 5"/>'],
  ['rotate', 'Rotate (E)', '<path d="M31 13a13 13 0 1 0 2 11"/><path d="M33 5v9h-9"/>'],
  ['scale', 'Scale (R)', '<rect x="5" y="15" width="20" height="20"/><path d="M15 5h20v20" stroke-dasharray="3 3"/><path d="M22 18l11-11M33 7h-6M33 7v6"/>'],
  ['dup', 'Duplicate (⌘D)', '<rect x="5" y="12" width="18" height="18"/><rect x="15" y="5" width="18" height="18"/>'],
  ['drop', 'Drop to ground', '<path d="M20 4v20M13 17l7 7 7-7M5 32h30M9 36h22"/>'],
  ['frame', 'Frame selection (F)', '<path d="M5 13V5h8M27 5h8v8M35 27v8h-8M13 35H5v-8"/><circle cx="20" cy="20" r="5"/>'],
  ['deselect', 'Deselect (Esc)', '<rect x="7" y="7" width="26" height="26" stroke-dasharray="4 3"/>'],
  ['del', 'Delete', '<path d="M8 10h24M16 10V6h8v4M11 10l2 25h14l2-25M17 16v14M23 16v14"/>'],
];
const MAT_TILES = [['matte', 'Matte'], ['granite', 'Granite'], ['glossy', 'Glossy'], ['metal', 'Metal mirror'], ['glass', 'Glass'], ['checker', 'Checker'], ['tile', 'Glazed tiles'], ['glow', 'Glow']];
const svg = d => `<svg viewBox="0 0 40 40" aria-hidden="true">${d}</svg>`;

function renderShelf() {
  win.dataset.bztab = tab;
  left.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (!T || !T.doc) { tiles.innerHTML = ''; setHint(); return; }
  let html = '';
  if (tab === 'create') {
    html = CREATE.map(([label, items]) => group(label, items.map(([k, label]) => tile(k, label || T.TYPES[k], img(k))).join(''))).join('');
  } else if (tab === 'edit') {
    const o = T.sel, can = !!o, mats = can && !['lamp', 'clouds', 'model'].includes(o.type);
    html = group('Tools', TOOLS.map(([k, label, d]) => {
      const off = !can || (k === 'rotate' && o.type === 'lamp') || ((k === 'rotate' || k === 'scale' || k === 'drop') && o.type === 'clouds');
      return tile(k, label, svg(d), `bz-key${off ? ' off' : ''}${can && T.gizmoMode === k ? ' on' : ''}`);
    }).join(''))
      + group(mats ? 'Materials' : can ? 'Materials · not for this object' : 'Materials · select an object first',
        MAT_TILES.map(([k, label]) => tile('mat:' + k, label, img('mat:' + k), `${mats ? '' : 'off'}${mats && o.mat === k ? ' on' : ''}`)).join(''));
  } else if (tab === 'sky') {
    const L = T.currentLook(), P = T.PALETTES;
    html = group('Palette', Object.keys(P).map(k => {
      const p = P[k];
      return tile('pal:' + k, `Palette: ${k[0].toUpperCase() + k.slice(1)}`, `<i class="bz-chip" style="background:linear-gradient(${p.zenith} 0%, ${p.horizon} 52%, ${p.high} 53%, ${p.mid} 66%, ${p.low} 80%, ${p.water} 81%)"></i>`, `bz-sw${L.pal === k ? ' on' : ''}`);
    }).join(''), 'bz-pals')
      + group('Time', Object.entries(T.LOOK_TIMES).map(([k, v]) => tile('time:' + k, `Time: ${v}`, `<i class="bz-mini t-${k}"></i>`, `bz-sq${L.time === k ? ' on' : ''}`)).join(''))
      + group('Weather', Object.entries(T.LOOK_WEATHER).map(([k, v]) => tile('weather:' + k, `Weather: ${v}`, `<i class="bz-mini w-${k}"></i>`, `bz-sq${L.weather === k ? ' on' : ''}`)).join(''))
      + group('Sun', `<div class="bz-dial" data-hint="Sun dial: drag the sun. Top = in front of the camera, centre = overhead" role="slider" aria-label="Sun position" tabindex="0"><i class="bz-sun"></i></div>`)
      + group('Dice', tile('rsun', 'Random sun position', '<i class="bz-die">⚄</i>', 'bz-sq') + tile('rterr', 'New terrain pattern', '<i class="bz-die">⛰</i>', 'bz-sq'));
  } else {
    const q = T.traceQuality, r = T.resKey, c = T.colorMode;
    html = group('Go', tile('go', 'Ray traced render (Enter)', '<i class="bz-orb red"></i>', 'bz-sq') + tile('snap', 'Quick snapshot (raster)', '<i class="bz-orb amber"></i>', 'bz-sq'))
      + group('Quality', [['draft', 'Draft · 4 passes', 0.5], ['normal', 'Normal · 16 passes', 0.2], ['fine', 'Fine · up to 64 passes', 0.04]].map(([k, label, n]) =>
        tile('q:' + k, label, `<img src="${noiseBall(n)}" alt="">`, `bz-sq${q === k ? ' on' : ''}`)).join(''))
      + group('Size', [['400', '400 × 300', 14], ['640', '640 × 480', 20], ['800', '800 × 600', 26], ['full', 'Full screen resolution', 30], ['custom', 'Custom size…', 0]].map(([k, label, w]) =>
        tile('r:' + k, label, w ? `<i class="bz-size" style="width:${w}px;height:${w * 0.75}px"><b>${k === 'full' ? 'Full' : k}</b></i>` : '<i class="bz-size any"><b>W×H</b></i>', `bz-sq${r === k ? ' on' : ''}`)).join(''))
      + group('Colors', [[0, 'Millions of colors', 64], [1, 'Thousands of colors', 12], [2, '256 colors', 4]].map(([k, label, n]) =>
        tile('c:' + k, label, `<i class="bz-bands" style="background:${bands(n)}"></i>`, `bz-sq${c === k ? ' on' : ''}`)).join(''))
      + group('Output', tile('save', 'Save image… (⌘E)', `<i class="bz-disk"></i>`, 'bz-sq'));
  }
  tiles.innerHTML = html;
  if (tab === 'sky') placeSun();
  setHint();
}
// a stepped gradient for the colour-depth tiles
function bands(n) {
  const stops = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1), col = `hsl(${20 + t * 200} 70% ${35 + t * 30}%)`;
    stops.push(`${col} ${(i / n * 100).toFixed(1)}%`, `${col} ${((i + 1) / n * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(',')})`;
}
// a shaded ball with ray-trace grain: more grain = lower quality
const noiseCache = {};
function noiseBall(n) {
  if (noiseCache[n]) return noiseCache[n];
  const S = 40, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), im = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - 20) / 15, dy = (y - 18) / 15, rr = dx * dx + dy * dy, i = (y * S + x) * 4;
    let col;
    if (rr < 1) { const z = Math.sqrt(1 - rr), l = Math.max(0, -dx * 0.5 - dy * 0.6 + z * 0.62); col = [40 + 210 * l, 140 + 100 * l, 150 + 90 * l]; }
    else { const s = Math.max(0, 1 - Math.hypot(x - 22, y - 34) / 14); col = [200 - 90 * s, 170 - 80 * s, 120 - 60 * s]; if (y < 30) col = [120 + y * 3, 150 + y * 2.5, 220]; }
    const k = 1 + (Math.random() - 0.5) * 2 * n * 1.6;
    im.data[i] = col[0] * k; im.data[i + 1] = col[1] * k; im.data[i + 2] = col[2] * k; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return (noiseCache[n] = c.toDataURL());
}

const ensureEdit = () => { if (T.mode !== 'edit') T.setMode('edit'); };
function pickSelect(id, value) { const s = $(id); s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); }
tiles.addEventListener('click', e => {
  const b = e.target.closest('.bz-tile'); if (!b || !T || b.classList.contains('off')) return;
  const k = b.dataset.k, [kind, val] = k.split(':');
  if (tab === 'create') {
    if (k === '@floor') { T.showWorld('Ground'); setTab('sky'); T.redraw(); return; }
    if (k === '@models') return T.openBrowser();
    if (k === '@scenes') return T.openScenePresets();
    return T.create(k);
  }
  if (tab === 'edit') {
    if (kind === 'mat') {
      const s = document.querySelector('#inspector select[data-f=mat]'); if (!s) return;
      s.value = val; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
      return renderShelf();
    }
    ensureEdit();
    ({ translate: () => T.setGizmo('translate'), rotate: () => T.setGizmo('rotate'), scale: () => T.setGizmo('scale'), dup: T.duplicate, drop: T.dropToGround,
       frame: T.frameSel, deselect: () => T.select(null), del: T.deleteSel })[k]();
    return renderShelf();
  }
  if (tab === 'sky') {
    if (kind === 'pal' || kind === 'time' || kind === 'weather') return T.setLookValue(kind === 'pal' ? 'pal' : kind, val);
    if (k === 'rsun') return T.randomSun();
    if (k === 'rterr') { ensureEdit(); return T.newLandscapePattern(); }
  }
  if (tab === 'render') {
    if (k === 'go') return T.renderFinal(true);
    if (k === 'snap') return T.renderFinal(false);
    if (k === 'save') return T.saveImage();
    if (kind === 'q') pickSelect('qualitySel', val);
    if (kind === 'r') pickSelect('resSel', val);
    if (kind === 'c') T.setColors(+val);
    renderShelf();
  }
});

// ---------- sun dial: camera-relative, top of the dial is straight ahead ----------
const camYaw = () => { const f = T.orbit.target.clone().sub(T.camera.position); return Math.atan2(f.x, -f.z) * 180 / Math.PI; };
function placeSun() {
  const d = tiles.querySelector('.bz-dial'); if (!d || !T.doc) return;
  const s = T.doc.sky, a = (s.az - camYaw()) * Math.PI / 180, r = (1 - s.elev / 90) * 26;
  const sun = d.querySelector('.bz-sun');
  sun.style.transform = `translate(${Math.sin(a) * r}px, ${-Math.cos(a) * r}px)`;
  d.classList.toggle('night', !!s.night);
}
let dialRaf = 0;
tiles.addEventListener('pointerdown', e => {
  const d = e.target.closest('.bz-dial'); if (!d) return;
  e.preventDefault(); d.setPointerCapture(e.pointerId);
  const move = ev => {
    const r = d.getBoundingClientRect(), x = ev.clientX - r.left - r.width / 2, y = ev.clientY - r.top - r.height / 2;
    const rad = Math.min(1, Math.hypot(x, y) / 26), az = Math.atan2(x, -y) * 180 / Math.PI + camYaw();
    cancelAnimationFrame(dialRaf);
    dialRaf = requestAnimationFrame(() => {
      ensureEdit();
      T.skyChange(s => { s.elev = Math.max(1, Math.min(85, 90 * (1 - rad))); s.az = ((az + 540) % 360) - 180; });
      placeSun();
    });
  };
  move(e);
  d.onpointermove = move;
  d.onpointerup = d.onpointercancel = () => { d.onpointermove = null; };
});

// ---------- camera: trackball, pan cross, fly pair, zoom ----------
const V = () => new T.THREE.Vector3();
function moved() { T.orbit.update(); T.redraw(); }
function orbitBy(dx, dy) {
  const { camera, orbit, THREE } = T;
  const off = camera.position.clone().sub(orbit.target), sp = new THREE.Spherical().setFromVector3(off);
  sp.theta -= dx * 0.008; sp.phi = Math.max(0.03, Math.min(Math.PI - 0.03, sp.phi - dy * 0.008));
  off.setFromSpherical(sp); camera.position.copy(orbit.target).add(off); moved();
}
function panBy(px, py, k) {
  const { camera, orbit } = T, d = camera.position.distanceTo(orbit.target) * k;
  const right = V().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  const delta = right.multiplyScalar(px * d).add(V().set(0, py * d, 0));
  camera.position.add(delta); orbit.target.add(delta); moved();
}
function flyBy(dir, k) {
  const { camera, orbit } = T, f = orbit.target.clone().sub(camera.position), d = f.length() * k;
  f.setY(0).normalize().multiplyScalar(dir * Math.max(d, 0.3));
  camera.position.add(f); orbit.target.add(f); moved();
}
function zoomBy(f) {
  const { camera, orbit } = T, off = camera.position.clone().sub(orbit.target).multiplyScalar(f);
  off.setLength(Math.min(orbit.maxDistance, Math.max(orbit.minDistance, off.length())));
  camera.position.copy(orbit.target).add(off); moved();
}
function setView(kind) {
  const { camera, orbit } = T, d = camera.position.distanceTo(orbit.target);
  const dir = { top: [0, 1, 0.002], front: [0, 0.14, 1], side: [1, 0.14, 0], iso: [0.8, 0.7, 1] }[kind];
  camera.position.copy(orbit.target).add(V().fromArray(dir).setLength(d)); moved();
}
// press-and-hold repeat for the arrow buttons
function hold(btn, fn) {
  let raf = 0, last = 0;
  const loop = t => { fn(Math.min(0.05, (t - last) / 1000 || 0.016)); last = t; raf = requestAnimationFrame(loop); };
  btn.addEventListener('pointerdown', e => {
    if (!T || !T.doc) return;
    e.preventDefault(); btn.setPointerCapture(e.pointerId); ensureEdit(); btn.classList.add('down');
    last = performance.now(); fn(0.016); raf = requestAnimationFrame(loop);
  });
  const stop = () => { cancelAnimationFrame(raf); btn.classList.remove('down'); };
  btn.addEventListener('pointerup', stop); btn.addEventListener('pointercancel', stop);
}
left.querySelectorAll('[data-pan]').forEach(b => { const [x, y] = b.dataset.pan.split(',').map(Number); hold(b, dt => panBy(x, y, dt * 0.9)); });
left.querySelectorAll('[data-fly]').forEach(b => hold(b, dt => flyBy(+b.dataset.fly, dt * 1.2)));
left.querySelectorAll('[data-zoom]').forEach(b => hold(b, dt => zoomBy(Math.pow(+b.dataset.zoom, dt * 20))));
left.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { if (!T || !T.doc) return; ensureEdit(); setView(b.dataset.view); }));

const ball = left.querySelector('.bz-ball');
let rollX = 0, rollY = 0;
ball.addEventListener('pointerdown', e => {
  if (!T || !T.doc) return;
  e.preventDefault(); ball.setPointerCapture(e.pointerId); ensureEdit(); ball.classList.add('down');
  let px = e.clientX, py = e.clientY;
  ball.onpointermove = ev => {
    const dx = ev.clientX - px, dy = ev.clientY - py; px = ev.clientX; py = ev.clientY;
    orbitBy(dx, dy);
    rollX += dx; rollY += dy; ball.style.backgroundPosition = `${rollX}px ${rollY}px, 0 0`;
  };
  ball.onpointerup = ball.onpointercancel = () => { ball.onpointermove = null; ball.classList.remove('down'); };
});

// ---------- modes ----------
function setTab(t) {
  if (!T) { tab = t; renderShelf(); return; }
  tab = t;
  if (t === 'sky' && T.panel !== 'world') T.showWorld('Sky');
  if (t === 'render') T.renderFinal(true);
  renderShelf(); syncFloat();
}
left.querySelector('.bz-modes').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
left.querySelector('.bz-render').addEventListener('click', () => T && T.renderFinal(true));
left.querySelector('.bz-nano').addEventListener('click', () => T && T.renderFinal(true));

// ---------- floating palette: docked beside the view, or floating anywhere in the window ----------
const fstate = (() => { try { return JSON.parse(localStorage.getItem('bz-palette')) || {}; } catch { return {}; } })();
fstate.dock ??= innerWidth >= 1250;   // dock by default when there is room for it
const saveF = () => { try { localStorage.setItem('bz-palette', JSON.stringify(fstate)); } catch {} };
const dockBtn = float.querySelector('.bz-fdock');
function placeFloat() {
  float.classList.toggle('dock', !!fstate.dock);
  win.classList.toggle('bz-docked', !!fstate.dock);
  float.classList.toggle('min', !!fstate.min);
  dockBtn.textContent = fstate.dock ? '⇱' : '⇥';
  dockBtn.title = fstate.dock ? 'Float over the view' : 'Dock beside the view';
  if (fstate.dock) { float.style.left = float.style.top = ''; return; }
  const wr = win.getBoundingClientRect(), vr = viewWrap.getBoundingClientRect();
  const x = fstate.x ?? vr.right - wr.left - float.offsetWidth - 10, y = fstate.y ?? vr.top - wr.top + 10;
  float.style.left = Math.max(0, Math.min(win.clientWidth - float.offsetWidth, x)) + 'px';
  float.style.top = Math.max(22, Math.min(win.clientHeight - 30, y)) + 'px';
}
function syncFloat() {
  if (!T) return;
  const show = tab === 'sky' ? 'worldPage' : tab === 'render' ? '' : tab === 'create' && T.panel === 'start' ? 'startPage' : 'objPage';
  for (const id of ['startPage', 'worldPage', 'objPage']) $(id).classList.toggle('bz-show', id === show);
  float.classList.toggle('idle', !show);   // docked, it keeps its place so the view doesn't jump; floating, it hides
  float.querySelector('.bz-ftitle').textContent = { startPage: 'New Scene', worldPage: 'Sky & Fog · Ground', objPage: T.sel ? `Edit · ${T.sel.name}` : 'Objects' }[show] || '';
  win.dataset.mode = T.mode;
}
float.querySelector('.bz-fmin').addEventListener('click', () => { fstate.min = !fstate.min; saveF(); placeFloat(); });
dockBtn.addEventListener('click', () => {
  if (fstate.dock) {   // float it just inside the view's right edge
    const wr = win.getBoundingClientRect(), vr = viewWrap.getBoundingClientRect();
    fstate.x = vr.right - wr.left - float.offsetWidth - 10; fstate.y = vr.top - wr.top + 10;
  }
  fstate.dock = !fstate.dock; saveF(); placeFloat();
});
// Drag the title bar to move it. Dragging a docked palette pulls it out; dropping it just right of the view docks it again.
// generous, since the view re-centres once the palette leaves the dock: near the top, and either
// hanging over the view's right edge or pushed against the window's right edge
const nearDock = () => {
  const fr = float.getBoundingClientRect(), sr = stage.getBoundingClientRect();
  return fr.top < sr.top + 160 && ((fr.left > sr.right - 120 && fr.left < sr.right + 120) || fr.right > win.clientWidth - 6);
};
float.querySelector('.bz-fhead').addEventListener('pointerdown', e => {
  if (e.target.closest('button') || e.button !== 0) return;
  const head = e.currentTarget, wr = win.getBoundingClientRect();
  if (fstate.dock) {
    const fr = float.getBoundingClientRect();
    fstate.dock = false; fstate.x = fr.left - wr.left; fstate.y = fr.top - wr.top; placeFloat();
  }
  head.setPointerCapture(e.pointerId);
  const ox = e.clientX - float.offsetLeft, oy = e.clientY - float.offsetTop;
  head.onpointermove = ev => { fstate.x = ev.clientX - ox; fstate.y = ev.clientY - oy; placeFloat(); float.classList.toggle('snap', nearDock()); };
  head.onpointerup = head.onpointercancel = () => {
    head.onpointermove = null;
    if (nearDock()) fstate.dock = true;
    float.classList.remove('snap'); saveF(); placeFloat();
  };
});
addEventListener('resize', placeFloat);

// ---------- render readout, render ball, nano preview, clock ----------
const lcd = left.querySelector('.bz-lcd'), nano = left.querySelector('.bz-nano canvas'), renderBall = left.querySelector('.bz-render');
let t0 = 0, elapsed = 0, rendering = false;
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
function tick() {
  if (!T) return;
  const busy = T.mode !== 'edit' && !T.renderDone;
  if (busy && !rendering) { t0 = performance.now(); rendering = true; }
  if (busy) elapsed = (performance.now() - t0) / 1000;
  const m = $('msg').textContent.match(/pass (\d+)\/(\d+)/);
  lcd.querySelector('.t').textContent = fmt(elapsed);
  lcd.querySelector('.p').textContent = busy ? (m ? `PASS ${m[1]}/${m[2]}` : 'TRACING') : T.mode === 'edit' ? 'READY' : 'DONE';
  const [w, hh] = T.size; lcd.querySelector('.s').textContent = `${w}×${hh} ${T.traceQuality.toUpperCase()}`;
  renderBall.classList.toggle('busy', busy);
  if (rendering && !busy) {   // a render just finished: keep a thumbnail of it
    rendering = false;
    if (T.renderDone) {
      const g = nano.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(T.canvas, 0, 0, nano.width, nano.height);
      left.querySelector('.bz-nano').classList.add('has');
    }
  }
}
setInterval(tick, 100);
const clock = mac.querySelector('.bz-clock');
const setClock = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
setClock(); setInterval(setClock, 15000);

// ---------- icons: each shelf object rendered once, teal and glossy like a 90s toolbox ----------
function renderIcons() {
  const { THREE, renderer } = T, S = 128;
  const rt = new THREE.WebGLRenderTarget(S, S); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20000);
  const key = new THREE.DirectionalLight(0xfff4e0, 3.2); key.position.set(-1, 2.2, 1.6);
  scene.add(key, new THREE.HemisphereLight(0xcfe0ff, 0x8a6a40, 1.4));
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), buf = new Uint8Array(S * S * 4), im = g.createImageData(S, S);
  const TEAL = '#2b9aa0';
  const base = (type, extra = {}) => ({ id: -1, type, name: '', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], mat: 'glossy', color: TEAL, ...extra });
  const own = [];   // geometries/materials made here, disposed afterwards
  const builders = {
    terrain: () => T.buildObject(base('terrain', { mat: 'land', scale: [1, 2.4, 1], terrain: { ...T.TOBJ_DEFAULTS, shape: 'outcrop', height: 60, sharp: 0.9, tseed: 31 } })),
    floater: () => T.buildObject(base('floater', { mat: 'land', terrain: { ...T.FLOAT_DEFAULTS, tseed: 7 } })),
    clouds: () => {
      const grp = new THREE.Group(), geo = new THREE.SphereGeometry(1, 24, 16), mat = T.makeMaterial({ mat: 'matte', color: '#f6f6fa' });
      own.push(geo, mat);
      [[0, 0, 0, 1.3], [1.4, -0.2, 0.2, 1], [-1.4, -0.25, 0, 0.95], [0.5, 0.7, -0.2, 0.9], [-0.6, 0.5, 0.3, 0.8]].forEach(([x, y, z, r]) => {
        const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(r, r * 0.8, r); grp.add(m);
      });
      return grp;
    },
    lamp: () => T.buildObject(base('lamp', { color: '#ffd890', mat: 'matte' })),
    // Bryce's infinite plane: a teal and white checkerboard tile
    '@floor': () => {
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const g2 = c.getContext('2d');
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g2.fillStyle = (i + j) % 2 ? '#1f8a90' : '#e8f4f0'; g2.fillRect(i, j, 1, 1); }
      const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
      const shiny = T.makeMaterial({ mat: 'metal' });   // only borrowed for its reflection map
      const geo = new THREE.BoxGeometry(10, 0.25, 10), mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0.2, envMap: shiny.envMap });
      own.push(geo, mat, tex, shiny);
      return new THREE.Mesh(geo, mat);
    },
    // a new world: a craggy island in a little square of sea
    '@scenes': () => {
      const grp = T.buildObject(base('terrain', { mat: 'land', scale: [1, 1.8, 1], terrain: { ...T.TOBJ_DEFAULTS, shape: 'ridge', height: 50, sharp: 0.7, tseed: 5 } }));
      const geo = new THREE.BoxGeometry(220, 4, 220), mat = T.makeMaterial({ mat: 'glossy', color: '#2a5aa8' });
      own.push(geo, mat);
      const sea = new THREE.Mesh(geo, mat); sea.position.y = 8; grp.add(sea);
      return grp;
    },
    '@models': () => T.buildObject(base('model', { model: T.MODELS.tree ? 'tree' : Object.keys(T.MODELS)[0], mat: 'matte' })),
  };
  for (const k of ['sphere', 'cube', 'cylinder', 'cone', 'torus', 'pyramid', 'octahedron', 'arch', 'archwall', 'column'])
    builders[k] = () => T.buildObject(base(k, k === 'column' || k === 'archwall' || k === 'arch' ? { mat: 'granite', color: '#e4dccb' } : {}));
  for (const [m] of MAT_TILES)
    builders['mat:' + m] = () => T.buildObject(base('sphere', { mat: m, color: { matte: '#d8c8b0', granite: '#c8bca8', glossy: TEAL, metal: '#dcdcdc', glass: '#d8f0ff', tile: '#e0eaff', glow: '#ffcf70' }[m] || '#ccc' }));
  const dir = new THREE.Vector3(0.85, 0.55, 1.3).normalize();
  for (const [k, build] of Object.entries(builders)) {
    let obj;
    try {
      obj = build(); scene.add(obj); obj.updateMatrixWorld(true);
      const sph = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
      if (k === 'lamp') sph.radius = 4.5;
      const dist = sph.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * (k.startsWith('mat:') ? 0.98 : 1.04);
      cam.position.copy(sph.center).addScaledVector(dir, dist); cam.lookAt(sph.center);
      cam.near = dist / 100; cam.far = dist * 4; cam.updateProjectionMatrix();
      renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
      for (let y = 0; y < S; y++) im.data.set(buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
      g.putImageData(im, 0, 0);
      icons[k] = cv.toDataURL();
    } catch (err) { console.warn('bryce icon', k, err); }
    if (obj) {
      scene.remove(obj);
      obj.traverse(n => {
        if (n.isLight && n.shadow && n.shadow.map) n.shadow.map.dispose();
        if (!n.isMesh && !n.isSprite) return;
        if (n.userData.patch) n.geometry.dispose();
        [].concat(n.material).forEach(m => m && m.userData.owned && m.dispose());
      });
    }
  }
  own.forEach(x => x.dispose());
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 1);
  rt.dispose(); T.redraw();
}

// ---------- hook up to the engine ----------
document.addEventListener('terrascape:change', e => {
  const what = e.detail;
  if (what === 'ready') {
    T = window.terrascape;
    try { renderIcons(); } catch (err) { console.warn('bryce icons', err); }
    placeFloat(); renderShelf(); syncFloat();
    return;
  }
  if (!T) return;
  if (what === 'panel' && T.panel === 'start') { if (fstate.min) { fstate.min = false; placeFloat(); } if (tab !== 'create') { tab = 'create'; renderShelf(); } }
  if (what === 'world' && tab !== 'sky' && tab !== 'render') { tab = 'sky'; renderShelf(); }
  if (what === 'select' && T.sel && (tab === 'sky' || tab === 'render')) { tab = 'edit'; renderShelf(); }
  else if (what === 'select' && tab === 'edit') renderShelf();
  if (what === 'sky' || what === 'doc') { if (tab === 'sky') renderShelf(); }
  if (what === 'mode' && tab === 'render') renderShelf();
  syncFloat();
});
// gizmo hotkeys (W/E/R) change the tool without an event; keep the Edit shelf in step
addEventListener('keyup', e => { if (T && tab === 'edit' && ['w', 'e', 'r', 'escape', 'delete', 'backspace', 'd'].includes(e.key.toLowerCase())) renderShelf(); });
renderShelf();
})();
