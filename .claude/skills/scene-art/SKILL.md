---
name: scene-art
description: Design a Terrascape scene from a concept or reference image. Writes several variant scene presets, renders each headlessly, shows them side by side, and converges with the user. Use when the user has a reference/idea and wants to explore looks ("try a few ideas", "recreate this", "make a scene like...").
---

# Scene art in Terrascape

Terrascape is a single-page three.js app (`index.html`) with its own ray tracer. Scenes are presets in the `SCENES` object; render them headlessly with `scripts/render.mjs`. Never click through the UI to render.

## Loop

1. **Read the reference/idea.** Note the few elements that make it recognisable (shapes, palette, composition) and which parts are free to reinterpret. Ask nothing unless truly ambiguous; the user wants your influence.
   *No reference yet?* Pitch 3-4 one-line concepts (setting, mood, palette) and let the user pick or mix before writing any code. Evoke a feeling or era rather than a literal inventory: a "crystal shop" scene should feel like one, not list its stock (the user cut a literal plasma globe for this reason).
2. **Write 3-4 variants** as separate presets (`<name>A`, `<name>B`, ...) next to the existing `tb*` scenes. Make them differ in concept (composition, mood, palette), not just numbers.
3. **Render each at full size, not as a thumbnail**:
   `node scripts/render.mjs --scene <key> --seed 42 --size 2560x2560 --quality fine --out <scratchpad>/<key>.png`
   (about 15 s each on an M-series Mac; run them in one Bash call, with explicit file names, see Gotchas). Full size is cheap and exposes banding, edge cropping and material problems that 400px drafts hide, so you re-render less. Use `--quality draft --size 400x400` only for a throwaway check of a scene with many new objects. Always pin `--seed`: same scene + seed gives identical pixels. Use a size matching the target shape.
4. **Show the images to the user.** Reading a PNG only lets *you* see it; the Claude desktop app does not display it inline. Send each render with the `SendUserFile` tool (`display: "render"`, `status: "normal"`, a caption naming the variant and what it changes); load it first with ToolSearch (`select:SendUserFile`) if it is deferred. Send all variants in one call, in order. Also Read them yourself to judge. In environments without that tool (e.g. Codex), give the absolute file paths. Let the user pick/mix. Do not over-narrate.
5. **Refine the chosen one**, delete the losing variants from `index.html`, then re-render the chosen one at `--quality fine` after each round of changes (`normal`, ~800x800, is fine for a quick tweak). Send the final PNG the same way (`display: "attach"` for a 2560 file the user will save, or `"render"` to view it).
6. Save a keeper still to `scenes/<name>.png` if the user wants one. Don't commit unless asked.

## Scene anatomy

```js
myScene: { label: 'My scene', pal: 'myPal', time: 'day',
  t: { ...DRY, height: 520, stage: 900, stageFloor: -20, floor: 'checker', floorTile: 40 },  // terrain/floor settings
  build({ d, r, side, ball, box, beam, hex, azTo }) {
    box('Name', 'matte', '#29303a', [w, h, depth], [x, y, z], [rx, ry, rz]);
    ball('Name', 'metal', '#f2eee6', radius, x, y, z);
    beam('Stripe', color, [x1,y1,z1], [x2,y2,z2], radius);   // self-lit glow cylinder
    d.camera = { pos: [x, y, z], target: [x, y, z], fov: 40 };
    d.sky = { ...d.sky, ambient: 1.4, elev: r(32, 44), az: azTo(d.camera.pos, d.camera.target) + 180 + side * r(25, 45), fog: 0.00035 };
  } },
```

- `r(a, b)` and `side` (+-1) are seeded randoms: use them for variation, never `Math.random`.
- Palettes live in `PALETTES` (`low, mid, rock, high, zenith, horizon, sun, water`, optional `chkA/chkB` for the checker floor). Materials: land, matte, granite, glossy, metal, glass, checker, tile, glow.
- Floors: `floor: 'checker' | 'tiles' | 'mirror' | 'pool'`; `stage` is the flat clearing radius, so fractal mountains only appear beyond it.
- Library models: `add('model', { name, model: 'local:oil-palm', scale: [1, 1, 1], pos: [x, y, z], rot: [0, ry, 0] })`. Scale 1 is the catalog's `displayHeight` (the oil palm is 70 units). Keys are in `assets/models/catalog.json`; see `piranesi` for `add('model', ...)` on plinths.
- Colourways: to show one scene in several environments, add wrapper presets after `SCENES` closes, e.g. `SCENES.x2 = { ...SCENES.x, pal: 'otherPal', build(ctx) { SCENES.x.build(ctx); ctx.d.sky = { ...ctx.d.sky, elev: 6 }; } }`, plus a palette each. Same geometry, different mood.
- Look at the existing `tbDrift`, `tbSolids`, `tbPrism`, `tbPlane` for worked examples.

## Gotchas

- **Glow brightens colour x2.2.** Multiply neon colours by about 0.45 before passing to `beam`/glow, or they blow out to white.
- **Square (1:1) renders crop the sides.** Keep key objects inside roughly +-100 x-units at the camera distance used; check the first render for cropping.
- **90s CGI look** = checkerboard floor, chrome/glass spheres, hard sun, hazy gradient sky, fractal mountains, saturated gradient stripes. "Vintage" means this style, not a grain filter.
- **Framing.** Mountains that crop at the frame edges: raise `stage` (e.g. 700 to 1150) so they start farther away, and lower `height` (e.g. 520 to 360) so peaks sit inside the frame. Then widen `fov` or pull the camera back before moving objects. Check library models (palm, etc.) are clear of the left/right edges.
- **Glass goes dark at dusk.** For a luminous crystal use a pale `glass` shell around a slightly smaller `glow` copy of the same shape (multiply the glow colour by 0.45). `glossy` reads solid but hides any inner glow.
- **Glowing water.** With `floor: 'pool'`, a thin self-lit `glow` box just under the surface (`y` about -4.5, wide and flat) lights the pool from below. Keep its colour dim (about 0.2x) or it flattens the ripples and tile grid.
- **Too many glow objects break the scene.** About 50+ `beam` segments in one scene made unrelated spheres go black and a palm go grey; about 20-30 was fine. If materials look wrong after adding many beams, cut the count (fewer, longer segments) before debugging anything else.
- **Batch renders in zsh.** `set -- $p` does not word-split, so a loop over `"a b"` strings wrote four renders to one `.png`. Use explicit names (`for k in Gold:golden ...; do s=${k%%:*}; n=${k##*:}; ...`) and `ls` the output folder afterwards.
- **Near-white palettes can posterize.** A very bright sky/sun (the mint daylight colourway) showed flat colour steps in the sky, on glossy spheres and on matte faces at 2560. Soften the horizon/sun and lower `ambient` first; if it persists it is a renderer issue, not a scene bug.
- Resolution is not remembered across page loads; the script sets it via `--size`.
- 4096 is the max side. A fresh model/asset download needs network (Poly Haven), but the plain `tb*` scenes use none.

## Animation

`node scripts/animate.mjs --scene <key> --seed 42 --do orbit,clouds,water --frames 48 --fps 24 --size 800x800 --quality draft --out <scratchpad>/clip`
renders every frame with the ray tracer to `<out>/frame_NNNN.png` and encodes `<out>.mp4` with ffmpeg. No keyframes: `--do` picks the motions (default `orbit`), amounts are over the whole clip and optional: `--orbit 60` (degrees from the start view; `360` is a seamless turntable) or `--orbit -15,15` (from,to: a slow sweep centred on the start view), `--clouds 600` (world units of cloud-layer drift; also `--sky 1.5` for the dome clouds), `--water 3` (ripple travel in noise cells). `slow-zoom-in` / `slow-zoom-out` are lens (FOV) zooms from the scene's own framing, `--zoom 1.3` magnification over the clip by default; they combine with orbit, clouds and water but not with each other. Only the camera orbits (around `camera.target` by default, or `--focus 0,40,0` / `--focus "Object name"` to circle and look at that point; height and distance are kept); clouds and water are offsets applied at trace time, so scenes need no changes. Water/cloud motion is not periodic, so only a 360 orbit loops. Draft frames take ~50 ms and Normal ~180 ms at 640 px (turbo mode: the GPU runs back to back instead of one band per display frame); check a few frames before a long fine render, then `SendUserFile` the mp4.

The app has the same thing for people: **Animate…** (toolbar, Render menu, or the Render shelf in the Bryce skin) previews a camera move (slow push-in, slow pull-out, dolly zoom in or out, turntable, sweep, or camera still, optionally circling the selected object, with cloud and water drift checkboxes) in the fast raster view, then ray traces it into an mp4 in the page (WebCodecs; a zip of PNGs where the browser can't encode video). The motion maths and presets are in `motion.js`, shared by the panel, `renderFrame` and the tests; the script's defaults (1.3x, 48 frames) are separate from the panel's (1.15x, 5 s at 24 fps). Agents should still use `animate.mjs`, not the panel.

## Tools

- `scripts/animate.mjs`: see Animation. Page hook: `terrascape.renderFrame({orbit, clouds, sky, water, zoom}, t)` (t in 0..1) renders one frame.

- `scripts/render.mjs --scene --seed --size WxH --quality draft|normal|fine --out file.png [--timeout s]`: needs Google Chrome; starts its own `serve.py`.
- `window.terrascape` (browser console) exposes the doc, camera, `renderFinal`, `saveImage` for live poking, but prefer the script.
- `npm test` must stay green (46 JS tests + Python tests).
