# Curated FurniMesh furniture

60 selected models spanning seating, sofas, tables, desks, beds, storage, lighting,
kitchen and bathroom pieces, decor, and architectural accents.
Open **Add → Browse models… → FurniMesh · curated** in Terrascape.

These are bundled GLBs from public FurniMesh library downloads, not a live catalog
API. Each catalog entry preserves its model page, original download URL, source
photo, license, original and prepared sizes, triangle counts and checksum.
Thumbnails show the actual imported 3D objects rather than their reference photos.

The public model pages described downloads as free for commercial use without
attribution when selected on November 12, 2026. This is **not CC0**; models retain
the [FurniMesh license](https://furnimesh.com/terms/). Library downloads are separate
from the paid photo-to-3D generation service.

## Rebuild the collection

The reviewed selection is recorded in `seed.json`. With Node.js, Python 3 and
macOS `sips` available:

```bash
npm install
npm run seed:furnimesh
```

The importer caches originals outside the repository, validates self-contained
GLB files, caps embedded textures at 1024 pixels, and simplifies toward 80,000
triangles with a 0.001 error threshold. Detailed geometry may stop above that
budget to preserve shape. Prepared files use ordinary GLB data without a runtime
compression decoder. Existing scene IDs stay stable; unrelated curated entries
are preserved. `--refresh` rebuilds prepared models.

After changing the selection, serve the app and open
`/scripts/preview_furnimesh.html`. Visually review all pages, export thumbnails,
then install that downloaded JSON:

```bash
python3 scripts/apply_model_thumbnails.py /path/to/furnimesh-thumbnails.json
npm test
```

Visual review matters: generated models sometimes include extra objects or
interpret a source photo incorrectly. Rejected candidates are replaced before the selection is published.
The individual `scripts/import_furnimesh.py` importer also supports one-off public
model pages; run it with `--help` for naming, category and size options.
