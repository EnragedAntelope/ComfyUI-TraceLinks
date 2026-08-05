# AGENTS.md — ComfyUI-TraceLinks

A pure viewing aid for ComfyUI that lets you dim or hide node links by their data type, so you can trace a single path (just `IMAGE` links, or just `MODEL`) through a busy workflow. Never changes the graph, links, execution, or saved workflow — only changes how links are drawn on screen. Zero Python dependencies. Works in both classic LiteGraph and Nodes 2.0 (Vue) render modes.

## Architecture in 60 seconds

- **Frontend-only.** The Python side (`__init__.py`) is a minimal ComfyUI custom-node entry point. All logic lives in `web/tracelinks.js` + `tracelinks.css`.
- **Per-type link filtering.** Scans the current graph's link types, presents a sidebar panel with toggles. Click the eye to show/hide a type; click solo to isolate it.
- **Dim or hide.** Muted links can fade to a faint ghost (preserves spatial context) or disappear completely. Ghost strength is adjustable via slider.
- **Master toggle.** Alt+T flips the whole effect on/off without leaving the canvas. Hotkey is rebindable.
- **Settings persistence.** Choices stored locally (never written into the workflow file).
- **Dual render mode support.** Works identically in classic LiteGraph and Nodes 2.0 (Vue).

## Layout

| File / Directory | Purpose |
|------------------|---------|
| `__init__.py` | ComfyUI custom-node entry point (minimal, registers the extension) |
| `web/tracelinks.js` | All frontend logic: link scanning, filtering, dim/hide, solo, hotkey |
| `web/tracelinks.css` | Styling for the sidebar panel |
| `assets/` | Screenshots and hero images for README |
| `docs/` | Additional documentation |

## Build / test / run

```bash
# Install via ComfyUI Manager (recommended)
# Search for "TraceLinks" in the Manager

# Manual install
cd ComfyUI/custom_nodes
git clone https://github.com/EnragedAntelope/ComfyUI-TraceLinks
# Restart ComfyUI, refresh browser

# No automated tests — manual QA via ComfyUI
# Verify: sidebar panel appears, toggles work, solo isolates a type, Alt+T toggles
```

## Conventions & gotchas

- Zero Python dependencies. Drops into `custom_nodes/` — no pip install.
- Pure viewing aid — never modifies the graph, links, or execution.
- Settings are stored locally (browser storage), never serialized into the workflow JSON.
- The JS file is the entire feature — keep it self-contained, no build step, no bundler.
- Works in both render modes (LiteGraph and Vue/Nodes 2.0) — test changes in both.
- The sidebar panel uses ComfyUI's CSS custom properties for theming.

## Security

This file is **public-safe by default**. Never add local paths, credentials, API keys, personal data, infrastructure details, or subscription info.

Before pushing: `pwsh scripts/check-agents-md.ps1 AGENTS.md CLAUDE.md` — must exit 0.

## Maintenance

**Update rule:** When you change the architecture, build/test commands, or conventions, update this AGENTS.md in the same commit. Keep under 200 lines.

**CLAUDE.md:** One-line shim: `@AGENTS.md`.

**New-repo rule:** Create AGENTS.md in the first session a new repo is worked on.

**No-overlap rule:** Explanatory prose lives in one file. AGENTS.md = agent-facing summary; README.md = human/usage. Identical install commands may be restated verbatim. Explanatory prose must not be duplicated — link instead.
