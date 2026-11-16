---
name: scene-art
description: Design a Terrascape scene from a concept or reference image. Writes several variant scene presets, renders each headlessly, shows them side by side, and converges with the user. Use when the user has a reference/idea and wants to explore looks ("try a few ideas", "recreate this", "make a scene like...").
---

# Scene art in Terrascape

Terrascape is a single-page three.js app (`index.html`) with its own ray tracer. Scenes are presets in the `SCENES` object; render them headlessly with `scripts/render.mjs`. Never click through the UI to render.

## Loop

1. **Read the reference/idea.** Note the few elements that make it recognisable (shapes, palette, composition) and which parts are free to reinterpret. Ask nothing unless truly ambiguous; the user wants your influence.
2. **Write 3-4 variants** as separate presets (`<name>A`, `<name>B`, ...) next to the existing `tb*` scenes. Make them differ in concept (composition, mood, palette), not just numbers.
3. **Render each as a draft**:
   `node scripts/render.mjs --scene <key> --seed 42 --size 400x400 --quality draft --out <scratchpad>/<key>.png`
   (about 4-10 s each; run them in one Bash call). Always pin `--seed`: same scene + seed gives identical pixels. Use a size matching the target shape.
4. **Show the images to the user.** Reading a PNG only lets *you* see it; the Claude desktop app does not display it inline. Send each render with the `SendUserFile` tool (`display: "render"`, `status: "normal"`, a caption naming the variant and what it changes); load it first with ToolSearch (`select:SendUserFile`) if it is deferred. Send all variants in one call, in order. Also Read them yourself to judge. In environments without that tool (e.g. Codex), give the absolute file paths. Let the user pick/mix. Do not over-narrate.
5. **Refine the chosen one**, delete the losing variants from `index.html`, then render at `--quality normal` (~800x800) to check, and finally the large `--quality fine` render (2560x2560 took ~10 s on an M-series Mac). Send the final PNG the same way (`display: "attach"` for a 2560 file the user will save, or `"render"` to view it).
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
- Look at the existing `tbDrift`, `tbSolids`, `tbPrism`, `tbPlane` for worked examples.

## Gotchas

- **Glow brightens colour x2.2.** Multiply neon colours by about 0.45 before passing to `beam`/glow, or they blow out to white.
- **Square (1:1) renders crop the sides.** Keep key objects inside roughly +-100 x-units at the camera distance used; check the draft before the big render.
- **90s CGI look** = checkerboard floor, chrome/glass spheres, hard sun, hazy gradient sky, fractal mountains, saturated gradient stripes. "Vintage" means this style, not a grain filter.
- Resolution is not remembered across page loads; the script sets it via `--size`.
- 4096 is the max side. A fresh model/asset download needs network (Poly Haven), but the plain `tb*` scenes use none.

## Tools

- `scripts/render.mjs --scene --seed --size WxH --quality draft|normal|fine --out file.png [--timeout s]`: needs Google Chrome; starts its own `serve.py`.
- `window.terrascape` (browser console) exposes the doc, camera, `renderFinal`, `saveImage` for live poking, but prefer the script.
- `npm test` must stay green (19 JS tests + Python tests).
