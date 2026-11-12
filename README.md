# Terrascape 2.0

A 90s-style landscape renderer in the browser, built on three.js: fractal terrain, procedural
"smooth but noisy" materials, a supersampled raster render, and a from-scratch Whitted ray tracer
(hard shadows, mirror reflections, glass refraction, height-grid terrain).

- Scene presets with live previews, a persistent object list with an Add dropdown, and Win95-style menus
- Environment settings grouped into Ground (terrain + infinite floors/water), Sky, and Look
- Ray tracing as the main Render action; output quality and size in the toolbar
- Independent terrain and surface heights: raising water or a floor never reshapes the landscape
- Landscape presets, floating isles, clouds, night sky with NASA's LRO moon map
- Unified model browser with live [Poly Haven](https://polyhaven.com) scans, curated [FurniMesh](https://furnimesh.com/library/) furniture and architecture; search together or filter by category. Poly Haven models are CC0; FurniMesh models retain their source license.

## Run locally

```bash
python3 serve.py 8765
```

Then open http://localhost:8765. (`serve.py` disables caching so edited modules always reload.)

Credits: three.js, three-mesh-bvh, Poly Haven (CC0), NASA LRO moon map via Wikimedia Commons (public domain).

## Checks

```bash
npm test
```

## Coastal house scene

Choose **New Scene → The Quiet Coast** (or [open the preset](http://localhost:8765/?scene=quietcoast)) for a
minimal coastal interior with detailed FurniMesh furniture. The original geometric study is
also saved in `scenes/the-quiet-coast-original.tsc`. **Restore saved scene** returns
the furnished preset to its saved composition and camera.

## Adding detailed furniture

`python3 scripts/import_furnimesh.py MODEL_PAGE --id stable-model-name --height 11`
imports a publicly downloadable FurniMesh model, optimizes its textures and updates
the searchable catalog. It uses Python 3 and macOS `sips`; no API key is needed.
The app includes 60 curated furniture pieces and a CC0 oil palm, with actual-model previews.
The library browses all sources together; provenance and licenses remain attached to each model. Run `npm install`
and `npm run seed:furnimesh` to rebuild the selection in
`assets/furnimesh/seed.json`. See `assets/furnimesh/README.md` for the review
workflow, sources and license details.
