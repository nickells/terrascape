# Terrascape: notes for coding agents

Single-page three.js app with a from-scratch ray tracer (`index.html`, `tracer.js`). Serve with `python3 serve.py <port>`; test with `npm test`.

## Making scene art

For any request like "recreate this image", "try a few ideas for a scene", or "render X", follow
[.claude/skills/scene-art/SKILL.md](.claude/skills/scene-art/SKILL.md). It is the single source of truth for the
variant-and-render workflow, the `SCENES` preset API and the gotchas. (Claude Code loads it as a skill; other agents, including Codex, should read it directly.)

Render headlessly, never by clicking through the UI (needs Google Chrome installed):

```bash
node scripts/render.mjs --scene tbDrift --seed 42 --size 400x400 --quality draft --out /tmp/preview.png
```

Do not commit unless asked.
