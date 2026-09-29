# Embedding `@perssonify/editor` in a host app

This guide is for applications that embed the editor (e.g. the Perssonify 3D
interface). It covers **persistence/autosave, theming, default view mode, and
linking/deep links** — the seams that make the editor reusable anywhere.

Entry point: [`<PerssonifyEditorIntegration>`](../src/integration/PerssonifyEditorIntegration.tsx)
(exported from [`src/index.tsx`](../src/index.tsx)), plus its imperative
`EditorHandle` (via `ref` or `onReady`).

---

## 1. Persistence & "autosave" — who owns what

**The contract, in one line:** the editor always persists to **browser storage**
on its own; persisting to *your* app/backend is the host's job, done by
subscribing to change events (or by injecting a storage adapter).

### What the editor does automatically
- The canonical document is **ProseMirror JSON**; markdown/HTML are projections.
- The editor **autosaves** the canonical JSON to browser storage (IndexedDB, with
  localStorage / an injected shim as fallbacks) ~5s after editing stops. This is
  **local-only** and never calls back to the host — it will not push to a server.
- No storage config is required: an embed gets its own IndexedDB in the iframe/
  origin and persists across reloads.

### What the host must do to "autosave" into its own system
Subscribe to **`onContentChange`** (debounced ~300ms) — this is the signal to
persist wherever you want:

```tsx
<PerssonifyEditorIntegration
  onContentChange={({ docId, markdown, html, canonical }) => {
    myBackend.saveDraft(docId, canonical);   // your autosave
  }}
  onSave={(payload) => { /* explicit ⌘S / Save button only */ }}
/>
```

- `onContentChange` fires on every edit (debounced) — use it for host autosave.
- `onSave` fires **only** on an explicit user save (⌘S / Save button). Idle
  autosaves are intentionally *not* mirrored here (they stay local).

### If the host wants to fully own storage
Inject an adapter so the editor persists *through you* instead of IndexedDB:

```tsx
<PerssonifyEditorIntegration
  storageAdapter={myStorageAdapter}   // implements the StorageAdapter interface
  // or: storageConfig={{ dbName: "my-app", maxBytes: 50_000_000 }}
  onStorageQuotaExceeded={(err) => showToast(err.message)}
  onStorageMetricsChange={(m) => updateUsageMeter(m)}
/>
```

**Insight for a host that "isn't autosaving":** the editor's *local* autosave
works out of the box. If content isn't reaching the host's store, the host needs
to wire `onContentChange` (or inject `storageAdapter`) — the editor cannot push
to an external system by itself, by design (privacy: nothing leaves the browser
unless the host asks). Note the editor only added idle autosave recently; older
embeds relied on manual save.

---

## 2. Theming — tie it to the host app

Theming is **scoped to the editor subtree** and never leaks CSS into the host
page. Two orthogonal axes:

- **Light/dark:** `isDark` prop (or `handle.setTheme("dark" | "light" | boolean)`).
- **Accent:** either a preset palette or a custom color.

```tsx
<PerssonifyEditorIntegration
  isDark={hostThemeIsDark}
  accent="violet"                    // preset: amber|blue|violet|emerald|rose|mono
  // or a custom color tied to your brand:
  accentColor="#7c3aed"              // sets --primary / --primary-strong (scoped)
  themeVars={{ "--radius": "0.25rem" }}  // arbitrary CSS-var overrides, highest precedence
/>
```

- `accentColor`/`themeVars` are applied as inline CSS variables on a wrapper with
  `display: contents`, so they cascade into the editor only — the host page is
  unaffected.
- Runtime changes: `handle.setTheme(...)`, `handle.setAccent("blue")`.

**Standalone app:** unaffected — it keeps its header theme + palette picker and
applies the palette globally as before.

### The stylesheet, and why importing it is safe

`import '@perssonify/editor/styles.css'` will **not** restyle your application.

The editor is built on Tailwind, whose preflight is a deliberate **global** reset
— right for a page you own, wrong for a stylesheet someone imports into an app
that already has styles. Measured against a plain host page, the unscoped
stylesheet dropped an `<h1>` from 32px/700 to 16px/400, removed link underlines,
took 16px of margin and 40px of padding off a `<ul>`, and switched every element
on the page to `border-box`. The library build therefore confines everything in
the `base` layer to the editor's own subtrees:

| Scope root | Covers |
| --- | --- |
| `.perssonify-editor` | the editor container, present on every mount |
| `.pf-app` | the standalone app / iframe embed shells |
| `[data-base-ui-portal]`, `[data-sonner-toaster]` | menus, dialogs, sheets, tooltips, toasts — these portal to `document.body`, **outside** the container |
| `[data-pf-portal]` | the few surfaces the editor attaches to `document.body` itself |

Two consequences worth knowing:

- **Design tokens are deliberately NOT scoped.** They stay on `:root`, because
  that is where the portalled surfaces resolve `--background`, `--border` and
  `--primary` from. Scoping them would leave every menu and dialog unstyled.
- **The scoping uses `:where()`**, which carries zero specificity, so utilities
  beat the reset exactly as they always did — no specificity surprises.

Pinned by `src/__tests__/scope-css.test.js`.

### If you pin the theme yourself

If your app wraps the editor in its **own** `next-themes` provider with
`forcedTheme`, note that next-themes makes a *nested* provider a no-op — it
returns the existing context. The editor reads the effective theme through
`useIsDarkTheme()` (`src/theme/useThemeMode.ts`), which prefers `forcedTheme`
over `resolvedTheme`, precisely because `resolvedTheme` reports the visitor's
stored *preference* rather than the theme in force. If you write your own
theme-aware code against this editor, do the same — reading `resolvedTheme`
alone means a pinned theme is honoured by the CSS and ignored by the JavaScript
(which is exactly how `?theme=light` once produced a light page around a dark
editor).

Also note the integration writes a **namespaced** `data-pf-theme` attribute on
the document element rather than a `class`, so mounting the editor cannot rewrite
your `<html>` class list or `color-scheme`.

---

## 3. Default view mode at open

```tsx
<PerssonifyEditorIntegration initialMode="md" /> // "split" (default) | "md" | "html"
```

- `initialMode` sets the mode on first open. A **user's stored preference wins**
  on later opens (so their choice sticks). Change it at runtime with
  `handle.setMode("split")`.

---

## 4. Linking — external hyperlinks *and* deep links

Every link activation inside the rich pane is routed through **`onLinkClick`**
with a typed payload, so a host can resolve deep links into its own app:

```tsx
<PerssonifyEditorIntegration
  onLinkClick={(e) => {
    if (e.kind === "doc") {
      // a [[wiki-link]] to another editor document — handled by the editor
      // (switches docs) unless you return true to take over.
      return;
    }
    // e.kind === "external": e.href + e.external (true = http/https/mailto/tel)
    if (!e.external) {
      myRouter.navigate(e.href);   // deep link, e.g. "app://node/42"
      return true;                 // <- returning true suppresses default handling
    }
    // external http(s)/mailto: default opens in a new tab (return nothing)
  }}
/>
```

**Defaults when the host does not intercept:**
- `[[wiki-links]]` → switch to the target document (or a "not found" toast).
- External `http/https/mailto/tel` (and `//…`) → open in a new tab
  (`noopener,noreferrer`), with the dangerous-scheme guard applied.
- Custom-scheme (`app:`, `perssonify:`, …) or relative (`/path`, `#anchor`)
  links → **no default action**; they're delivered to the host to resolve as
  deep links.

So: external hyperlinks "just work"; deep links are one `onLinkClick` handler
away, and enabling it for a new host is a single prop.

(For **outbound** wiki-link resolution — mapping a `[[Target]]` to your own id —
use the `linkResolver` prop.)

---

## 5. Events & imperative API (summary)

Callbacks: `onChange`, `onContentChange`, `onSave`, `onLinkClick`,
`onGraphUpdate`, `onFieldChange`, `onExport`, `onReady`,
`onStorageMetricsChange`, `onStorageQuotaExceeded`.

`EditorHandle` (via `ref`/`onReady`): `getCanonicalDocument`, `getMarkdown`,
`getHTML`, `getGraph`, `getDocuments`, `getActiveDocument`, `importContent`,
`addDocuments`, `updateDocument`, `appendToDocument`, `setDocuments`,
`setFieldSchemas`, `setAssociations`, `setTheme`, `setMode`, `setAccent`,
`setChrome`, `openDocument`, `getAssociations`, `copyAsPrompt`, `exportAs`.

### Seeding documents from the host

Use **`addDocuments`** to push a corpus into the editor **non-destructively** — it
appends persisted documents (they survive reload), dedupes by `id`, returns the
created ids, and fires `onGraphUpdate` so the host can re-pull `getGraph()`:

```ts
const { ids } = await client.call("addDocuments", {
  docs: notes.map((n) => ({ id: n.id, markdown: n.text })), // or { title, markdown } / { canonical }
});
```

- **`addDocuments`** — additive + persisted (this is what a host wants for seeding).
- **`setDocuments`** — legacy bulk-replace; destructive, avoid for seeding.
- **`importContent`** — pure ingest helper; returns a parsed doc but does **not**
  persist (and needs a mounted editor). Not a persistence path — use `addDocuments`.

Idempotent: re-seeding the same `id`s skips duplicates. Gate seeding on an empty
editor (`getDocuments().length === 0`) so user-authored docs are never touched.

### Editing existing documents from the host

Two additive, **persisted** primitives edit a document by id **without switching
the visible editor** (see §7 for why that matters in a 3D scene). Both emit
`onGraphUpdate` and return `{ id, updated }` (`updated:false` if the id is
unknown — they never create):

```ts
// Replace body and/or title. Title-only is churn-free (no editor involvement).
await client.call("updateDocument", { id, title: "New title", markdown: "# New body" });
// Append markdown to the end of a doc without loading it.
await client.call("appendToDocument", { id, markdown: "\n- one more line" });
```

- **`updateDocument(id, { title?, markdown? | canonical? })`** — a title-only edit
  uses the churn-free rename path; a body edit replaces content. Non-active docs
  are converted to canonical via the live editor's real schema, so the visible doc
  never changes.
- **`appendToDocument(id, markdown)`** — parses the new markdown with the live
  editor's schema and appends to the stored canonical; churn-free.
- Wiki-links in updated/appended markdown are re-indexed into `getGraph()`.

### Cross-origin (iframe) embeds
When embedded in an iframe, pass `allowedOrigins` (defaults to `[]` = deny all
cross-origin host messages). The same callbacks are mirrored to the parent frame
via `postMessage` through the host bridge; note `postMessage` is one-way, so the
`onLinkClick` "return `true` to suppress default" mechanism only applies to
direct React embeds, not the iframe bridge.

**The shipped embed build (`dist-embed/`) resolves its own allowed origins**, in
this order ([`resolveAllowedOrigins`](../src/embed.tsx)):

1. `?allowed_origin=` on the iframe `src` — one origin, or several separated by
   commas. Each must parse to a bare origin; a literal `*` is **rejected**, since
   whoever frames the editor already gets their own origin from step 2 and a
   wildcard would only let them relay the document onward.
2. the origin of `document.referrer` — i.e. the page that framed it.
3. `[]` — deny all. That is the safe failure, and it is what you get when the
   referrer is suppressed (`referrerpolicy="no-referrer"`, some privacy modes).

Before v1.74.0 the embed passed its *own* origin here, so a host's messages were
never accepted at all. If you were working around that, remove the workaround.

The host talks to the iframe with `createEditorClient(iframe, editorOrigin)`. The
second argument is optional — the client derives the editor's origin from the
iframe's `src` when you omit it, and warns (falling back to `"*"`) only if the
`src` cannot be parsed. Pass it explicitly when the iframe is `srcdoc`-based or
assigned after mount:

```ts
import { createEditorClient } from "@perssonify/editor";
const client = createEditorClient(iframeEl, "https://editor.example.com");
client.on("onContentChange", (p) => myBackend.saveDraft(p.docId, p.canonical));
const graph = await client.call("getGraph");        // pull
client.call("setMode", { mode: "html" });           // runtime controls…
client.call("setAccent", { accent: "blue" });
client.call("openDocument", { docId });              // open a doc by id (deep link)
```

Request/response actions: `getCanonicalDocument`, `getMarkdown`, `getHTML`,
`getGraph`, `getDocuments`, `getActiveDocument`, `addDocuments`, `updateDocument`,
`appendToDocument`, `setDocuments`, `setFieldSchemas`, `setAssociations`,
`setTheme`, `setMode`, `setAccent`, `setChrome`, `openDocument`, `importContent`,
`copyAsPrompt`.

---

## 6. Iframe embed build (`dist-embed/`)

The repo ships a ready-made iframe shell so hosts don't hand-roll one.

- **Build:** `bun run build:embed` → `dist-embed/` (entry `dist-embed/index.html`).
  Uses a **relative base (`./`)** so it works served from any path (`/editor/`,
  `/meridien/editor/`, a CDN subfolder), and emits **`index.html`** so a host can
  point the iframe at the directory root. No service worker (only the standalone
  app has one).
- **Configure via the iframe `src` query string** — no post-ready round-trip
  needed for the common cases:

  ```
  <iframe src="/editor/?mode=html&theme=dark&accent=blue"></iframe>
  <iframe src="/editor/?accentColor=%237fb0ff"></iframe>   (#7fb0ff, URL-encoded)
  ```

  | Param | Values | Effect |
  |-------|--------|--------|
  | `mode` / `view_mode` | `split`\|`md`\|`html` | initial view mode (user's stored choice wins later). The standalone app uses `view_mode`; the embed accepts both. |
  | `theme` | `dark`\|`light` | light/dark (default dark) |
  | `accent` | palette id | `amber`\|`blue`\|`violet`\|`emerald`\|`rose`\|`mono` |
  | `accentColor` | any CSS color | custom accent (overrides `accent`) |
  | `chrome` | `full`\|`minimal`\|`none` | UI chrome level (default `full`) |
  | `bg` | `transparent` \| CSS color | panel background (see §7 for transparency) |
  | `readonly` | `true` | open read-only — editing off, toolbar hidden, view mode locked |
  | `ads` | `true` | show optional support ads (gated to full chrome; off in embeds) |
  | `allowed_origin` | one or more origins, comma-separated | who may drive this editor over `postMessage`. Each must be a bare origin; a literal `*` is refused. Omit it and the embed trusts the origin of `document.referrer` — the page that framed it — and nothing else. |

  > The standalone app reads the same view/readonly/ads params (plus
  > `import_url=<link>`, which **pre-fills** the importer without fetching
  > anything until the visitor presses Fetch) and then strips them from the
  > address bar. **Tools ▸ Share / embed link** ([src/ui/LinkBuilderDialog.tsx](../src/ui/LinkBuilderDialog.tsx))
  > generates both a standalone link and this iframe snippet for you.

- **Vendoring:** copy `dist-embed/` into your app and serve it same-origin (and,
  if needed, access-gated). Re-vendor after each editor release so your bundle
  matches this repo's source.

> The shell (`src/embed.tsx`) passes a real `ref`, but the bridge no longer
> depends on it — `PerssonifyEditorIntegration` keeps its own internal handle,
> so the request/response API works even if a host renders the component without
> a ref. (Earlier versions silently failed every bridge request in that case.)

---

## 7. Editor in a 3D scene (CSS3D)

For rendering the editor **inside** a WebGL scene (e.g. wrapping the iframe in a
Three.js `CSS3DObject` positioned at a node), the key facts:

### The iframe isolates your 3D transform
The editor is an **iframe**, and a `CSS3DObject` wraps that iframe element. When
you `transform` the object, the transform applies to the iframe **as a single
unit**; everything inside the iframe (its own document/viewport) is unaffected.
Consequences:

- **`position: fixed` inside the editor is safe** — it resolves against the
  iframe's viewport, not your transformed host document.
- **Popovers / dropdowns / menus / tooltips / toasts cannot escape the panel** —
  they're portals mounted to the *iframe's* `document.body`, clipped to the iframe
  rectangle. The classic "menu flies off into 3D space" failure does not happen.
- **`100vh` fills the panel** — the editor lays out to the size you give the
  `CSS3DObject`.

### Making it look and feel native

1. **Minimal chrome.** Use `?chrome=none` for the smallest node-side panels
   (document surface only) or `?chrome=minimal` (slim title strip + surface) when
   enlarged/pinned. Drive doc switching via `openDocument`. Runtime:
   `setChrome("none" | "minimal" | "full")`.
2. **Transparent background.** Use `?bg=transparent` so the scene shows through.
   **One host-side requirement:** the iframe element itself must be transparent —
   set `style="background: transparent"` on it. (For a solid host color instead,
   pass `?bg=%23rrggbb`, or `themeVars={{ "--background": "#0b1020" }}` on a React
   embed.)
3. **Single pane, not split.** A small panel is cramped in `split`; call
   `setMode("md")` (authoring) or `"html"` (reading) on mount.
4. **Text crispness at fractional scale.** CSS3D composites the DOM via
   `matrix3d`; at non-integer scales/rotations, text antialiasing softens. Author
   the `CSS3DObject` element **larger and scale it down** (super-sample), and
   **billboard** the panel toward the camera when the user is reading/typing.
5. **Pointer / focus / IME under transform.** This is a browser-level concern, not
   editor-controlled: modern Chromium hit-tests transformed iframes well; Safari
   can mis-map click/caret/IME. Recommended: when the panel is focused for editing,
   drop to a **near-identity transform** (billboarded, axis-aligned) so hit-testing
   and IME line up; use the full 3D tilt only at rest.

### On-mount recipe
```ts
// iframe src: /editor/?chrome=none&bg=transparent&mode=md&theme=dark&accent=blue
// + style="background: transparent" on the iframe element
client.on("onGraphUpdate", () => refreshGraph());
if ((await client.call("getDocuments")).length === 0) {
  await client.call("addDocuments", { docs });     // seed corpus once
}
client.call("openDocument", { docId });            // on node select
client.call("appendToDocument", { id, markdown }); // inline micro-edit, no churn
```

The current bridge is sufficient for the panel to **function**; chrome/bg/single-
pane are polish. No editor code runs your transform — that's all host-side.
