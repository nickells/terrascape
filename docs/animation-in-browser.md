# Animation in the browser: proposal

Status: **built** (see "What shipped" below); the later sections are the original proposal, kept for the reasoning. Before the
panel, clips came from `scripts/animate.mjs`, which drives headless Chrome, calls
`window.terrascape.renderFrame(spec, t)` once per frame, saves PNGs and encodes with ffmpeg. This note covers what it would take
for a visitor to make the same clips on the public site with no Node, Playwright or ffmpeg.

## What shipped

- **Animate… panel** (`openAnimate` in `index.html`): toolbar button after ✦ Render, Render > Animate…, and an Animate tile on the
  Bryce skin's Render shelf. One flow: pick a motion, play or scrub the raster preview, **Render clip…**, then play and download.
- **Shared maths** in `motion.js` (presets, `cameraAt`, `timeAt`), covered by `tests/motion.test.mjs`. `renderFrame` and the CLI
  use it too; the CLI's output is byte-identical to before.
- **Clip runner:** renders frame 0, shows the cost, and asks before starting only if the estimate is over 30 s; progress, ETA and
  Cancel; Esc cancels too. While it runs, everything that could change the scene or start another trace is locked.
- **Encoder:** mediabunny 1.66.0 loaded from unpkg only when a clip is rendered: H.264 mp4 via WebCodecs, VP9 webm if H.264 isn't
  available, else a zip of PNG frames (written in `index.html`, no library). Even sides are enforced by copying each frame into an
  even canvas.
- **Guards:** while a clip renders, a click shield covers both skins and the size, quality and colour logic ignores changes (the
  Bryce tiles dispatch change events past any disabled control). While the panel is open the Lens slider is refused (it would
  write the preview camera into the document), and replacing the scene (New, Open, Undo) closes the panel without putting the old
  camera back. Zero or negative zoom amounts fall back to the preset's default.
- **Caps (placeholders):** 240 frames (10 s at 24 fps) and 1280 px on the longest side, in `CLIP`.
- **The five hook problems:** 1-3 are avoided by the panel (own base camera, a scratch camera object, `job` for cancel) and the
  document is never touched; the CLI's `renderFrame` hook is unchanged. 4 is a hint plus a screen wake lock. 5 (per-frame
  setup cost) is not done.
- **Clouds and water:** *Clouds drift* and *Water ripples* checkboxes in the panel (on by default when the scene has them; pools count
  as water), combinable with any camera move or *Camera still*, and shown in the raster preview too. Amounts are per second of clip
  (`DRIFT` in `motion.js`), matching the script's defaults for a 5 s clip.
- **Speed (turbo):** a ray traced frame used to take ~passes x 6 display frames whatever its size (one band per vsync, so a 640 x 480
  Draft frame cost 0.47 s and Normal 1.66 s, and a 320 px frame cost the same as a 640 px one: the GPU was mostly idle). Clips and
  `renderFrame` now keep the GPU busy back to back in ~60 ms slices that wait on the GPU, off the display-frame clock
  (MessageChannel, so a background tab doesn't pause it either). Draft frames take ~50 ms and Normal ~180 ms, about 9x faster, with
  byte-identical output. Stills keep the one-band-per-frame progressive display.
- **Quiet while exporting:** a still copy of the raster view sits over the canvas (so the trace repainting underneath never shows), the
  toolbar, status line and skin are left as they were, and the panel shows each finished frame in a small live preview. The preview
  costs nothing measurable (120 Draft frames at 640 x 480 took 5.0 s with and without it).
- **Encoder settings:** software H.264 at ~0.5 bit/pixel/frame. The default encoder choice and `prefer-hardware` both stalled ~4 s at
  the 4th frame while the hardware encoder spun up (measured on this Mac), and a quality preset made the software encoder smear
  detail, hence the explicit bitrate. A 3 s Normal-quality 640 x 480 clip now renders in about 8 s.
- **Draggable:** the panel moves by its title bar in both skins, remembers where it was left, and always keeps 100 px of its title bar
  inside its container.
- **Not done:** loop/ping-pong, remembering the last motion, camera keyframes,
  Safari/Firefox testing, and timing on a weaker machine to set the caps for real. Verified in headless Chrome only.

## Recommendation

Add an **Animate…** dialog that renders the frames in the page and encodes them to an mp4 with **WebCodecs**, streaming each
finished frame straight into an encoder so no frames pile up in memory. Reuse `renderFrame` as it is, plus the fixes under
"Problems in the current hook". Keep `animate.mjs` as the CLI front end to the same hook.

Everything runs client-side on the visitor's GPU, so the hosting stays a plain static site.

## What exists

- `renderFrame(spec, t)` (`index.html`) sets the camera (orbit, focus, lens zoom), sets trace-time offsets for clouds, sky and
  water, and runs `renderFinal(true)`. Each call builds the full ray-tracing structures again (`tracer.build`), then runs the
  passes for the chosen quality: Draft 4, Normal 16, Fine up to 64 (stops early once settled).
- The canvas is the output size and keeps its buffer (`preserveDrawingBuffer: true`), so a finished frame can be read straight
  off it, which `animate.mjs` already does.
- Measured on a Mac under headless Chrome: 120 frames at 640×640 Draft took 64 s (about 0.5 s per frame, including setup).
  Visitors' GPUs will differ, often by a lot, so the UI should measure rather than assume.

## UX

- **Entry points.** An `Animate…` button next to `✦ Render` on the toolbar, plus `File > Animate…` in the menu spec. The Bryce
  skin has its own render and save buttons that call into `window.terrascape` (`bryce.js`), so it needs its own Animate button
  wired to a new `terrascape.animate()` hook; it doesn't inherit the classic toolbar's.
- **Dialog**, in the existing `.dialog` style used by Custom Size:
  - Presets first: *Slow push-in* (zoom in 1.15×), *Slow pull-out* (zoom out 1.15×), *Turntable* (360° orbit, the only seamless
    loop), *Drifting clouds*, *Water ripples*. These are the amounts we settled on while testing: 5 s at 24 fps.
  - Then the motions as plain controls: orbit in degrees (negative = other way, an optional "look at" picker listing objects
    in the scene, defaulting to the camera target), zoom in/out with a percentage, cloud drift, water ripples. Motions combine
    as in the script; zoom in and zoom out are one control, so they can't be combined.
  - Length in seconds and fps (24 default), which gives the frame count. Quality and size reuse the existing toolbar settings
    but are shown in the dialog so the estimate makes sense.
- **Estimate before committing.** On *Start*, render frame 0 at the chosen quality, show it, and show "about N min for M
  frames" from its measured time. The user confirms or cancels. This replaces guessing a table of times per device.
- **Progress.** Frame k of M, elapsed, time left, and the latest frame as a thumbnail. **Cancel** stops cleanly.
- **Result.** A preview player and a **Download .mp4** button. File name from the scene name.

## Raster preview (prototype built)

A fast preview in the existing raster edit view, so framing and pace can be judged before a long trace. **File > Preview motion
(prototype)…** opens a small panel with Play/Pause, a scrub bar, a motion preset (push-in, pull-out, turntable, sweep), an
amount and a length, laid out as a compact bar along the bottom of the view. **Center** picks what the camera circles and
looks at: the camera's own target, or the selected object (the middle of its bounding box, since an object's `pos` can be its
base). It follows the selection live, including while the panel is open, until "Camera target" is picked explicitly. The
selection box stays visible; only the drag handles are hidden. The preview never edits the document: the camera and its zoom
live in the preview only (the zoom is part of the undo history, so touching it would have marked the scene modified). It uses the same `applyMotion` as the traced frames, so the preview and the render move identically, and it
puts the camera back on close.

- Measured in headless Chrome at 640×480 on this Mac: holds 60 fps for all four presets (the frame rate is capped at 60, so
  headroom is unknown). Readings from the app's own Browser pane were unreliable because the pane throttles animation frames
  when hidden, which is the same hidden-tab stall noted below.
- Shows camera motion only. Cloud, sky and water drift are trace-time offsets and don't appear. Showing them means applying
  the same offsets to the raster sky and water seeds and moving the cloud meshes.
- Raster lacks reflections and glass, so it judges motion, not the final look; pair it with a Draft ray-traced first and last
  frame in the real dialog.

## Rendering loop

Run the loop in the page, one frame at a time, then after each frame read the canvas and hand it to the encoder (below).
The editor stays in ray mode during the clip and is restored afterwards.

### Problems in the current hook (to fix first)

`renderFrame` was written for a throwaway headless page, and it misbehaves in a live editing session:

1. **It edits the document.** It writes `doc.camera.pos`, `target` and `fov` every frame and never puts them back. Save the
   camera before the clip and restore it on finish or cancel, and reset the `anim` offsets to zero.
2. **`animBase` is cached forever.** It is captured on the first call, so if the user moves the camera and animates again, the
   clip starts from the old view. Capture it fresh at the start of each clip.
3. **Cancelling hangs it.** `setMode` bumps `job`, so a pending trace stops, but `renderFrame`'s promise polls `renderDone`
   forever and never resolves. It needs a cancel path (reject or resolve with a flag).
4. **Hidden tabs stall.** Each band is scheduled with `requestAnimationFrame`, which browsers pause in background tabs. A long
   clip would silently stop if the user switches tab. Tell the user to keep the tab visible, and consider a Screen Wake Lock
   so the machine doesn't sleep mid-render. Not an issue in headless Chrome, so it needs a real browser test.
5. **Per-frame setup cost.** With only the camera, clouds, sky or water moving, the scene geometry hasn't changed, yet the BVH
   and height-field textures are rebuilt every frame. If setup is a visible share of frame time (measure first; the status
   line already reports it), add a path that reuses the built structures and updates uniforms. This is the biggest likely
   speed-up for long clips, but only worth doing if the measurement says so.

## Encoding

| Option | For | Against |
| --- | --- | --- |
| **WebCodecs `VideoEncoder` + an mp4 muxer** (recommended; e.g. Mediabunny, successor to mp4-muxer: verify before choosing) | Explicit per-frame timestamps, so slow or uneven rendering still yields a smooth 24 fps file; streams, so memory stays flat; real mp4 (H.264) that plays everywhere | Needs a small muxer library (loadable from the same CDN as three.js); encoder support varies by browser |
| `MediaRecorder` on `canvas.captureStream()` | No library | Records in real time, so frame timing follows our render speed, not the clip's fps. Output container differs by browser (webm vs mp4). Poor fit |
| ffmpeg.wasm | Same output as the script | About 30 MB download, and its fast build needs cross-origin isolation headers (COOP/COEP), which complicates hosting and the three.js CDN imports. Not worth it |
| Animated GIF/WebP | Works anywhere | Far larger files and 256-colour GIFs band badly on skies. Only as a last resort |

Browser support to confirm at implementation: WebCodecs video encoding is in current Chrome/Edge and recent Safari and Firefox
on desktop, with less certainty on mobile. Feature-detect `VideoEncoder` and `VideoEncoder.isConfigSupported` for H.264
(fall back to VP9 in webm if H.264 is missing). If neither works, offer a **zip of PNG frames** instead of hiding the feature.

## Limits and safety

- Cap frames (for example 240, 10 s at 24 fps) and size (for example 1280 on the long side), higher on desktop. Values are
  placeholders until timed on a few real machines.
- Even sizes only (H.264 needs them); round up the custom size.
- Warn when the estimate is long, and warn about leaving the tab. Don't offer Fine for long clips by default; Draft/Normal is
  the right default for a first try.
- No server, no uploads: the scene and frames never leave the browser.
- Fits the retro skin: same dialog markup, no new global styling.

## Open questions

1. Should the in-app presets also become the script's defaults? Today `animate.mjs` defaults to 1.3× over 48 frames, which
   the user found too fast; 1.15× over 120 frames looked right.
2. Is mp4 required, or is a webm download acceptable where H.264 isn't available?
3. What is the target device? Phones will not manage long clips; do we gate the feature on desktop or just cap it?
4. Do we want a loop-friendly mode (ping-pong, so a push-in plays back as push-in then pull-out)? Cheap to add and makes any
   zoom or sweep loop cleanly.
5. Allow dropping start and end *camera keyframes* instead of motion presets? More powerful, but a separate design.

## Task breakdown

1. Make `renderFrame` safe for a live page: restore camera and offsets, fresh base per clip, cancellable. Add tests where
   practical (a camera-restore check can run in the existing headless setup).
2. Time the per-frame setup vs trace on this machine and one weaker device; decide whether the reuse path (item 5 above) is
   worth building.
3. In-page clip runner: loop, progress, cancel, estimate from frame 0.
4. Encoder: WebCodecs plus muxer behind a feature detect, with the PNG-zip fallback.
5. Animate dialog and entry points (toolbar, File menu, Bryce skin hook), with the presets.
6. Caps, warnings and the hidden-tab/wake-lock handling; test in Chrome, Safari and Firefox.
7. Point `animate.mjs` and the scene-art skill at the shared runner so there is one implementation of the motions.
