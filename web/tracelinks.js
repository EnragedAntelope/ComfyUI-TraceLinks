// ComfyUI-TraceLinks
// Dim or hide node links by their data type so a single path can be traced
// through a busy workflow. Frontend-only, non-destructive: it changes nothing
// about the graph, links, execution, or saved JSON -- it only alters how links
// are painted each frame.
//
// One rendering seam (LGraphCanvas.prototype.renderLink) serves both the
// classic LiteGraph canvas and the Nodes 2.0 (Vue) mode, because both still
// paint connection lines on the LiteGraph canvas.

import { app } from "../../scripts/app.js";

const EXT_NAME = "TraceLinks";
const LS_KEY = "ComfyUI.TraceLinks.state";
const SIDEBAR_ID = "tracelinks";
const DEFAULT_LINK_COLOR = "#9A9A9A";

// ---------------------------------------------------------------------------
// State store: the single source of truth. Persisted to localStorage, never
// into the workflow. Mutations persist, notify the UI, and request a redraw.
// ---------------------------------------------------------------------------
const store = {
  active: true, // master on/off (Alt+T)
  mode: "dim", // "dim" | "hide"
  dimStrength: 0.12, // globalAlpha multiplier for dimmed links
  solo: null, // type name to isolate, or null
  disabled: new Set(), // type names explicitly turned off
  _listeners: new Set(),

  /** True if links of this type should be drawn normally. */
  isTypeVisible(type) {
    const key = String(type);
    if (this.solo != null) return key === this.solo;
    return !this.disabled.has(key);
  },

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },

  _emit() {
    this._save();
    requestRedraw();
    for (const fn of this._listeners) {
      try {
        fn();
      } catch (e) {
        console.error("[TraceLinks] listener error", e);
      }
    }
  },

  setActive(v) {
    this.active = !!v;
    this._emit();
  },
  setMode(m) {
    this.mode = m === "hide" ? "hide" : "dim";
    this._emit();
  },
  setDimStrength(v) {
    const n = Number(v);
    if (!Number.isNaN(n)) this.dimStrength = Math.min(1, Math.max(0.02, n));
    this._emit();
  },
  toggleType(type) {
    const key = String(type);
    if (this.disabled.has(key)) this.disabled.delete(key);
    else this.disabled.add(key);
    this._emit();
  },
  setSolo(type) {
    const key = type == null ? null : String(type);
    this.solo = this.solo === key ? null : key;
    this._emit();
  },
  clearSolo() {
    this.solo = null;
    this._emit();
  },
  showAll(types) {
    this.disabled.clear();
    this.solo = null;
    this._emit();
  },
  hideAll(types) {
    this.solo = null;
    for (const t of types) this.disabled.add(String(t));
    this._emit();
  },

  _save() {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          active: this.active,
          mode: this.mode,
          dimStrength: this.dimStrength,
          solo: this.solo,
          disabled: [...this.disabled],
        })
      );
    } catch (e) {
      /* storage unavailable -- run without persistence */
    }
  },

  _load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.active === "boolean") this.active = s.active;
      if (s.mode === "dim" || s.mode === "hide") this.mode = s.mode;
      if (typeof s.dimStrength === "number") this.dimStrength = s.dimStrength;
      if (typeof s.solo === "string" || s.solo === null) this.solo = s.solo;
      if (Array.isArray(s.disabled)) this.disabled = new Set(s.disabled.map(String));
    } catch (e) {
      /* corrupt state -- fall back to defaults */
    }
  },
};

// ---------------------------------------------------------------------------
// LiteGraph access helpers (robust to the bundled frontend not exposing globals)
// ---------------------------------------------------------------------------
function getLGraphCanvasClass() {
  return (typeof window !== "undefined" && window.LGraphCanvas) || app?.canvas?.constructor || null;
}

function colorForType(type) {
  const LGC = getLGraphCanvasClass();
  const map = (LGC && LGC.link_type_colors) || {};
  const litegraphDefault =
    (typeof window !== "undefined" && window.LiteGraph && window.LiteGraph.LINK_COLOR) || DEFAULT_LINK_COLOR;
  return map[type] || litegraphDefault;
}

function injectStyles() {
  try {
    const href = new URL("./tracelinks.css", import.meta.url).href;
    if (document.querySelector(`link[data-tracelinks="1"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.tracelinks = "1";
    document.head.appendChild(link);
  } catch (e) {
    console.warn("[TraceLinks] could not inject stylesheet", e);
  }
}

function requestRedraw() {
  try {
    app?.canvas?.setDirty(true, true);
    app?.graph?.setDirtyCanvas?.(true, true);
  } catch (e) {
    /* canvas not ready */
  }
}

// ---------------------------------------------------------------------------
// Render hook: the one seam. Wrap renderLink so disabled types are dimmed or
// skipped. Any failure falls back to the original draw so the canvas is safe.
// ---------------------------------------------------------------------------
function installRenderHook(attempt = 0) {
  const LGC = getLGraphCanvasClass();
  if (!LGC || !LGC.prototype || typeof LGC.prototype.renderLink !== "function") {
    if (attempt < 60) {
      requestAnimationFrame(() => installRenderHook(attempt + 1));
    } else {
      console.warn("[TraceLinks] LGraphCanvas.renderLink not found; link filtering disabled.");
    }
    return;
  }
  if (LGC.prototype.renderLink.__traceLinksPatched) return;

  const original = LGC.prototype.renderLink;
  function patchedRenderLink(ctx, a, b, link, ...rest) {
    try {
      const type = link ? link.type : undefined;
      // Draw normally when the effect is off, the link is untyped (e.g. the
      // link currently being dragged, or event links), or its type is visible.
      if (!store.active || type == null || type === "" || store.isTypeVisible(type)) {
        return original.call(this, ctx, a, b, link, ...rest);
      }
      if (store.mode === "hide") return undefined;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * store.dimStrength;
      try {
        return original.call(this, ctx, a, b, link, ...rest);
      } finally {
        ctx.globalAlpha = prevAlpha;
      }
    } catch (e) {
      return original.call(this, ctx, a, b, link, ...rest);
    }
  }
  patchedRenderLink.__traceLinksPatched = true;
  LGC.prototype.renderLink = patchedRenderLink;
  console.log("[TraceLinks] link render hook installed.");
}

// ---------------------------------------------------------------------------
// Type scanner: distinct link types present in the current graph + colors.
// ---------------------------------------------------------------------------
function scanTypes() {
  const graph = app?.graph;
  const seen = new Map();
  const links = graph?.links;
  if (links) {
    const values = links instanceof Map ? links.values() : Object.values(links);
    for (const link of values) {
      if (!link) continue;
      const t = link.type;
      if (t == null || t === "" || t === "-1" || t === -1) continue; // skip event/untyped
      const key = String(t);
      if (!seen.has(key)) seen.set(key, colorForType(key));
    }
  }
  return [...seen.entries()]
    .map(([type, color]) => ({ type, color }))
    .sort((x, y) => x.type.localeCompare(y.type));
}

// ---------------------------------------------------------------------------
// Sidebar UI
// ---------------------------------------------------------------------------
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v; // always textContent — never innerHTML (type names may be untrusted)
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

function renderSidebar(container) {
  container.innerHTML = "";
  const root = el("div", { class: "tracelinks-panel" });

  // Header controls -------------------------------------------------------
  const header = el("div", { class: "tl-header" });

  const masterRow = el("label", { class: "tl-row tl-master" });
  const masterCb = el("input", { type: "checkbox" });
  masterCb.checked = store.active;
  masterCb.addEventListener("change", () => store.setActive(masterCb.checked));
  masterRow.appendChild(masterCb);
  masterRow.appendChild(el("span", { class: "tl-master-label", text: "Enable TraceLinks" }));
  masterRow.appendChild(el("span", { class: "tl-hotkey", text: "Alt+T" }));
  header.appendChild(masterRow);

  // Mode: Dim / Hide
  const modeRow = el("div", { class: "tl-seg" });
  for (const m of ["dim", "hide"]) {
    const btn = el("button", {
      class: "tl-seg-btn" + (store.mode === m ? " tl-active" : ""),
      text: m === "dim" ? "Dim" : "Hide",
      title: m === "dim" ? "Fade disabled links to a faint ghost" : "Hide disabled links completely",
      onclick: () => store.setMode(m),
    });
    modeRow.appendChild(btn);
  }
  header.appendChild(modeRow);

  // Dim strength slider (only meaningful in dim mode)
  const dimRow = el("div", { class: "tl-dim-row" + (store.mode === "dim" ? "" : " tl-disabled") });
  dimRow.appendChild(el("span", { class: "tl-dim-label", text: "Ghost" }));
  const slider = el("input", {
    type: "range",
    min: "2",
    max: "40",
    value: String(Math.round(store.dimStrength * 100)),
    class: "tl-slider",
  });
  slider.disabled = store.mode !== "dim";
  slider.addEventListener("input", () => store.setDimStrength(Number(slider.value) / 100));
  dimRow.appendChild(slider);
  header.appendChild(dimRow);

  // Action buttons
  const actions = el("div", { class: "tl-actions" });
  const types = scanTypes();
  actions.appendChild(el("button", { class: "tl-btn", text: "All", title: "Show all link types", onclick: () => store.showAll(types.map((t) => t.type)) }));
  actions.appendChild(el("button", { class: "tl-btn", text: "None", title: "Hide all link types", onclick: () => store.hideAll(types.map((t) => t.type)) }));
  if (store.solo != null) {
    actions.appendChild(el("button", { class: "tl-btn", text: "Clear solo", onclick: () => store.clearSolo() }));
  }
  actions.appendChild(el("button", { class: "tl-btn tl-refresh", text: "↻", title: "Rescan link types in the current graph", onclick: () => renderSidebar(container) }));
  header.appendChild(actions);

  root.appendChild(header);

  // Type list -------------------------------------------------------------
  const list = el("div", { class: "tl-list" });
  if (types.length === 0) {
    list.appendChild(el("div", { class: "tl-empty", text: "No links found. Open a workflow, then press ↻ to rescan." }));
  }
  for (const { type, color } of types) {
    const soloed = store.solo === type;
    const off = store.solo == null && store.disabled.has(type);
    const row = el("div", { class: "tl-row tl-type" + (off ? " tl-off" : "") + (soloed ? " tl-soloed" : "") });

    const swatch = el("span", { class: "tl-swatch" });
    swatch.style.background = color;
    row.appendChild(swatch);

    row.appendChild(el("span", { class: "tl-type-name", text: type, title: type }));

    // Eye toggle (visibility)
    const eye = el("button", {
      class: "tl-eye",
      text: off ? "✕" : "●",
      title: off ? "Currently hidden — click to show" : "Currently shown — click to hide",
      onclick: () => store.toggleType(type),
    });
    eye.disabled = store.solo != null;
    row.appendChild(eye);

    // Solo
    const soloBtn = el("button", {
      class: "tl-solo" + (soloed ? " tl-active" : ""),
      text: "solo",
      title: soloed ? "Stop isolating this type" : "Isolate this type (hide/dim all others)",
      onclick: () => store.setSolo(type),
    });
    row.appendChild(soloBtn);

    list.appendChild(row);
  }
  root.appendChild(list);

  root.appendChild(
    el("div", { class: "tl-foot", text: "Viewing aid only — never changes your workflow." })
  );

  container.appendChild(root);
}

function registerSidebar() {
  const em = app?.extensionManager;
  if (!em || typeof em.registerSidebarTab !== "function") {
    console.warn("[TraceLinks] Sidebar API unavailable; sidebar tab not registered.");
    return;
  }
  em.registerSidebarTab({
    id: SIDEBAR_ID,
    icon: "pi pi-share-alt",
    title: "TraceLinks",
    tooltip: "Isolate node links by type (TraceLinks)",
    type: "custom",
    render: (elm) => {
      renderSidebar(elm);
      // Re-render on state changes so the panel reflects toggles/solo/mode.
      const off = store.onChange(() => renderSidebar(elm));
      elm._tlUnsub?.();
      elm._tlUnsub = off;
    },
  });
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------
app.registerExtension({
  name: EXT_NAME,
  commands: [
    {
      id: "TraceLinks.Toggle",
      label: "Toggle TraceLinks (dim/hide links by type)",
      function: () => {
        store.setActive(!store.active);
        const em = app?.extensionManager;
        em?.toast?.add?.({
          severity: "info",
          summary: "TraceLinks",
          detail: store.active ? "Link filtering ON" : "Link filtering OFF",
          life: 1400,
        });
      },
    },
  ],
  keybindings: [
    {
      combo: { alt: true, key: "t" },
      commandId: "TraceLinks.Toggle",
    },
  ],
  async setup() {
    store._load();
    injectStyles();
    installRenderHook();
    registerSidebar();
  },
});
