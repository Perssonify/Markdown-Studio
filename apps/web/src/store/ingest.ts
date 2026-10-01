/**
 * Ingest pipeline: raw input → origin + canonical + residuals.
 *
 * Flow:
 *   1. Capture origin (raw string, format, source)
 *   2. Normalize to HTML (markdown→marked, text→wrap, html→sanitize)
 *   3. Snapshot normalized HTML ("pre-ingest")
 *   4. Feed to Tiptap → ProseMirror JSON (canonical)
 *   5. Diff: pre-ingest vs Tiptap output → residuals
 *   6. Generate ingest report
 *
 * The ingest function needs a Tiptap editor reference to do the PM conversion.
 * For initial load (before Tiptap mounts), we produce a deferred ingest that
 * completes once the editor is available.
 */

import {
  createOrigin,
  createDocument,
  deriveTitleFromCanonical,
  resolveDocTitle,
  type DocumentRecord,
  type PMNode,
} from "./document";
import { sanitizeCanonicalNode } from "./canonical-sanitize";
import { isDangerousUrl } from "../utils/url-safety";
import { sanitizeStyleDeclarations } from "../engine/css-safety";

// --- Types ---

export type IngestFormat =
  | "markdown"
  | "html"
  | "paste-html"
  | "text"
  | "pmjson";

export type IngestSource =
  | "user-typed"
  | "clipboard-paste"
  | "file-import"
  | "api"
  | "storage-load";

export interface IngestOpts {
  mdToHtml?: (md: string) => string;
  alternates?: Record<string, string> | null;
  id?: string | null;
}

export interface IngestResult {
  doc: DocumentRecord;
  html: string | null;
  needsTiptap: boolean;
}

export interface ResidualItem {
  type: string;
  tag?: string;
  reason?: string;
  location?: string;
  attributes?: Record<string, string>;
  property?: string;
  value?: string;
  element?: string;
  attribute?: string;
  note?: string;
}

interface AnalysisResult {
  residuals: ResidualItem[];
  processed: Record<string, number>;
  transformed: unknown[];
  totalElements: number;
}

export interface TiptapEditorLike {
  getJSON(): PMNode & { type: string; content?: PMNode[] };
}

// --- HTML analysis helpers ---

/** Known elements that ProseMirror/Tiptap's schema handles */
const KNOWN_ELEMENTS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "br",
  "hr",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "del",
  "s",
  "strike",
  "sub",
  "sup",
  // NOT "mark": there is no Highlight extension (highlight is a textStyle
  // backgroundColor), so a <mark>'s highlight is dropped and must be reported.
  "span",
  "details",
  "summary",
  // `<section>` — marked-footnote wraps the definitions in one; the section
  // itself is regenerated from the markdown and its content round-trips.
  "section",
  // `<div>` — the callout node parses `div[data-type="callout"]`, and turndown's
  // `plainDiv` rule handles the rest. Our OWN markdown renderer emits callout
  // divs, so without this the shipped welcome document reported its own
  // admonitions as content that "could not be mapped to the current schema".
  "div",
  // `<picture>`/`<source>` — the themeImage node parses `tag: "picture"`, keeps
  // the light/dark sources, and serializes back to `<picture>` via the
  // `themeImagePicture` turndown rule. This is a FEATURE the welcome document
  // demonstrates; flagging it as a loss was exactly backwards.
  "picture",
  "source",
]);

/** Known CSS properties that Tiptap extensions handle. (NOT `font-size`: there
 *  is no FontSize extension, so a size is dropped and must be reported.) */
const KNOWN_STYLES = new Set([
  "color",
  "background-color",
  "background",
  "font-family",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-align",
]);

/**
 * Purely presentational properties the app's OWN pipeline injects — chiefly the
 * list styling `useMarkdownEngine` adds to `<ul>/<ol>/<li>` for the preview.
 * They carry no authored meaning, so losing them is not a loss: counting them
 * made the shipped welcome document report 78 "residuals" (72 of them these
 * list styles) and claim its content "could not be mapped to the current
 * schema", when nothing had been dropped at all.
 */
const PRESENTATIONAL_STYLES = new Set([
  "list-style",
  "list-style-type",
  "list-style-position",
  "padding-left",
  "margin",
  "margin-bottom",
  "margin-top",
  "display",
]);

/**
 * Elements stripped for security. Two classes:
 *  - REMOVE_ENTIRELY: the element AND its contents are deleted (their text must
 *    never surface — e.g. script/style bodies, MathML/SVG which can carry
 *    scripts or feed mutation-XSS on re-parse).
 *  - unwrap-to-text (the rest): removed, but their visible text is kept.
 * Note: the ProseMirror schema is a second, authoritative filter (it drops any
 * node it doesn't recognise) — this sanitizer is defense-in-depth so the output
 * is safe even for a caller that inserts it as raw HTML.
 */
const REMOVE_ENTIRELY = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "math",
  "title",
  "base",
  "link",
  "meta",
  "head",
]);
const BLOCKED_ELEMENTS = new Set([
  ...REMOVE_ENTIRELY,
  "iframe",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "textarea",
  "select",
  "button",
]);

/**
 * Analyze HTML to compute residuals — what the PM schema will drop.
 * Runs on a DOM Document, so it works with DOMParser output.
 */
/**
 * Attributes the editor itself round-trips. These are produced by
 * `build-marked.ts` / the custom TipTap nodes and survive the schema, so they
 * are NOT serialization losses and must never be counted as residuals.
 */
//
// Re-synced with the LIVE schema (TiptapPane / SERIALIZE_EXTENSIONS): an entry
// here silences a residual, so one the schema does NOT keep hides a real loss.
// `data-block-id` (no BlockId extension is registered), `data-latex` /
// `data-diagram` / `data-slot` / `data-md-preview` (nothing in the document
// pipeline emits or keeps them) were removed; `data-frontmatter` was missing,
// so every document with front matter reported a bogus residual.
const SCHEMA_OWNED_ATTRS = new Set([
  "data-type",        // taskList / taskItem / callout / frontmatter
  "data-checked",     // task items
  "data-callout",     // callout kind
  "data-doc-link",    // wiki links
  "data-anchor",      // heading anchors
  "data-math-inline",
  "data-math-block",
  "data-emoji",
  "data-frontmatter", // the front matter node's raw YAML
  // (Not marked-footnote's `data-footnote-*`: it writes them VALUELESS, which
  // the scan below never matches on the markdown path, and on the HTML path —
  // serialized as `=""` — they genuinely are dropped.)
]);

function analyzeHtml(html: string): AnalysisResult {
  const residuals: ResidualItem[] = [];
  const processed: Record<string, number> = {};
  const transformed: unknown[] = [];
  let totalElements = 0;

  // HTML comments have no node in the schema, so a `<!-- note -->` in an
  // imported document was deleted on the first projection with nothing to say
  // so. An empty `<!---->` carries nothing (the serializer uses one as an
  // invisible separator) and is not a loss.
  if (html.indexOf("<!--") !== -1) {
    for (const c of html.matchAll(/<!--([\s\S]*?)-->/g)) {
      const text = c[1]!.trim();
      if (!text) continue;
      residuals.push({
        type: "html-comment",
        value: text.length > 80 ? text.slice(0, 80) + "…" : text,
        location: `position ${c.index}`,
      });
    }
  }

  const tagRegex = /<(\/?)(\w[\w-]*)((?:\s+[^>]*)?)>/g;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    // All three groups take part in every match (group 3's `?` is inside it),
    // so neither `tag` nor `attrStr` is ever really undefined.
    const [, isClose, tag, attrStr = ""] = match;
    if (isClose) continue;
    const tagLower = tag!.toLowerCase();
    totalElements++;

    processed[tagLower] = (processed[tagLower] ?? 0) + 1;

    if (BLOCKED_ELEMENTS.has(tagLower)) {
      residuals.push({
        type: "blocked-element",
        tag: tagLower,
        reason: "security",
        location: `position ${match.index}`,
      });
      continue;
    }

    if (!KNOWN_ELEMENTS.has(tagLower)) {
      const attrs: Record<string, string> = {};
      const attrRegex = /(\w[\w-]*)=(?:"([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = attrRegex.exec(attrStr)) !== null) {
        attrs[a[1]!] = a[2] ?? a[3] ?? "";
      }
      residuals.push({
        type: "unknown-element",
        tag: tagLower,
        attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
        location: `position ${match.index}`,
      });
      continue;
    }

    const styleMatch = /style="([^"]*)"/.exec(attrStr);
    if (styleMatch) {
      const styles = styleMatch[1]!
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const style of styles) {
        const colonIdx = style.indexOf(":");
        if (colonIdx < 0) continue;
        const prop = style.slice(0, colonIdx).trim().toLowerCase();
        const val = style.slice(colonIdx + 1).trim();
        if (!KNOWN_STYLES.has(prop) && !PRESENTATIONAL_STYLES.has(prop)) {
          residuals.push({
            type: "unknown-style",
            property: prop,
            value: val,
            element: tagLower,
            location: `position ${match.index}`,
          });
        }
      }
    }

    const dataAttrs = attrStr.match(/data-[\w-]+="[^"]*"/g);
    if (dataAttrs) {
      for (const da of dataAttrs) {
        const [name, ...rest] = da.split("=");
        // Do NOT report the editor's OWN first-class attributes as losses.
        // build-marked.ts emits these and the TipTap schema preserves them, so
        // flagging them made every feature-using document claim data loss — the
        // shipped welcome doc opened reporting "94 residuals … could not be
        // mapped to the current schema" while its stored residuals array was
        // empty and nothing had actually been dropped.
        if (name && SCHEMA_OWNED_ATTRS.has(name.toLowerCase())) continue;
        residuals.push({
          type: "dropped-attribute",
          element: tagLower,
          attribute: name,
          value: rest.join("=").replace(/^"|"$/g, ""),
          location: `position ${match.index}`,
        });
      }
    }

    if (tagLower === "img") {
      // `width`/`height` are NOT residuals: the SizedImage extension declares both
      // as attributes with explicit parseHTML/renderHTML, and the `sizedImage`
      // turndown rule serializes a sized image back to an `<img …>` tag. The old
      // note ("may or may not survive depending on Image extension config") was
      // written before that extension existed and made the shipped welcome
      // document — which sizes its own logo — report a loss that never happens.
      // `loading` genuinely is dropped, so it stays.
      const m = /\bloading="([^"]*)"/i.exec(attrStr);
      if (m) {
        residuals.push({
          type: "noted-attribute",
          element: "img",
          attribute: "loading",
          value: m[1],
          note: "Not kept on the image node, so it will not survive a round-trip",
          location: `position ${match.index}`,
        });
      }
    }
  }

  return { residuals, processed, transformed, totalElements };
}

/**
 * Sanitize HTML using DOMParser — removes blocked elements while preserving
 * their text content. More robust than regex for nested/malformed HTML.
 */
/**
 * Attributes that carry a URL the browser will FETCH on its own.
 *
 * `href`/`src`/`xlink:href` were the only ones checked. `srcset` matters most
 * here because `<source srcset>` is deliberately allowed for `<picture>` theme
 * images, and `poster`/`background` are the same class. This is a private,
 * offline-capable editor: a pasted note should not be able to make the browser
 * announce itself to a third party, quite apart from any script question.
 */
const URL_ATTRS = new Set(["href", "src", "xlink:href", "srcset", "poster", "background", "formaction", "action", "data"]);

/** `srcset` is a comma-separated candidate list — every URL in it counts. */
function hasDangerousSrcset(value: string): boolean {
  return value
    .split(",")
    .map((c) => c.trim().split(/\s+/)[0] ?? "")
    .some((url) => url && isDangerousUrl(url));
}

/**
 * `class` values that carry meaning for the editor: the code block's language
 * (`language-js`, read by the CodeBlock node), the screen-reader-only footnote
 * heading, and the app's own link classes (`wiki-link` is what styles.css
 * styles — including unresolved links — in the Cards preview). Everything else
 * goes — this output is injected into a live document by the Cards preview,
 * where the app's own Tailwind utilities are loaded, so
 * `class="fixed inset-0 z-50"` was a full-screen overlay.
 */
const KEPT_CLASS = /^(?:language-[\w+#.-]+|sr-only|wiki-link|perssonify-link)$/;

function stripDangerousAttributes(doc: Document): void {
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (name === "style") {
        // Inline style was not filtered at all, and this output is injected
        // into a live document by the Cards preview. A style can fetch
        // (`background-image: url(...)`) and can escape its box
        // (`position: fixed`), so the ingest path keeps only declarations that
        // cannot do either — through an ALLOWLIST (css-safety.ts): a deny-list
        // was walked straight past by CSS escapes (`posit\ion: fixed`).
        const safe = sanitizeStyleDeclarations(attr.value);
        if (safe) el.setAttribute("style", safe);
        else el.removeAttribute("style");
      } else if (name === "class") {
        const kept = attr.value.split(/\s+/).filter((c) => KEPT_CLASS.test(c));
        if (kept.length) el.setAttribute("class", kept.join(" "));
        else el.removeAttribute("class");
      } else if (name === "id" || name === "name") {
        // Named elements are reachable as globals (`window.foo`,
        // `document.foo`): DOM clobbering. Nothing the schema keeps uses them.
        el.removeAttribute(attr.name);
      } else if (name === "srcset") {
        if (hasDangerousSrcset(attr.value)) el.removeAttribute(attr.name);
      } else if (URL_ATTRS.has(name) && isDangerousUrl(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
}

/**
 * Container elements that are blocked as ELEMENTS but whose children are
 * ordinary content: they are unwrapped in place, not collapsed to text.
 *
 * `form` in particular is a container, not a control. Replacing it with its
 * `textContent` destroyed the entire subtree — headings, lists, tables and every
 * image inside it — which is catastrophic for the common case of an exported
 * HTML page whose whole body is wrapped in one <form> (classic ASP.NET /
 * SharePoint "save as HTML" output): the import came back as a single run-on
 * paragraph with all structure and images gone.
 */
const UNWRAP_KEEPING_CHILDREN = new Set(["form", "button"]);

export function sanitizeForIngest(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const tag of BLOCKED_ELEMENTS) {
      doc.querySelectorAll(tag).forEach((el) => {
        // script/style/svg/… bodies must never surface — delete outright.
        if (REMOVE_ENTIRELY.has(tag)) { el.remove(); return; }
        // Containers keep their children; the element itself goes away.
        if (UNWRAP_KEEPING_CHILDREN.has(tag)) {
          const parent = el.parentNode;
          if (!parent) { el.remove(); return; }
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          el.remove();
          return;
        }
        // Genuine form CONTROLS (input/textarea/select) carry only their own
        // value — unwrap to visible text.
        const text = el.textContent || "";
        if (text.trim()) {
          el.replaceWith(doc.createTextNode(text));
        } else {
          el.remove();
        }
      });
    }
    // Remove event-handler attributes (onclick, onerror, …) and dangerous URL
    // schemes (javascript:, non-image data:) that tag-level blocking misses.
    stripDangerousAttributes(doc);
    return doc.body.innerHTML;
  } catch {
    // No DOM parser (SSR, a worker, a stripped-down host). The old fallback
    // removed blocked TAGS with regexes and kept every attribute — event
    // handlers, javascript: URLs and styles went through untouched, which is
    // "nearly a no-op" for a sanitizer. Fail CLOSED instead: without a parser
    // nothing here can be trusted to be markup, so it all becomes text.
    return `<p>${escapeHtml(html)}</p>`;
  }
}

/**
 * Ingest raw content and produce a document.
 */
export function ingest(
  raw: string,
  format: IngestFormat,
  source: IngestSource,
  opts: IngestOpts = {}
): IngestResult {
  const { mdToHtml, alternates = null, id = null } = opts;

  const origin = createOrigin(format, raw, source, alternates);

  let html: string;
  switch (format) {
    case "markdown":
      html = mdToHtml ? mdToHtml(raw) : `<p>${escapeHtml(raw)}</p>`;
      break;
    case "text":
      // `detectFormat` routes .txt AND every unrecognised extension (.csv, .log,
      // .yml, .py …) here, so this is the last stop for a lot of content. Split
      // on blank lines for paragraphs, but keep SINGLE newlines as hard breaks:
      // HTML collapses whitespace, so emitting them raw turned a 200-line list
      // into a handful of run-on paragraphs with the line structure gone for
      // good — unrecoverable from the document afterwards. CRLF is normalised
      // first, or a Windows file failed to split at all and became one blob.
      html = raw
        .replace(/\r\n?/g, "\n")
        .split(/\n\n+/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("");
      break;
    case "html":
    case "paste-html":
      html = sanitizeForIngest(raw);
      break;
    case "pmjson": {
      try {
        const parsed =
          typeof raw === "string" ? JSON.parse(raw) : raw;
        // Validate it looks like a ProseMirror document
        const isValidPmDoc =
          parsed &&
          typeof parsed === "object" &&
          (parsed.type === "doc" || parsed._format === "perssonify-document") &&
          (Array.isArray(parsed.content) || parsed.canonical);
        if (!isValidPmDoc) {
          throw new Error("Not a valid ProseMirror document");
        }
        // Support both raw PM JSON and the full perssonify export envelope.
        const isEnvelope = parsed._format === "perssonify-document";
        const canonical = sanitizeCanonicalNode(
          isEnvelope ? parsed.canonical : parsed
        );
        // A full-backup envelope carries the complete document state, so forward
        // tags/metadata/timestamps/origin/residuals verbatim — otherwise a
        // "restorable" backup silently loses them on re-import (and resets
        // created/updated to now, scrambling the sidebar's modified-order sort).
        const doc = createDocument({
          id: (isEnvelope ? parsed.id : id) ?? undefined,
          origin: (isEnvelope && parsed.origin) || origin,
          canonical: canonical as PMNode & { type: string; content?: PMNode[] },
          residuals: (isEnvelope && parsed.residuals) || [],
          metadata: (isEnvelope && parsed.metadata) || {},
          tags: (isEnvelope && parsed.tags) || [],
          created: (isEnvelope && parsed.created) || undefined,
          updated: (isEnvelope && parsed.updated) || undefined,
          // Carried through so content exported by a NEWER build opens
          // read-only instead of blank (see schema-version.ts).
          schemaVersion: isEnvelope && typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : undefined,
          ingestReport: (isEnvelope && parsed.ingestReport) || {
            timestamp: new Date().toISOString(),
            originFormat: format,
            originSize:
              typeof raw === "string"
                ? raw.length
                : JSON.stringify(raw).length,
            fidelity: {
              lossless: true,
              score: 1.0,
              droppedCount: 0,
              transformedCount: 0,
            },
          },
        });
        // Prefer the title from the export envelope, then derive from content.
        // A restored envelope title is a real user-facing title, so pin it as
        // userTitle so save-time re-derivation can't overwrite it.
        const envelopeTitle = isEnvelope && parsed.title ? String(parsed.title) : "";
        doc.title = envelopeTitle || deriveTitleFromCanonical(canonical);
        if (envelopeTitle) {
          doc.userTitle = envelopeTitle;
          doc.titlePinnedByUser = true;
        }
        // A JSON export carries the images it refers to (A086). Handed on,
        // untouched, for the import pipeline to put back into the asset store
        // (prepareImportedDocAssets); never persisted — serializeForStorage
        // writes a fixed list of fields.
        if (isEnvelope && parsed.assets && typeof parsed.assets === "object") {
          (doc as DocumentRecord & { _importAssets?: unknown })._importAssets = parsed.assets;
        }
        return { doc, html: null, needsTiptap: false };
      } catch {
        // Fall through: treat as plain text if JSON is invalid or unrecognised
        html = `<p>${escapeHtml(String(raw))}</p>`;
        break;
      }
    }
    default:
      html = `<p>${escapeHtml(String(raw))}</p>`;
  }

  const analysis = analyzeHtml(html);

  const realLosses = analysis.residuals.filter((r) => r.type !== "noted-attribute");

  const ingestReport = {
    timestamp: new Date().toISOString(),
    originFormat: format,
    originSize: raw ? raw.length : 0,
    preIngestHtml:
      html.length > 50000 ? html.slice(0, 50000) + "…[truncated]" : html,
    processed: analysis.processed,
    transformed: analysis.transformed,
    // `noted-attribute` is an informational note ("may or may not survive"), NOT a
    // loss. It was excluded from `dropped` but still counted in droppedCount/score
    // — and the status bar reads droppedCount, so the shipped welcome document
    // announced "94 residuals … could not be mapped to the current schema" while
    // its stored residuals array was empty. One definition, used everywhere.
    dropped: realLosses,
    fidelity: {
      lossless: realLosses.length === 0,
      score:
        analysis.totalElements > 0
          ? Math.max(0, 1 - realLosses.length / analysis.totalElements)
          : 1.0,
      droppedCount: realLosses.length,
      transformedCount: analysis.transformed.length,
    },
  };

  const doc = createDocument({
    id: id ?? undefined,
    origin,
    canonical: { type: "doc", content: [{ type: "paragraph" }] } as PMNode & {
      type: "doc";
      content: PMNode[];
    },
    residuals: analysis.residuals,
    ingestReport,
  });

  return { doc, html, needsTiptap: true };
}

/**
 * Complete the ingest by capturing Tiptap's PM JSON as canonical.
 * Called after Tiptap has processed the HTML from ingest().
 */
export function completeIngest(
  doc: DocumentRecord,
  tiptapEditor: TiptapEditorLike | null | undefined
): DocumentRecord {
  if (!tiptapEditor) return doc;
  const canonical = tiptapEditor.getJSON();
  doc.canonical = canonical as DocumentRecord["canonical"];
  // Respect an explicit rename; derive from content otherwise. resolveDocTitle
  // keeps the existing display title ("Untitled 2") when the doc is still
  // empty, instead of collapsing every fresh doc to plain "Untitled".
  const resolvedTitle = resolveDocTitle(doc, canonical);
  doc.title = resolvedTitle.title;
  doc.userTitle = resolvedTitle.userTitle;
  doc.titlePinnedByUser = resolvedTitle.titlePinnedByUser;
  doc.updated = new Date().toISOString();
  return doc;
}

/**
 * Ingest a clipboard paste event.
 * Captures all available clipboard formats as alternates.
 */
export function ingestPaste(
  clipboardData: DataTransfer,
  opts: IngestOpts = {}
): IngestResult {
  const html = clipboardData.getData("text/html");
  const text = clipboardData.getData("text/plain");
  const rtf = clipboardData.getData("text/rtf");

  const alternates: Record<string, string> = {};
  if (html) alternates["text/html"] = html;
  if (text) alternates["text/plain"] = text;
  if (rtf) alternates["text/rtf"] = rtf;

  if (html) {
    return ingest(html, "paste-html", "clipboard-paste", {
      ...opts,
      alternates,
    });
  }
  return ingest(text || "", "text", "clipboard-paste", {
    ...opts,
    alternates,
  });
}

// --- Utils ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
