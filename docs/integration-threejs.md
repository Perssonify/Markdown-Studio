# Embedding the editor in a Three.js / WebGL app

> Companion to [integration-guide.md](integration-guide.md), which covers the
> general host contract (persistence, theming, bridge actions). This page covers
> what is **specific to mounting the editor inside a 3D scene**, and the
> constraints you cannot design around.

---

## The one thing that matters most

The editor is a **DOM component**, not a WebGL object. It cannot be rendered
into a Three.js material by itself — browsers do not let you rasterize a live,
interactive DOM subtree into a texture. So there are exactly two viable
strategies, and picking the right one up front decides everything else.

| Strategy | What it is | Interactive? | Recommended |
| --- | --- | --- | --- |
| **A. HTML overlay** | A normal, absolutely-positioned DOM panel above the WebGL canvas | Yes, fully | ✅ **Start here** |
| **B. `CSS3DRenderer`** | The DOM element is transformed in 3D and composited with the scene | Yes, with caveats | ⚠️ Only if the panel must live *in* the scene |
| C. Render-to-texture | Rasterize the DOM to an image and map it onto a mesh | No (static) | ❌ Not supported |

---

## Strategy A — HTML overlay (recommended)

The editor sits in a normal DOM container layered over the canvas. Everything
works: portals, popovers, dialogs, the graph overlay, IME/dictation, text
selection, and native scrolling.

```tsx
import { PerssonifyEditorIntegration } from "@perssonify/editor";
import "@perssonify/editor/styles.css"; // required — the library does not inject CSS

<div style={{ position: "relative", width: "100vw", height: "100vh" }}>
  <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />

  {/* The editor panel. The container MUST have a definite height. */}
  <div
    style={{
      position: "absolute",
      top: 40, right: 40, width: 520, height: 640,
      borderRadius: 12, overflow: "hidden",
    }}
  >
    <PerssonifyEditorIntegration
      fitParent            // ← REQUIRED: size to this box, not the viewport
      chrome="minimal"     // slim strip + document surface; "none" for pure surface
      initialMode="html"
      accent="violet"
      onReady={(handle) => (editorRef.current = handle)}
      onContentChange={({ markdown }) => syncToGameState(markdown)}
    />
  </div>
</div>
```

### `fitParent` is not optional here

Without it the editor sizes itself to **`100dvh`** (it assumes it owns the page).
Inside a 640px-tall panel that means the editor overflows its container and the
chrome runs off the bottom. `fitParent` switches the root to `h-full` so it fills
its parent instead. The parent must have a definite height — a flex child needs
`min-height: 0`, and a plain `<div>` needs an explicit height.

---

## Strategy B — `CSS3DRenderer` (panel inside the scene)

Use this only when the panel genuinely needs to be positioned/rotated in world
space (a monitor in a room, a floating UI plane). It works, but read every
caveat below first — they are consequences of how browsers handle CSS 3D
transforms, not bugs we can patch away.

```js
import { CSS3DRenderer, CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";

const el = document.createElement("div");
el.style.width = "1024px";
el.style.height = "768px";
createRoot(el).render(
  <PerssonifyEditorIntegration fitParent chrome="minimal" />
);

const object = new CSS3DObject(el);
object.scale.setScalar(0.002); // CSS px → world units
scene.add(object);

const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(innerWidth, innerHeight);
cssRenderer.domElement.style.position = "absolute";
cssRenderer.domElement.style.top = "0";
document.body.appendChild(cssRenderer.domElement);
```

### Caveats you must plan for

1. **Portalled UI escapes the 3D panel.** Floating surfaces — dropdown menus,
   dialogs/sheets, toasts, context menus, and the Find panel's scrollbar match
   ticks — render into `document.body` (the ticks deliberately: the Find panel's
   `backdrop-blur` would otherwise become their containing block and misposition
   them). Inside a `CSS3DObject` they will appear on the **flat page**, not on
   the 3D plane. The Find/Replace panel itself is `position: fixed` — see (4).
   **Mitigation:** run with `chrome="none"` (or `"minimal"`) and drive those
   features from your own in-scene UI via the imperative handle, rather than
   letting the user open them inside the panel.

2. **Pointer events need a clear path.** The `CSS3DRenderer` DOM layer must sit
   above the WebGL canvas and receive events. Give the canvas
   `pointer-events: none` (or place the CSS layer above it) or the editor will
   look right and be un-clickable.

3. **Keep the panel's CSS size ~1:1 and scale in world units.** Setting a small
   pixel size and scaling *up* makes text blurry; the DOM is rasterized at its CSS
   size. Author at a realistic size (e.g. 1024×768) and scale **down**.

4. **`position: fixed` resolves against the transformed ancestor.** Anything
   fixed inside the panel is positioned relative to the 3D element, not the
   viewport. Combined with (1), prefer `chrome="none"`.

5. **No `backdrop-filter` compositing guarantees.** Translucent surfaces may
   composite differently over a WebGL canvas across browsers.

---

## Required setup (both strategies)

### 1. Install and provide peers

The library externalizes its heavy peers so you control the versions — React,
`@tiptap/*`, `@codemirror/*`, `lucide-react`, `zustand`, and `next-themes` must
be installed in the host app. See `peerDependencies` in `package.json`.

### 2. Import the stylesheets

```ts
import "@perssonify/editor/styles.css";
import "katex/dist/katex.min.css"; // maths — the library does not bundle KaTeX's CSS
```

The library build emits `dist/styles.css` and **does not inject it** — without
this import the editor renders unstyled. Its base reset and design tokens are
scoped to the editor's own elements, so importing it does not restyle the rest
of your page. Without the KaTeX stylesheet every formula renders twice, unstyled.

### 3. Transparent background (composite over the scene)

```tsx
<PerssonifyEditorIntegration
  fitParent
  themeVars={{ "--background": "transparent" }}
/>
```

`themeVars` values are applied as given — they come from your own code. The
colours that can arrive from outside it go through `sanitizeCssColor`: the
`accentColor` prop, and the iframe embed's `bg` and `accentColor` URL
parameters, where `url(...)`, `expression(...)`, `var(...)` and `;{}` are
rejected.

### 4. Persist into your own save system

By default documents live in the browser's IndexedDB. To route them through your
game/app state, inject an adapter:

```tsx
<PerssonifyEditorIntegration
  fitParent
  storageAdapter={myAdapter}          // full control, or:
  onContentChange={({ docId, markdown }) => queueSave(docId, markdown)}
/>
```

`onContentChange` is debounced (~300ms) and fires on every edit;
`onSave` fires only on an explicit user save, and only when that write
committed. With the built-in storage, a host that has its own user accounts
should give each user their own `storageConfig.dbName` (it namespaces version
history and the unload stash too; switching it takes a page load) and call
`clearLocalData()` on logout on a shared device.

### 5. One editor per page

The editor's stores are module singletons: two `PerssonifyEditorIntegration`
panels in the same page share the active document and its unsaved drafts. For
several editors in one scene, give each its own iframe (see
[the iframe embed](#alternative-the-iframe-embed)).

---

## Driving the editor from the scene

`onReady` hands you an imperative handle — use it to wire in-world controls
(a button on a 3D console, a proximity trigger) without the user touching the
editor chrome:

```ts
handle.setMode("html");
handle.setChrome("none");
handle.openDocument(docId);
handle.addDocuments([{ title: "Quest log", markdown: "# Quest log\n" }]);
handle.updateDocument(docId, { markdown });   // churn-free, no doc switch
handle.appendToDocument(docId, "\n- picked up the key\n");
handle.setAccent("emerald");
```

`updateDocument` / `appendToDocument` are the safe write paths: they parse with
the live editor's schema, persist, and re-hydrate the editor when the target is
the active document — so a programmatic write can never be silently overwritten
by the editor's own autosave. A body update to a document that another tab has
changed since this one read it is refused (the promise rejects with a
`ConflictError`) rather than overwriting that tab's work.

---

## Alternative: the iframe embed

If you want isolation (no peer-dependency coupling, no CSS bleed, its own
stacking context, its own stores), use the prebuilt embed instead of the React
component. It is a normal iframe, so it works as an overlay and inside a
`CSS3DObject` — and because it has its **own viewport**, `fitParent` is
unnecessary and the portal caveat disappears (portals go to the iframe's own
body).

The embed is **self-hosted**: build it with `bun run build:embed` and serve
`dist-embed/` from your own app (see
[integration-guide.md §6](integration-guide.md#6-iframe-embed-build-dist-embed)).
markdownstudio.com does not serve the embed build: every path there is the
standalone app, which refuses to be framed everywhere except `/embed.html`.

```html
<iframe
  src="/editor/?chrome=minimal&bg=transparent&view_mode=html"
  style="width:1024px;height:768px;border:0"
  allow="clipboard-write"
></iframe>
```

Params: `chrome`, `bg`, `view_mode` (or `mode`), `readonly`, `theme`, `accent`,
`accentColor`, `allowed_origin`. Cross-document control uses the `postMessage`
bridge: on your side `createEditorClient(iframe)` talks only to the iframe's
origin. Inside the embed, the bridge answers only the origins it resolves
([src/integration/embed-origins.ts](../src/integration/embed-origins.ts)) —
build it with `VITE_EMBED_ALLOWED_ORIGINS` set to your page's origin, or it
trusts whichever page frames it.

---

## Pre-flight checklist

- [ ] `fitParent` set (Strategy A/B) and the container has a definite height
- [ ] `@perssonify/editor/styles.css` imported (and `katex/dist/katex.min.css` for maths)
- [ ] All `peerDependencies` installed in the host
- [ ] `chrome` chosen (`"none"`/`"minimal"` for in-scene panels)
- [ ] Pointer events reach the editor layer
- [ ] Persistence decided (IndexedDB vs injected adapter vs `onContentChange`)
- [ ] One editor per page — several in-scene editors each get their own iframe
- [ ] Iframe embed: served from your own origin, built with `VITE_EMBED_ALLOWED_ORIGINS`
- [ ] For `CSS3DRenderer`: accepted the portal caveat, authored at ~1:1 scale
