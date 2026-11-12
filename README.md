# Terrascape 2.0

A 90s-style landscape renderer in the browser, built on three.js: fractal terrain, procedural
"smooth but noisy" materials, a supersampled raster render, and a from-scratch Whitted ray tracer
(hard shadows, mirror reflections, glass refraction, height-grid terrain).

- Scene editor with a New Scene wizard (World → Look → Arrangement), object list, inspector and Win95-style menus
- Landscape presets, floating isles, clouds, night sky with NASA's LRO moon map
- Free CC0 models from [Poly Haven](https://polyhaven.com), loaded live

## Run locally

```bash
python3 serve.py 8765
```

Then open http://localhost:8765. (`serve.py` disables caching so edited modules always reload.)

Credits: three.js, three-mesh-bvh, Poly Haven (CC0), NASA LRO moon map via Wikimedia Commons (public domain).
