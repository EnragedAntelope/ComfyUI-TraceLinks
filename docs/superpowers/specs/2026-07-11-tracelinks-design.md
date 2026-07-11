# ComfyUI-TraceLinks — Design Spec

**Date:** 2026-07-11
**Status:** Approved design, pre-implementation
**Author:** EnragedAntelope (with Claude)

## Problem

Complex ComfyUI workflows become visually tangled — "spaghetti." When a user wants
to understand a workflow or extend it, they need to trace the path of a specific data
type (e.g. only the IMAGE links, or only the MODEL links) through the mess. ComfyUI
already colors links by data type, but every color is drawn at full strength at once,
so isolating one path by eye is hard.

## Goal

Let the user dim or hide node links by their data type, so a single path type stands
out and can be traced. Purely a *viewing* aid — it must never alter the graph,
execution, or saved workflow.

## Non-Goals (YAGNI)

- No per-link (individual edge) toggling — the unit of control is the data *type*.
- No recoloring / custom palette editing (that already exists in ComfyUI themes).
- No Python nodes, no server-side code, no backend state.
- No persistence of state *into* the workflow file.

## Requirements

- **R1** Works in BOTH classic LiteGraph mode and Nodes 2.0 (Vue) mode.
- **R2** Per-type visibility toggles (checkbox per data type present in the graph).
- **R3** One-click "solo" to isolate a single type and de-emphasize the rest.
- **R4** Disabled links dim to a faint ghost by default; a setting switches to full hide.
- **R5** Control lives in a left sidebar tab.
- **R6** A keyboard-toggle command to flip the whole effect on/off.
- **R7** Non-breaking: no mutation of graph, links, execution, or saved JSON.
  If the underlying render API changes, the extension degrades to a no-op, never a crash.
- **R8** State persists across reloads (localStorage), not into the workflow.
- **R9** Installable via ComfyUI Manager; publishable to the ComfyUI Registry.

## Key technical finding (de-risks R1)

In the current ComfyUI frontend, **both** rendering modes draw the connection *lines*
on the LiteGraph canvas. Nodes 2.0 replaced node *bodies* with Vue DOM but keeps the
canvas link renderer. Both resolve a link's color from the same source:

```
link.color || LGraphCanvas.link_type_colors[link.type] || default_link_color
```

(`src/lib/litegraph/src/LGraphCanvas.ts`, shared helper `getLinkTypeColor` in
`src/utils/litegraphUtil.ts`.) Therefore a single hook at the link-draw seam
(`LGraphCanvas.prototype.renderLink`) covers both modes; no per-mode branching.
This assumption is verified live during implementation (screenshots in both modes).

## Architecture

Frontend-only custom-node pack. Minimal Python `__init__.py` that only exposes the web
directory; all logic is a vanilla-JS ES module loaded by the ComfyUI frontend.

```
ComfyUI-TraceLinks/
  __init__.py            # WEB_DIRECTORY = "./web"; NODE_CLASS_MAPPINGS = {}
  pyproject.toml         # Registry metadata (comfyui-node-dev best practices)
  README.md              # usage + screenshots
  LICENSE                # MIT
  web/
    tracelinks.js        # registerExtension entry: wires the pieces below
    store.js             # state + persistence + redraw requests
    renderHook.js        # wraps LGraphCanvas.prototype.renderLink
    typeScanner.js       # distinct link types present + their swatch colors
    sidebar.js           # sidebar tab UI (DOM), reads/writes store
    tracelinks.css       # sidebar styling
```

(Files split by single responsibility. If any grows awkward it can be merged/split
during implementation, but this is the intended shape.)

### Components

1. **store.js** — single source of truth.
   State: `{ enabled: Set<typeName>, mode: 'dim' | 'hide', solo: typeName | null, active: bool }`.
   - `active` is the master on/off (R6).
   - Getter `isTypeVisible(type)`: if `!active` → true; if `solo` set → `type === solo`;
     else → `enabled.has(type)`.
   - `set*` mutators persist to `localStorage` (key `TraceLinks.state`) and emit a
     change event that requests a canvas redraw (`app.canvas?.setDirty(true, true)`).
   - Never touches graph/link objects.

2. **renderHook.js** — the one seam.
   - On install, capture `const orig = LGraphCanvas.prototype.renderLink` and replace
     with a wrapper. The wrapper:
     - Resolves the link's type from the `link` argument passed to `renderLink`.
     - If `store.isTypeVisible(type)` → call `orig` unchanged.
     - Else if `mode === 'hide'` → return without drawing.
     - Else (`dim`) → save `ctx.globalAlpha`, multiply by the ghost factor (~0.12),
       call `orig`, restore alpha.
     - Entire body wrapped in `try/catch`; on any error, fall back to `orig(...)` so the
       canvas can never break (R7). Guarded so double-install is idempotent.

3. **typeScanner.js** — derives the type list.
   - `scan()` iterates `app.graph.links` (and reroutes) collecting distinct `link.type`
     values, mapping each to a color via the frontend's `getLinkTypeColor` (imported if
     exported, else read `LGraphCanvas.link_type_colors[type]` with fallback).
   - Returns `[{ type, color }]` sorted stably. Called by the sidebar on open, on graph
     load (`graphChanged` / `configure`), and via a lightweight refresh button.
   - New types default to enabled.

4. **sidebar.js** — the UI (R5).
   - Registered with `app.extensionManager.registerSidebarTab({ id, icon, title, type:'custom', render })`.
   - `render(el)` builds: header (All / None / Solo-off buttons, dim⇄hide switch,
     master active switch, refresh) + a list of type rows `[swatch][TYPE][eye checkbox][solo]`.
   - Reads current state from store; writes back on interaction. Re-renders on store
     change and on scanner refresh.

5. **tracelinks.js** — entry point.
   - `app.registerExtension({ name: 'TraceLinks', ... })`:
     - `setup()` installs the render hook, restores persisted state, registers the
       sidebar tab.
     - `commands` + `keybindings`: a "Toggle TraceLinks" command bound to a default
       (proposed `Alt+T`; unbind-able) that flips `store.active` (R6).

### Data flow

```
user clicks in sidebar
  -> store mutator (persist + emit)
     -> app.canvas.setDirty(true,true)
        -> next frame: LGraphCanvas draws links
           -> wrapped renderLink consults store.isTypeVisible(type)
              -> dim (globalAlpha) / hide (skip) / normal
```

### Error handling

- Hook wrapper: `try { ... } catch { return orig.apply(this, args) }`. A malformed
  state or an API change can only degrade to normal rendering.
- Missing APIs at load (`registerSidebarTab`, `getLinkTypeColor`) are feature-detected;
  absence disables that piece with a `console.warn`, never throws.
- localStorage parse failure → reset to defaults.

### Non-breaking guarantees (R7)

- No writes to `link.color`, `link.*`, node data, or the graph.
- No effect on serialization: dimming is applied only inside the draw call via canvas
  context alpha, which is per-frame and never stored.
- Disabling/uninstalling the extension restores original rendering (hook is the only
  patch; it defers to the captured original).

## Testing & QA

1. **Static:** ESLint (flat config, no framework) over `web/*.js`.
2. **Manual functional (live local ComfyUI):**
   - Load a busy multi-type workflow.
   - Verify per-type toggle dims/hides only that type; solo isolates one; master
     hotkey flips all; dim vs hide setting; persistence across reload.
   - Repeat in **both** classic and Nodes 2.0 modes (validates R1).
3. **Screenshots:** Playwright captures "all links" vs "IMAGE soloed" (and a hide
   example) for the README.
4. **Regression sanity:** confirm save/load of the workflow JSON is byte-identical
   before/after toggling (proves R7).

## README requirements

The README must, in addition to install/usage prose:
- Show the **sidebar tab** (with its icon) and how to open it, so users can find the
  controls — an annotated screenshot of the panel.
- State the **Alt+T** master toggle hotkey explicitly, and note it is rebindable in
  ComfyUI's Settings → Keybindings.
- Include before/after screenshots (all links vs. a soloed type) captured live.

## Publishing

- `pyproject.toml` per comfyui-node-dev + Registry schema; README and pyproject kept in
  sync (name, description, version, repository URL).
- Push to a new public GitHub repo `ComfyUI-TraceLinks` under the user's account.
- Registry publish is a follow-up the user performs (needs their Registry API key);
  the repo is prepared so it's a one-command step.

## Open questions

None blocking. Default hotkey **`Alt+T`** verified conflict-free against the frontend's
`CORE_KEYBINDINGS` (`src/platform/keybindings/defaults.ts`) — no core binding uses
`Alt+T` or a bare `t`. Rebindable by the user in Settings → Keybindings.
