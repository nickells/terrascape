# Terrascape 2.0

A 90s-style landscape renderer in the browser, built on three.js: fractal terrain, procedural
"smooth but noisy" materials, a supersampled raster render, and a from-scratch Whitted ray tracer
(hard shadows, mirror reflections, glass refraction, height-grid terrain).

- Scene presets with live previews, a persistent object list with an Add dropdown, and Win95-style menus
- Environment settings grouped into Ground (terrain + infinite floors/water), Sky, and Look
- Ray tracing as the main Render action; output quality and size in the toolbar
- Independent terrain and surface heights: raising water or a floor never reshapes the landscape
- Landscape presets, floating isles, clouds, night sky with NASA's LRO moon map
- Free CC0 models from [Poly Haven](https://polyhaven.com), loaded live

## Run locally

```bash
python3 serve.py 8765
```

Then open http://localhost:8765. (`serve.py` disables caching so edited modules always reload.)

Credits: three.js, three-mesh-bvh, Poly Haven (CC0), NASA LRO moon map via Wikimedia Commons (public domain).

## Checks

```bash
node --test tests/terrain.test.mjs
```
