import { ThemeProvider } from "next-themes";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import type { StorageAdapter, StorageQuotaError } from "../store/storage-adapter";
import type { IDBStorageConfig, StorageMetrics } from "../store/idb-storage-adapter";
import { createAssociationStore, mergeGraphWithAssociations } from "./associations";
import { createHostBridge } from "./host-bridge";
import { formatDocumentsForPrompt, linkedPromptItems, PromptFormat } from "./prompt-builder";
import { sanitizeCssColor } from "../theme/palette";
import { warnDeprecated } from "./deprecation";

/** Rich payload for a link activation inside the editor. Lets a host resolve
 *  deep links (custom scheme / relative path) into its own app while external
 *  http(s)/mailto links open in a new tab by default. */
export type EditorLinkClick =
  | { kind: "doc"; targetId: string | null; targetTitle: string; notFound?: boolean }
  | { kind: "external"; href: string; external: boolean };

export interface FieldSchema {
  [key: string]: any;
}

export interface Association {
  [key: string]: any;
}

export interface CopyPromptOptions {
  format?: string;
  includeLinked?: boolean;
  preamble?: string | null;
}

export interface PerssonifyEditorIntegrationProps {
  isDark?: boolean;
  /** Open read-only (session-only; never writes the visitor's saved setting). */
  readOnly?: boolean;
  /** @deprecated Accepted for API compatibility and NEVER consumed. Seed the
   *  library with the imperative `addDocuments` handle instead. Logs a
   *  one-time warning in development. */
  documents?: any[];
  /** @deprecated Accepted for API compatibility and NEVER consumed: the editor
   *  has no field-schema feature to configure. Logs a one-time warning in
   *  development. */
  fieldSchemas?: FieldSchema[];
  associations?: Association[];
  /** @deprecated Accepted for API compatibility and NEVER called: wiki links
   *  resolve against the editor's own documents. To map a link into your app,
   *  handle `onLinkClick` (`kind: "doc"` carries the target title and id).
   *  Logs a one-time warning in development. */
  linkResolver?: (target: string) => string | null;
  allowedOrigins?: string[];
  onChange?: (data: any) => void;
  /** Fires on every link activation. Return `true` to signal the host handled
   *  navigation (suppresses the editor's default: open external links in a new
   *  tab; do nothing for deep links). */
  onLinkClick?: (data: EditorLinkClick) => boolean | void;
  onGraphUpdate?: (data: any) => void;
  /** @deprecated Accepted for API compatibility and NEVER fired — the editor
   *  exposes no field-change hook to forward. Logs a one-time warning in
   *  development. */
  onFieldChange?: (data: any) => void;
  /** @deprecated Accepted for API compatibility and NEVER fired — exports are
   *  driven by the host through the `exportAs` handle, which resolves when the
   *  download has been triggered. Logs a one-time warning in development. */
  onExport?: (data: any) => void;
  onReady?: (handle: EditorHandle | null) => void;

  // ── Persistence (host-controlled) ─────────────────────────────────────────
  /** Fires (debounced ~300ms) on every content change — subscribe to persist to
   *  your own store without waiting for a save. This is how a host "autosaves". */
  onContentChange?: (payload: { docId: string; markdown: string; html: string; canonical: any }) => void;
  /** Fires after an explicit user save (⌘S / Save button) once the local write
   *  completes. Automatic (idle) saves are intentionally local-only and do NOT
   *  fire this. */
  onSave?: (payload: { docId: string; markdown: string; html: string; canonical: any }) => void;
  /** Inject a fully custom StorageAdapter (e.g. to persist through the host). */
  storageAdapter?: StorageAdapter;
  /** Configure the built-in IndexedDB adapter (ignored if storageAdapter given). */
  storageConfig?: IDBStorageConfig;
  onStorageMetricsChange?: (metrics: StorageMetrics) => void;
  onStorageQuotaExceeded?: (err: StorageQuotaError) => void;

  // ── Presentation ──────────────────────────────────────────────────────────
  /** Initial view mode at open: "split" | "md" | "html". Host preference; a
   *  user's stored choice still wins on subsequent opens. Defaults to "split". */
  initialMode?: "md" | "html" | "split";
  /** Chrome level: "full" (default) shows tabs + toolbar + status bar; "minimal"
   *  keeps a slim title strip + document surface (no toolbar/status/backlinks);
   *  "none" is the document surface only. For small embedded/in-scene panels.
   *  Runtime-switchable via handle.setChrome(). */
  chrome?: "full" | "minimal" | "none";
  /** Markdown to seed a first document when the store is empty. */
  initialDocument?: { title?: string; content: string };
  /** Size to the PARENT element instead of the viewport.
   *
   *  Required whenever the editor is mounted into a fixed-size container rather
   *  than owning the page — an in-scene panel in a Three.js/WebGL app, a
   *  dashboard tile, a split pane. Without it the editor is `100dvh` tall and
   *  will overflow (or dwarf) its container. The parent must have a definite
   *  height. */
  fitParent?: boolean;

  // ── Theming (scoped to the editor; never leaks to the host page) ───────────
  /** Preset accent palette id: "amber" | "blue" | "violet" | "emerald" | "rose" | "mono". */
  accent?: string;
  /** Custom accent color (any CSS color) — sets --primary / --primary-strong for
   *  the editor subtree. Overrides `accent`. The host is responsible for contrast. */
  accentColor?: string;
  /** Arbitrary CSS custom-property overrides applied to the editor root (e.g.
   *  { "--primary": "#7c3aed", "--radius": "0.25rem" }). Highest precedence. */
  themeVars?: Record<string, string>;
}

export interface EditorHandle {
  getCanonicalDocument: () => any;
  getMarkdown: () => { md: string; fidelityReport: any };
  getHTML: () => string;
  getGraph: () => { nodes: any[]; edges: any[] };
  getDocuments: () => any[];
  getActiveDocument: () => any;
  importContent: (content: string, format: string) => Promise<any>;
  setDocuments: (docs: any[]) => Promise<any>;
  /** @deprecated Has no effect — nothing in the editor reads field schemas.
   *  Logs a one-time warning in development. */
  setFieldSchemas: (schemas: FieldSchema[]) => void;
  setAssociations: (assocs: Association[]) => void;
  setTheme: (theme: string | boolean) => void;
  /** Switch the view mode at runtime ("md" | "html" | "split"). */
  setMode: (mode: "md" | "html" | "split") => void;
  /** Switch the accent palette at runtime (preset id or "" to clear). */
  setAccent: (accent: string) => void;
  /** Open (activate) a document by id; resolves when the switch settles. */
  openDocument: (docId: string) => Promise<void>;
  /** Append documents to the store (persisted), non-destructively. Accepts
   *  markdown (or canonical) docs; dedupes by id, returns the created ids, and
   *  emits onGraphUpdate so the host can re-pull getGraph(). */
  addDocuments: (
    docs: Array<{ id?: string; title?: string; markdown?: string; canonical?: any }>
  ) => Promise<{ ids: string[] }>;
  /** Update an existing document by id (persisted). Title-only edits are
   *  churn-free; a markdown/canonical body edit replaces content. Non-active docs
   *  are updated without switching the visible editor. Returns { updated:false }
   *  when the id is unknown (never creates). */
  updateDocument: (
    id: string,
    patch: { title?: string; markdown?: string; canonical?: any }
  ) => Promise<{ id: string; updated: boolean }>;
  /** Append markdown to the end of an existing document by id (persisted),
   *  churn-free — without switching the visible editor. */
  appendToDocument: (id: string, markdown: string) => Promise<{ id: string; updated: boolean }>;
  /** Set the chrome level at runtime: "full" | "minimal" | "none". */
  setChrome: (level: "full" | "minimal" | "none") => void;
  getAssociations: (docId?: string) => any;
  copyAsPrompt: (opts?: CopyPromptOptions) => Promise<string>;
  exportAs: (format: string) => Promise<any>;
}

/** Props kept for API compatibility that have no effect, and what to do instead. */
const DEPRECATED_PROPS: ReadonlyArray<readonly [keyof PerssonifyEditorIntegrationProps, string]> = [
  ["fieldSchemas", "it has no effect (the editor has no field-schema feature). Remove the prop."],
  [
    "linkResolver",
    "it is never called (wiki links resolve against the editor's own documents). Map links into your app from `onLinkClick` instead.",
  ],
  ["documents", "it is never read. Seed documents with the handle's `addDocuments()`."],
  ["onFieldChange", "it is never fired (the editor exposes no field-change event)."],
  ["onExport", "it is never fired. `exportAs()` resolves when its download has been triggered."],
];

export const PerssonifyEditorIntegration = forwardRef<EditorHandle, PerssonifyEditorIntegrationProps>(
  function PerssonifyEditorIntegration(props, ref) {
    const {
      isDark: isDarkProp = true,
      // fieldSchemas / linkResolver / documents: deprecated, see DEPRECATED_PROPS.
      associations: associationsProp,
      allowedOrigins,
      onChange: onChangeProp,
      onLinkClick: onLinkClickProp,
      onGraphUpdate: onGraphUpdateProp,
      onFieldChange: onFieldChangeProp,
      onExport: onExportProp,
      onReady: onReadyProp,
      onContentChange: onContentChangeProp,
      onSave: onSaveProp,
      storageAdapter,
      storageConfig,
      onStorageMetricsChange,
      onStorageQuotaExceeded,
      initialMode = "split",
      chrome,
      initialDocument,
  fitParent,
  readOnly,
      accent,
      accentColor,
      themeVars,
    } = props;

    const [isDark, setIsDark] = useState<boolean>(isDarkProp);
    const [accentState, setAccentState] = useState<string | undefined>(accent);
    const internalRef = useRef<any>(null);
    // The public EditorHandle lives here regardless of whether the consumer
    // forwarded a `ref`. The host bridge and onReady read from this ref, so an
    // iframe embed that renders <PerssonifyEditorIntegration/> without a ref still
    // gets a live handle (previously createHostBridge dereferenced a null ref and
    // every request — getGraph, getDocuments, … — silently failed).
    const handleRef = useRef<EditorHandle | null>(null);
    const associationStoreRef = useRef<any>(createAssociationStore());
    const hostBridgeRef = useRef<any>(null);
    const callbacksRef = useRef<Partial<PerssonifyEditorIntegrationProps>>({});

    callbacksRef.current = {
      onChange: onChangeProp,
      onLinkClick: onLinkClickProp,
      onGraphUpdate: onGraphUpdateProp,
      onFieldChange: onFieldChangeProp,
      onExport: onExportProp,
    };

    useEffect(() => {
      setIsDark(isDarkProp);
    }, [isDarkProp]);

    useEffect(() => {
      setAccentState(accent);
    }, [accent]);

    // Deprecated props: accepted so existing hosts still compile, but they do
    // nothing — so say so once (development builds only) instead of silently.
    // Keyed on which ones are present, so a host re-rendering with a new
    // callback identity does not re-run it.
    const deprecatedPassed = DEPRECATED_PROPS.filter(([name]) => props[name] !== undefined)
      .map(([name]) => name)
      .join(",");
    useEffect(() => {
      for (const [name, detail] of DEPRECATED_PROPS) {
        if (deprecatedPassed.split(",").includes(name)) warnDeprecated(`The \`${name}\` prop`, detail);
      }
    }, [deprecatedPassed]);

    useEffect(() => {
      if (associationsProp) {
        associationStoreRef.current.setAll(associationsProp);
      }
    }, [associationsProp]);

    if (!handleRef.current) {
      const handle: EditorHandle = {
        getCanonicalDocument() {
          return internalRef.current?.getCanonical?.() || null;
        },

        getMarkdown() {
          const md = internalRef.current?.getMarkdown?.();
          const fidelity = internalRef.current?.getFidelityReport?.();
          
          if (typeof md === 'object' && md !== null && 'md' in md) {
             return { md: md.md || "", fidelityReport: md.fidelityReport || fidelity || null };
          }
          
          return { md: md || "", fidelityReport: fidelity || null };
        },

        getHTML() {
          return internalRef.current?.getHTML?.() || "";
        },

        getGraph() {
          const wikiGraph = internalRef.current?.getGraph?.() || { nodes: [], edges: [] };
          return mergeGraphWithAssociations(wikiGraph, associationStoreRef.current);
        },

        getDocuments() {
          return internalRef.current?.getDocuments?.() || [];
        },

        getActiveDocument() {
          return internalRef.current?.getActiveDocument?.() || null;
        },

        async importContent(content: string, format: string) {
          return internalRef.current?.importContent?.(content, format);
        },

        async setDocuments(docs: any[]) {
          return internalRef.current?.setDocuments?.(docs);
        },

        setFieldSchemas(schemas: FieldSchema[]) {
          warnDeprecated("`setFieldSchemas()`", "it has no effect (nothing in the editor reads field schemas). Remove the call.");
          internalRef.current?.setFieldSchemas?.(schemas);
        },

        setAssociations(assocs: Association[]) {
          associationStoreRef.current.setAll(assocs);
          const graph = handle.getGraph();
          callbacksRef.current.onGraphUpdate?.(graph);
        },

        setTheme(theme: string | boolean) {
          if (typeof theme === "boolean") setIsDark(theme);
          else if (theme === "dark") setIsDark(true);
          else if (theme === "light") setIsDark(false);
        },

        setMode(mode: "md" | "html" | "split") {
          internalRef.current?.setMode?.(mode);
        },

        setAccent(next: string) {
          setAccentState(next || undefined);
        },

        getAssociations(docId?: string) {
          if (docId) return associationStoreRef.current.getAll(docId);
          return associationStoreRef.current.getAssociations();
        },

        async copyAsPrompt(opts: CopyPromptOptions = {}) {
          const { format = "markdown", includeLinked = true, preamble = null } = opts;

          const activeDoc = handle.getActiveDocument();
          if (!activeDoc) return "";

          const items: any[] = [{ doc: activeDoc, markdown: handle.getMarkdown().md }];

          if (includeLinked) {
            const graph = handle.getGraph();
            const getDocById = internalRef.current?.getDocById;
            if (getDocById) items.push(...(await linkedPromptItems(graph.edges || [], activeDoc.id, getDocById)));
          }

          const prompt = formatDocumentsForPrompt(items, { format: format as PromptFormat, preamble });

          try {
            await navigator.clipboard.writeText(prompt);
          } catch (e) {
            console.warn("[Integration] Clipboard write failed:", e);
          }

          return prompt;
        },

        async openDocument(docId: string) {
          // Preserve the core's navigation promise through the public handle;
          // otherwise the bridge acknowledges before the editor is hydrated.
          await internalRef.current?.openDocument?.(docId);
        },

        async addDocuments(docs) {
          return (await internalRef.current?.addDocuments?.(docs)) ?? { ids: [] };
        },

        async updateDocument(id, patch) {
          return (await internalRef.current?.updateDocument?.(id, patch)) ?? { id, updated: false };
        },

        async appendToDocument(id, markdown) {
          return (await internalRef.current?.appendToDocument?.(id, markdown)) ?? { id, updated: false };
        },

        setChrome(level) {
          internalRef.current?.setChrome?.(level);
        },

        async exportAs(format: string) {
          return internalRef.current?.exportAs?.(format);
        },
      };
      handleRef.current = handle;
    }
    useImperativeHandle(ref, () => handleRef.current as EditorHandle, []);

    useEffect(() => {
      const isEmbedded = window.parent !== window;
      if (!isEmbedded) return;

      // Secure by default: deny all cross-origin host messages unless the
      // embedder explicitly passes an allowlist. (Previously defaulted to
      // ["*"], which let any framing page read/overwrite all documents.)
      hostBridgeRef.current = createHostBridge(handleRef as any, {
        allowedOrigins: allowedOrigins ?? [],
      });

      return () => {
        hostBridgeRef.current?.destroy();
        hostBridgeRef.current = null;
      };
    }, [allowedOrigins]);

    const emitToHost = useCallback((event: string, payload: any) => {
      hostBridgeRef.current?.emit(event, payload);
    }, []);

    // Scoped CSS-variable overrides for custom theming (applied on the wrapper).
    const themeStyle = useMemo(() => {
      const vars: Record<string, string> = {};
      // Validate the host-supplied accent so a value like `url(…)`/`expression(…)`
      // can't be smuggled into a CSS custom property (external-resource beacon).
      const safeAccent = sanitizeCssColor(accentColor);
      if (safeAccent) {
        vars["--primary"] = safeAccent;
        vars["--primary-strong"] = safeAccent;
      }
      if (themeVars) Object.assign(vars, themeVars);
      return vars as React.CSSProperties;
    }, [accentColor, themeVars]);

    const readyEmitted = useRef<boolean>(false);
    useEffect(() => {
      if (readyEmitted.current) return;
      const timer = setTimeout(() => {
        readyEmitted.current = true;
        onReadyProp?.(handleRef.current);
        emitToHost("ready", { version: "1.0" });
      }, 500);
      return () => clearTimeout(timer);
    }, [onReadyProp, emitToHost]);

    return (
      /* The provider stays — ThemeImage, CardsView and EditorPanes all read
         next-themes' `resolvedTheme`, and without a provider `useTheme()` is an
         inert stub that reports `undefined` (theme-aware images and the editor
         theme would silently stick to one mode).
         But it must not CLOBBER the host page. next-themes writes to
         `document.documentElement`, not to this `display:contents` wrapper, so
         `attribute="class"` was rewriting the HOST page's <html> class list —
         and `enableColorScheme` its `color-scheme` — directly contradicting the
         documented contract that theming is scoped to the editor subtree. A
         namespaced attribute nobody else styles on, and no color-scheme write,
         keeps the host's own dark-mode class intact. The subtree is themed by
         the wrapper's `data-theme` below, which styles.css already targets. */
      <ThemeProvider
        attribute="data-pf-theme"
        forcedTheme={isDark ? "dark" : "light"}
        storageKey="perssonify-theme-mode"
        enableSystem={false}
        enableColorScheme={false}
      >
        {/* Scope accent/theme overrides to the editor subtree so they never
            leak into the host page. data-palette + data-theme on the same
            element satisfy the palette's (light and dark) attribute selectors;
            inline CSS vars (accentColor/themeVars) take highest precedence.
            `display: contents` keeps the wrapper out of the layout.
            `data-pf-root` makes it the element the published stylesheet DEFINES
            the design tokens on for this subtree (they are no longer written
            on the host's :root — see build/scope-css.mjs). It sits OUTSIDE the
            error boundary so the crash card, which is styled with the same
            tokens, still gets them. */}
        <div
          data-pf-root=""
          style={{ display: "contents", ...themeStyle }}
          {...(accentState ? { "data-palette": accentState } : {})}
          data-theme={isDark ? "dark" : "light"}
        >
          <ErrorBoundary isDark={isDark}>
            <PerssonifyEditor
            _integrationRef={internalRef}
            storageAdapter={storageAdapter}
            storageConfig={storageConfig}
            onStorageMetricsChange={onStorageMetricsChange}
            onStorageQuotaExceeded={onStorageQuotaExceeded}
            onContentChange={(data) => {
              onContentChangeProp?.(data);
              emitToHost("onContentChange", data);
            }}
            onSave={(data) => {
              onSaveProp?.(data);
              emitToHost("onSave", data);
            }}
            initialMode={initialMode}
            chrome={chrome}
            initialDocument={initialDocument}
            fitParent={fitParent}
            readOnly={readOnly}
            _onIntegrationChange={(data: any) => {
              callbacksRef.current.onChange?.(data);
              emitToHost("onChange", data);
            }}
            _onIntegrationLinkClick={(data: any) => {
              emitToHost("onLinkClick", data);
              return callbacksRef.current.onLinkClick?.(data);
            }}
            _onIntegrationGraphUpdate={(data: any) => {
              callbacksRef.current.onGraphUpdate?.(data);
              emitToHost("onGraphUpdate", data);
            }}
            />
          </ErrorBoundary>
        </div>
      </ThemeProvider>
    );
  }
);