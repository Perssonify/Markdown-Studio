import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CARD_COLORS,
  CARD_COLOR_KEY,
  CARD_PINNED_KEY,
  cardChecklist,
  cardColorValue,
  cardPreview,
  cardPreviewHtml,
  cardSyncSignature,
  composeNoteMarkdown,
  getCardColor,
  isCardPinned,
  isEmptyCapture,
  partitionPinned,
  planCardReload,
  sortCards,
  type CardColorId,
} from "@/store/cards/cards";
import { safeStorage } from "@/utils/safe-storage";
import { overlayShouldHandleEscape } from "@/ui/shared/utils/overlay-escape";
import { neutralizeAssetSrcs, useResolvedAssetImages } from "@/ui/shared/utils/asset-dom";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  ListTodo,
  Palette,
  Pin,
  PinOff,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useIsDarkTheme } from "@/theme/useThemeMode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t, useT } from "@/i18n";
import { isImeComposing } from "@/ui/shared/utils/ime";

/**
 * Cards — a Google-Keep-style board over the whole library.
 *
 * Every document is a card. The point of this view is LOW-CEREMONY capture and
 * organisation: a one-tap composer, plain-text editing (no formatting toolbar),
 * colour + pin for grouping, and live checklists. Full authoring stays in the
 * editor — "Open in editor" is one click away on every card.
 *
 * Mounting: rendered as an OVERLAY above the editor (same contract as GraphView)
 * — the live TipTap editor must stay mounted, because it holds the canonical
 * document (see CLAUDE.md). This component never unmounts the editor and never
 * writes the canonical itself; it hands markdown back to the host, which routes
 * through the same guarded path the host bridge uses.
 */

interface CardDocSummary {
  id: string;
  title: string;
  updated: string;
  created: string;
}

interface LoadedDoc {
  id: string;
  title: string;
  updated: string;
  created: string;
  canonical: unknown;
  metadata: Record<string, unknown>;
}

export interface CardsViewProps {
  /** Library listing — drives which cards exist and their base ordering. */
  docs: CardDocSummary[];
  activeDocId: string | null;
  readOnly?: boolean;
  /** Load a full record (canonical + metadata) — summaries carry neither. */
  loadDoc: (id: string) => Promise<LoadedDoc | null>;
  /** Serialize a canonical doc back to markdown for plain-text editing. */
  toMarkdown: (canonical: unknown) => string;
  /** Render markdown to SANITISED HTML for the opened card's rendered view.
   *  Supplied by the host (it owns the markdown engine + sanitizer); when it is
   *  absent the card editor falls back to markdown-only, so the board still
   *  works in a stripped-down embed. */
  renderMarkdown?: (markdown: string) => string;
  onCreate: (markdown: string) => void | Promise<void>;
  onSaveCard: (id: string, markdown: string) => void | Promise<void>;
  onPatchMeta: (id: string, metadata: Record<string, unknown>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onOpenInEditor: (id: string) => void;
  onClose: () => void;
  folderNameFor?: (id: string) => string | null;
}

/** The quick-capture draft, kept across Escape, closing the board and reloads.
 *  Escape used to DISCARD it (the ladder called the Cancel path); Cancel is now
 *  the only thing that throws a draft away. */
const CARD_DRAFT_KEY = "pf:card-draft";
interface CardDraft { title: string; body: string; list: boolean }
function readDraft(): CardDraft {
  try {
    const raw = safeStorage.get(CARD_DRAFT_KEY);
    const d = raw ? (JSON.parse(raw) as Partial<CardDraft>) : null;
    if (d && typeof d === "object") {
      return { title: String(d.title ?? ""), body: String(d.body ?? ""), list: d.list === true };
    }
  } catch { /* unreadable draft: start empty */ }
  return { title: "", body: "", list: false };
}
function writeDraft(d: CardDraft): void {
  if (isEmptyCapture(d.title, d.body)) safeStorage.remove(CARD_DRAFT_KEY);
  else safeStorage.set(CARD_DRAFT_KEY, JSON.stringify(d));
}

/** Cards rendered per step: the rest are added as the board scrolls near them,
 *  so opening a 2,000-note library does not build 2,000 card faces up front. */
const RENDER_STEP = 60;

/** Compact relative time ("just now", "5m", "3h", "2d", else a date). */
function relTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("cards.justNow");
  const m = Math.floor(diff / 60_000);
  if (m < 60) return t("cards.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("cards.hoursAgo", { count: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t("cards.daysAgo", { count: d });
  return new Date(ts).toLocaleDateString();
}

/**
 * Board columns, measured from the BOARD, not the viewport.
 *
 * Tailwind's `sm:/lg:/xl:` breakpoints read the viewport, but the board is only
 * as wide as `<main>` — with the workspace panel open it can be ~340px narrower,
 * so a 1280px window rendered four columns into ~940px of space.
 */
function useColumnCount(ref: React.RefObject<HTMLElement | null>): number {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setCols(w < 560 ? 1 : w < 860 ? 2 : w < 1160 ? 3 : 4);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return; // SSR / jsdom
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

interface CardModel {
  id: string;
  title: string;
  updated: string;
  created: string;
  metadata: Record<string, unknown>;
  canonical: unknown;
  preview: string;
  previewHtml: string;
  haystack: string;
  /** `title + haystack`, lower-cased ONCE — what the search box matches. */
  searchKey: string;
  checklist: ReturnType<typeof cardChecklist>;
}

function buildCardModel(d: CardDocSummary, rec: LoadedDoc): CardModel {
  const title = rec.title || d.title || t("common.untitled");
  // Search must still match text the preview trimmed or truncated.
  const haystack = cardPreview(rec.canonical, title, 2000);
  return {
    id: d.id,
    title,
    updated: rec.updated || d.updated,
    created: rec.created || d.created,
    metadata: rec.metadata || {},
    canonical: rec.canonical,
    // Always computed: a doc with a checklist usually has prose too.
    // Display copy: the checklist below renders the task items as real
    // tick-boxes, so repeating them here printed them twice.
    preview: cardPreview(rec.canonical, title, 220, { skipTasks: true }),
    // The RENDERED face: real headings, lists and emphasis instead of one
    // flat grey run. Pure and bounded (no marked/generateHTML) so it is
    // cheap enough to compute for the whole library. `cardPreview` above
    // stays for the empty-check and the accessible label.
    previewHtml: cardPreviewHtml(rec.canonical, title, { skipTasks: true }),
    haystack,
    searchKey: `${title} ${haystack}`.toLowerCase(),
    checklist: cardChecklist(rec.canonical, 6),
  };
}

/**
 * Masonry that preserves READING ORDER.
 *
 * CSS multi-column fills each column top-to-bottom before starting the next, so
 * a board sorted newest-first laid out 1,2,3 down column one and put note 4 at
 * the top of column two — the top row read 1, 4, 7, 10 and the sort order was
 * invisible. Dealing the cards round-robin instead puts 1,2,3,4 across the top
 * row, which is what a left-to-right reader expects. Columns are flex, so cards
 * also can no longer be split across a column break.
 */
function Masonry<T extends { id: string }>({ items, cols, render }: {
  items: T[];
  cols: number;
  render: (item: T) => React.ReactNode;
}) {
  const n = Math.max(1, cols);
  const buckets: T[][] = Array.from({ length: n }, () => []);
  items.forEach((item, i) => {
    const bucket = buckets[i % n];
    if (bucket) bucket.push(item);
  });
  return (
    <div className="flex items-start gap-3">
      {buckets.map((bucket, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
          {bucket.map(render)}
        </div>
      ))}
    </div>
  );
}

export function CardsView({
  docs,
  activeDocId,
  readOnly = false,
  loadDoc,
  toMarkdown,
  renderMarkdown,
  onCreate,
  onSaveCard,
  onPatchMeta,
  onDelete,
  onOpenInEditor,
  onClose,
  folderNameFor,
}: CardsViewProps) {
  const t = useT();
  const isDark = useIsDarkTheme();
  const [loaded, setLoaded] = useState<Map<string, LoadedDoc>>(new Map());
  // Skeletons are for the FIRST load only. Afterwards the board is updated in
  // place, so an edit elsewhere no longer blanks it and loses the scroll.
  const [hydrating, setHydrating] = useState(true);
  const hydratedRef = useRef(false);
  /** The signature (cardSyncSignature) each loaded card was read at. */
  const loadedSigRef = useRef<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The open card editor's commit function. Escape is handled by the board's
   *  ladder below (a capture-phase window listener that registers before the
   *  editor exists), so without this hand-off Escape unmounted the editor
   *  directly and DISCARDED the edit — while Done and a backdrop click both
   *  saved it. Three exits from one dialog, one of them silently destructive. */
  const cardCommitRef = useRef<(() => void) | null>(null);
  const [colorMenuFor, setColorMenuFor] = useState<string | null>(null);

  // Composer — seeded from (and mirrored to) the persisted draft.
  const [composerOpen, setComposerOpen] = useState(false);
  const [initialDraft] = useState(readDraft);
  const [draftTitle, setDraftTitle] = useState(initialDraft.title);
  const [draftBody, setDraftBody] = useState(initialDraft.body);
  const [draftList, setDraftList] = useState(initialDraft.list);
  useEffect(() => {
    writeDraft({ title: draftTitle, body: draftBody, list: draftList });
  }, [draftTitle, draftBody, draftList]);
  const hasDraft = !isEmptyCapture(draftTitle, draftBody);

  // A single signature of the library: sync again only when a doc is added,
  // removed, edited, or re-pinned / re-coloured (cardSyncSignature) — NOT on
  // every parent re-render.
  const signature = useMemo(
    () => docs.map((d) => `${d.id}:${cardSyncSignature(d)}`).join("|"),
    [docs]
  );

  // ── Hydration ──────────────────────────────────────────────────────────────
  // Summaries carry no canonical/metadata, so the board needs the full records.
  // The first load reads everything; after that only NEW or CHANGED cards are
  // read, and merged into the board in place. It used to re-read the whole
  // library on any change and show skeletons meanwhile — the board blanked and
  // lost its scroll position whenever anything was saved (A087).
  // Loaded in chunks with a yield between them so a large library can't freeze
  // the frame, and guarded by a cancel token so an unmount mid-load can't set
  // state (or a stale load overwrite a newer one). A cancelled run records
  // nothing, so the run that replaced it re-plans whatever it did not finish.
  useEffect(() => {
    let cancelled = false;
    const first = !hydratedRef.current;
    const { load, drop } = planCardReload(docs, loadedSigRef.current);
    if (!first && load.length === 0 && drop.length === 0) return;
    const wanted = new Map(docs.map((d) => [d.id, cardSyncSignature(d)]));
    const run = async () => {
      const fresh = new Map<string, LoadedDoc>();
      const CHUNK = 24;
      for (let i = 0; i < load.length; i += CHUNK) {
        if (cancelled) return;
        const recs = await Promise.all(
          load.slice(i, i + CHUNK).map((id) => loadDoc(id).catch(() => null))
        );
        if (cancelled) return;
        for (const r of recs) if (r) fresh.set(r.id, r);
        // Yield so the overlay stays responsive while a big library loads.
        if (i + CHUNK < load.length) await new Promise((r) => setTimeout(r, 0));
      }
      if (cancelled) return;
      for (const id of fresh.keys()) loadedSigRef.current.set(id, wanted.get(id) ?? "");
      for (const id of drop) loadedSigRef.current.delete(id);
      setLoaded((prev) => {
        const next = new Map(prev);
        for (const id of drop) next.delete(id);
        for (const [id, rec] of fresh) next.set(id, rec);
        return next;
      });
      if (first) {
        hydratedRef.current = true;
        setHydrating(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [signature, loadDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Card models — rebuilt only when the DATA changes. `query` is deliberately
  // NOT a dependency here: every field below is query-independent, but listing
  // it re-ran a full canonical tree walk per document (cardChecklist) plus two
  // cardPreview passes for the ENTIRE library on every keystroke in the search
  // box. Filtering and sorting are a second, cheap memo below.
  //
  // And per CARD: `docs` is a new array after every save anywhere in the
  // library, so each model is cached against its record and summary fields and
  // only a card whose data changed is rebuilt.
  const modelCacheRef = useRef(new Map<string, { rec: LoadedDoc; title: string; updated: string; created: string; model: CardModel }>());
  const models = useMemo(() => {
    const cache = modelCacheRef.current;
    const live = new Set<string>();
    const out: CardModel[] = [];
    for (const d of docs) {
      const rec = loaded.get(d.id);
      if (!rec) continue;
      live.add(d.id);
      const hit = cache.get(d.id);
      if (hit && hit.rec === rec && hit.title === d.title && hit.updated === d.updated && hit.created === d.created) {
        out.push(hit.model);
        continue;
      }
      const model = buildCardModel(d, rec);
      cache.set(d.id, { rec, title: d.title, updated: d.updated, created: d.created, model });
      out.push(model);
    }
    for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
    return out;
  }, [docs, loaded]);

  // Sorted once per data change, not per keystroke (the sort parses dates);
  // filtering a sorted list keeps its order. The search key is lower-cased
  // once per card, not once per card per keystroke.
  const sorted = useMemo(() => sortCards(models), [models]);
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((m) => m.searchKey.includes(q)) : sorted;
  }, [sorted, query]);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const colCount = useColumnCount(boardRef);

  const { pinned, others } = useMemo(() => partitionPinned(cards), [cards]);
  const editing = editingId ? cards.find((c) => c.id === editingId) || null : null;

  // ── Composer ───────────────────────────────────────────────────────────────
  const openComposer = useCallback(() => {
    if (readOnly) return;
    // The body textarea carries autoFocus and is mounted fresh on expand, so the
    // caret lands there without needing an imperative focus() call here.
    setComposerOpen(true);
  }, [readOnly]);

  const commitComposer = useCallback(async () => {
    const title = draftTitle;
    const body = draftBody;
    const asList = draftList;
    // Reset first so a slow write can't double-submit on a second Enter.
    setDraftTitle("");
    setDraftBody("");
    setDraftList(false);
    setComposerOpen(false);
    if (isEmptyCapture(title, body)) return;
    await onCreate(composeNoteMarkdown(title, body, asList));
  }, [draftTitle, draftBody, draftList, onCreate]);

  const cancelComposer = useCallback(() => {
    setDraftTitle("");
    setDraftBody("");
    setDraftList(false);
    setComposerOpen(false);
  }, []);

  // ── Escape ladder ──────────────────────────────────────────────────────────
  // Closes the most specific thing first so Escape never skips a level and
  // dumps the user out of the whole board unexpectedly.
  //
  // Bubble phase, and only for an Escape meant for the board (A057). This was
  // a CAPTURE-phase window listener — first in line for every Escape on the
  // page — so cancelling a card's delete confirmation closed the whole board,
  // and the confirmation never heard the key. overlayShouldHandleEscape leaves
  // Escape to dialogs, menus and controls outside the board.
  //
  // The composer's Escape COLLAPSES it and keeps the draft (it used to take the
  // Cancel path and throw the text away); Cancel is the one discard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!overlayShouldHandleEscape(e, rootRef.current)) return;
      e.preventDefault();
      if (colorMenuFor) { setColorMenuFor(null); return; }
      if (editingId) {
        // Same path as Done / backdrop click — never a silent discard.
        if (cardCommitRef.current) cardCommitRef.current();
        else setEditingId(null);
        return;
      }
      if (composerOpen) { setComposerOpen(false); return; }
      if (query) { setQuery(""); return; }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [colorMenuFor, editingId, composerOpen, query, onClose]);

  // Close the colour popover on any outside pointer press.
  useEffect(() => {
    if (!colorMenuFor) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-card-color-menu]")) return;
      setColorMenuFor(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [colorMenuFor]);

  /**
   * Pin and colour, applied to the board AT ONCE (A056). The write keeps
   * `updated` untouched on purpose, and the library listing carries no
   * metadata, so nothing about it told the board a card had changed: both
   * buttons looked broken until the board was reopened. If the write fails,
   * the card is re-read, so it shows what was actually stored.
   */
  const patchMeta = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      setLoaded((prev) => {
        const rec = prev.get(id);
        if (!rec) return prev;
        const next = new Map(prev);
        next.set(id, { ...rec, metadata: { ...rec.metadata, ...patch } });
        return next;
      });
      try {
        await onPatchMeta(id, patch);
      } catch {
        const rec = await loadDoc(id).catch(() => null);
        setLoaded((prev) => {
          const next = new Map(prev);
          if (rec) next.set(id, rec);
          return next;
        });
      }
    },
    [onPatchMeta, loadDoc]
  );
  const togglePin = useCallback(
    (id: string, next: boolean) => patchMeta(id, { [CARD_PINNED_KEY]: next }),
    [patchMeta]
  );
  const setColor = useCallback(
    (id: string, color: CardColorId) => {
      setColorMenuFor(null);
      return patchMeta(id, { [CARD_COLOR_KEY]: color });
    },
    [patchMeta]
  );

  // ── Progressive rendering ──────────────────────────────────────────────────
  // Build RENDER_STEP cards, then more as the end of the board scrolls into
  // view. Where IntersectionObserver is missing, everything renders at once.
  const [renderLimit, setRenderLimit] = useState(RENDER_STEP);
  useEffect(() => { setRenderLimit(RENDER_STEP); }, [query]);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const hasMore = cards.length > renderLimit;
  useEffect(() => {
    const el = moreRef.current;
    if (!hasMore || !el) return;
    if (typeof IntersectionObserver === "undefined") { setRenderLimit(Infinity); return; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((en) => en.isIntersecting)) setRenderLimit((n) => n + RENDER_STEP); },
      { root: boardRef.current, rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, renderLimit]);
  const shownPinned = pinned.slice(0, renderLimit);
  const shownOthers = others.slice(0, Math.max(0, renderLimit - shownPinned.length));

  const renderCard = (c: (typeof cards)[number]) => {
    const colorId = getCardColor(c);
    const bg = cardColorValue(colorId, isDark);
    const folder = folderNameFor?.(c.id) || null;
    const isActive = c.id === activeDocId;
    const pinnedNow = isCardPinned(c);

    return (
      <div
        key={c.id}
        className={cn(
          "group relative block w-full rounded-xl border text-left",
          "border-border bg-card transition-shadow duration-150 hover:shadow-md",
          "focus-within:ring-2 focus-within:ring-primary/50",
          isActive && "ring-2 ring-primary"
        )}
        style={bg ? { backgroundColor: bg } : undefined}
      >
        {/* The card body is the button: activating it opens the light editor. */}
        <button
          type="button"
          onClick={() => setEditingId(c.id)}
          className="block w-full cursor-pointer rounded-xl p-3 text-left"
          aria-label={t("cards.editNote", { title: c.title })}
        >
          <h3 className="mb-1 line-clamp-2 text-sm font-semibold wrap-anywhere text-foreground">
            {c.title}
          </h3>

          {c.checklist.total > 0 ? (
            <>
              {c.previewHtml && (
                <div
                  data-md-preview
                  data-theme={isDark ? "dark" : "light"}
                  className="pf-card-preview pf-card-preview-sm text-xs wrap-anywhere text-foreground/70"
                  dangerouslySetInnerHTML={{ __html: c.previewHtml }}
                />
              )}
              <ul className="mt-1 space-y-1">
              {c.checklist.items.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                  <span
                    className={cn(
                      "mt-[2px] flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                      item.checked ? "border-primary bg-primary/20" : "border-foreground/40"
                    )}
                    aria-hidden
                  >
                    {item.checked && <Check className="size-2.5" />}
                  </span>
                  <span className={cn("wrap-anywhere", item.checked && "line-through opacity-85")}>
                    {item.text}
                  </span>
                </li>
              ))}
              {c.checklist.overflow > 0 && (
                <li className="pl-5 text-xs opacity-85">{t("cards.more", { count: c.checklist.overflow })}</li>
              )}
              </ul>
            </>
          ) : c.previewHtml ? (
            <div
              data-md-preview
              data-theme={isDark ? "dark" : "light"}
              className="pf-card-preview pf-card-preview-lg text-xs wrap-anywhere text-foreground/80"
              dangerouslySetInnerHTML={{ __html: c.previewHtml }}
            />
          ) : (
            <p className="text-xs italic opacity-85">{t("cards.emptyNote")}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] opacity-85">
            {folder && <span className="rounded bg-foreground/10 px-1.5 py-0.5">{folder}</span>}
            {c.checklist.total > 0 && (
              <span>
                {t("cards.checklistDone", { count: c.checklist.done, total: c.checklist.total })}
              </span>
            )}
            <span>{relTime(c.updated)}</span>
          </div>
        </button>

        {/* Row actions. Always visible on touch (pointer-coarse) — hover-only
            controls are unreachable on a phone. */}
        <div
          className={cn(
            "flex items-center gap-0.5 border-t border-foreground/10 px-1 py-1",
            "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
            "pointer-coarse:opacity-100"
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-8"
            title={pinnedNow ? t("cards.unpin") : t("cards.pinToTop")}
            aria-label={pinnedNow ? t("cards.unpinNote") : t("cards.pinNoteToTop")}
            aria-pressed={pinnedNow}
            disabled={readOnly}
            onClick={() => togglePin(c.id, !pinnedNow)}
          >
            {pinnedNow ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </Button>

          <div className="relative" data-card-color-menu>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 pointer-coarse:size-8"
              title={t("cards.colour")}
              aria-label={t("cards.changeNoteColour")}
              aria-haspopup="menu"
              aria-expanded={colorMenuFor === c.id}
              disabled={readOnly}
              onClick={() => setColorMenuFor(colorMenuFor === c.id ? null : c.id)}
            >
              <Palette className="size-3.5" />
            </Button>
            {colorMenuFor === c.id && (
              <div
                role="menu"
                aria-label={t("cards.noteColour")}
                className="absolute bottom-full left-0 z-10 mb-1 grid w-max grid-cols-5 gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-lg"
              >
                {CARD_COLORS.map((col) => {
                  const swatch = cardColorValue(col.id, isDark);
                  return (
                    <button
                      key={col.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={colorId === col.id}
                      title={col.label}
                      aria-label={col.label}
                      onClick={() => setColor(c.id, col.id)}
                      className={cn(
                        "size-6 rounded-full border transition-transform hover:scale-110 pointer-coarse:size-8",
                        colorId === col.id ? "border-primary ring-2 ring-primary/40" : "border-border"
                      )}
                      style={swatch ? { backgroundColor: swatch } : undefined}
                    >
                      {!swatch && <span className="text-[9px] opacity-60" aria-hidden>∅</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-8"
            title={t("cards.openInEditor")}
            aria-label={t("cards.openNoteInTheEditor")}
            onClick={() => onOpenInEditor(c.id)}
          >
            <ExternalLink className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7 text-destructive pointer-coarse:size-8"
            title={t("common.delete")}
            aria-label={t("cards.deleteNote")}
            disabled={readOnly}
            onClick={() => onDelete(c.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div ref={rootRef} className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <StickyNote className="size-4 shrink-0 text-primary" aria-hidden />
        <h2 className="shrink-0 text-sm font-semibold">{t("cards.boardTitle")}</h2>
        <div className="relative ml-2 min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 opacity-50"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cards.searchNotes")}
            aria-label={t("cards.searchNotesLabel")}
            className="h-8 w-full pl-7 text-base md:text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("cards.clearSearch")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 opacity-60 hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {/* Same exit affordance as the relationship map — these are peer
            full-canvas surfaces, so they should not leave by different doors
            (a bare X here vs. a labeled Back button there). */}
        <Button
          variant="default"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={onClose}
          title={t("cards.backToEditorEsc")}
          aria-label={t("cards.backToTheEditor")}
        >
          <ArrowLeft className="size-4" /> <span className="hidden sm:inline">{t("cards.backToEditor")}</span>
        </Button>
      </div>

      {/* Board */}
      <div ref={boardRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {/* Composer */}
        {!readOnly && (
          <div className="mb-4 w-full max-w-xl">
            {!composerOpen ? (
              /* Two real buttons side by side, not one nested in the other.
                  The checklist affordance used to be a span with role=button,
                  tabIndex of -1 and aria-hidden, INSIDE the capture button:
                  aria-hidden removed it from the accessibility tree while
                  role=button claimed it was one, and the negative tabIndex took
                  it out of tab order, so checklist capture was reachable by
                  pointer only. A button nested in a button is also invalid
                  HTML. */
              <div className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm opacity-85 shadow-sm transition-shadow hover:shadow-md">
                <button
                  type="button"
                  onClick={openComposer}
                  aria-label={hasDraft ? t("cards.continueYourDraftNote") : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                >
                  <StickyNote className="size-4 shrink-0 opacity-60" aria-hidden />
                  {/* A kept draft (Escape collapses the composer without
                      discarding it) shows here, so it is not invisible state. */}
                  {hasDraft ? (
                    <span className="min-w-0 flex-1 truncate">
                      <span className="mr-1.5 rounded bg-primary/15 px-1 py-0.5 text-[10px] font-semibold uppercase text-primary-strong">{t("cards.draft")}</span>
                      {draftTitle.trim() || draftBody.trim().split("\n")[0]}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{t("cards.takeANote")}</span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={t("cards.takeAChecklistNote")}
                  title={t("cards.takeAChecklistNote")}
                  className="flex shrink-0 items-center justify-center rounded p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:size-8"
                  onClick={() => {
                    setDraftList(true);
                    openComposer();
                  }}
                >
                  <ListTodo className="size-4" />
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card p-3 shadow-md">
                <Input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder={t("cards.titlePlaceholder")}
                  aria-label={t("cards.noteTitle")}
                  className="mb-2 h-8 border-0 px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
                  onKeyDown={(e) => {
                    // Enter moves to the body rather than submitting — a title-only
                    // note is rarely what someone means on the first keystroke.
                    if (e.key === "Enter" && !isImeComposing(e)) {
                      e.preventDefault();
                      (e.currentTarget.parentElement?.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
                    }
                  }}
                />
                {/* The BODY takes focus, not the title: "Take a note…" promises
                    you can just start writing, and most quick captures never get
                    a title at all (one is derived from the first line). */}
                <textarea
                  autoFocus
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  placeholder={draftList ? t("cards.oneItemPerLine") : t("cards.takeANote")}
                  aria-label={t("cards.noteBody")}
                  rows={draftList ? 4 : 3}
                  className="w-full resize-y bg-transparent text-sm outline-none placeholder:opacity-50"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void commitComposer();
                    }
                  }}
                />
                <div className="mt-2 flex items-center gap-1">
                  <Button
                    variant={draftList ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    aria-pressed={draftList}
                    onClick={() => setDraftList((v) => !v)}
                    title={t("cards.checklistTitle")}
                  >
                    <ListTodo className="size-3.5" />
                    {t("cards.checklist")}
                  </Button>
                  <span className="ml-auto hidden text-[10px] opacity-85 sm:inline">
                    {t("cards.saveHint", { keys: "⌘↵" })}
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelComposer}>
                    {t("common.cancel")}
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={() => void commitComposer()}>
                    {t("cards.addNote")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {hydrating ? (
          <div className="flex items-start gap-3" aria-busy="true" aria-label={t("cards.loadingNotes")}>
            {Array.from({ length: colCount }).map((_, col) => (
              <div key={col} className="flex min-w-0 flex-1 flex-col gap-3">
                {Array.from({ length: Math.max(1, Math.ceil(Math.min(8, Math.max(docs.length, 3)) / colCount)) }).map((_, i) => (
                  <div key={i} className="h-24 w-full rounded-xl border border-border bg-card/60" />
                ))}
              </div>
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <StickyNote className="size-8 opacity-40" aria-hidden />
            <p className="text-sm font-medium opacity-85">
              {query ? t("cards.noNotesMatchYourSearch") : t("cards.noNotesYet")}
            </p>
            <p className="text-xs opacity-85">
              {query ? t("cards.tryADifferentWord") : t("cards.emptyHint", { action: t("cards.takeANote") })}
            </p>
            {query && (
              <Button variant="ghost" size="sm" className="mt-1 text-xs" onClick={() => setQuery("")}>
                {t("cards.clearSearch")}
              </Button>
            )}
          </div>
        ) : (
          <>
            {shownPinned.length > 0 && (
              <>
                <h3 className="mb-1.5 px-0.5 text-[10px] font-semibold tracking-wider uppercase opacity-85">
                  {t("cards.pinned")}
                </h3>
                <Masonry items={shownPinned} cols={colCount} render={renderCard} />
                {shownOthers.length > 0 && (
                  <h3 className="mt-4 mb-1.5 px-0.5 text-[10px] font-semibold tracking-wider uppercase opacity-85">
                    {t("cards.others")}
                  </h3>
                )}
              </>
            )}
            <Masonry items={shownOthers} cols={colCount} render={renderCard} />
            {hasMore && <div ref={moreRef} className="h-8" aria-hidden />}
          </>
        )}
      </div>

      {editing && (
        <CardEditor
          key={editing.id}
          commitRef={cardCommitRef}
          title={editing.title}
          markdown={toMarkdown(editing.canonical)}
          bg={cardColorValue(getCardColor(editing), isDark)}
          isDark={isDark}
          renderMarkdown={renderMarkdown}
          readOnly={readOnly}
          onOpenInEditor={async (nextMarkdown) => {
            // Save BEFORE navigating, and await it: "Open in editor" used to
            // drop whatever had been typed into the note, and opening the doc
            // before the write landed would have loaded the pre-edit copy.
            setEditingId(null);
            if (nextMarkdown != null) await onSaveCard(editing.id, nextMarkdown);
            onOpenInEditor(editing.id);
          }}
          onClose={(nextMarkdown) => {
            setEditingId(null);
            if (nextMarkdown != null) void onSaveCard(editing.id, nextMarkdown);
          }}
        />
      )}
    </div>
  );
}

type CardView = "preview" | "split" | "write";

const CARD_VIEW_KEY = "pf:card-view";

/** Read the persisted card-editor view, defaulting by viewport: a phone has no
 *  room for a split, and someone who opened a note to read it wants it rendered,
 *  so narrow defaults to `preview` and wide to `split`. */
function initialCardView(): CardView {
  let saved: string | null = null;
  try { saved = localStorage.getItem(CARD_VIEW_KEY); } catch { /* ignore */ }
  if (saved === "preview" || saved === "split" || saved === "write") return saved;
  const narrow = typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)").matches;
  return narrow ? "preview" : "split";
}

/**
 * The card editor: a rendered view of the note plus a markdown source, so a
 * reader is never handed raw `##` and `**` where they expected the document.
 *
 * Three views (`preview` · `split` · `write`) behind a segmented control:
 *  - **preview** — the note RENDERED (read-only), the default when a card is
 *    opened, so opening a note shows the document, not its source;
 *  - **split** — source on the left, live rendered on the right (wide only);
 *  - **write** — the markdown source alone.
 * The choice persists (`pf:card-view`). The rendered side reuses the host's
 * markdown engine + sanitizer (`renderMarkdown`), so a card renders exactly like
 * the main preview; without that callback it falls back to write-only.
 *
 * Still deliberately reduced — no formatting toolbar; full authoring is one
 * click away via "Open in editor". It saves only when the text actually
 * changed, so merely reading a note never rewrites (and re-timestamps) it.
 */
function CardEditor({
  commitRef,
  title,
  markdown,
  bg,
  isDark,
  renderMarkdown,
  readOnly,
  onClose,
  onOpenInEditor,
}: {
  /** Published so the board's Escape ladder can close through the SAME commit
   *  path as Done and the backdrop, instead of unmounting this editor and
   *  dropping whatever was typed. */
  commitRef: React.MutableRefObject<(() => void) | null>;
  title: string;
  markdown: string;
  bg: string;
  isDark: boolean;
  renderMarkdown?: (markdown: string) => string;
  readOnly: boolean;
  onClose: (nextMarkdown: string | null) => void;
  /** Receives the pending draft (or null when unchanged) so the note is saved
   *  before the full editor opens it. */
  onOpenInEditor: (nextMarkdown: string | null) => void;
}) {
  const t = useT();
  const [text, setText] = useState(markdown);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const originalRef = useRef(markdown);

  // Without a renderer there is nothing to render, so the toggle can't offer
  // preview/split — collapse to write-only.
  const canRender = !!renderMarkdown;
  const [view, setView] = useState<CardView>(() => (canRender ? initialCardView() : "write"));
  const effectiveView: CardView = canRender ? view : "write";

  const setViewPersist = useCallback((v: CardView) => {
    setView(v);
    try { localStorage.setItem(CARD_VIEW_KEY, v); } catch { /* ignore */ }
  }, []);

  // Rendered HTML for the current draft (live — reflects unsaved edits, and is
  // what makes split useful). Memoised on the text so typing doesn't re-render
  // the whole document tree every keystroke beyond the one changed value.
  // Images stored as assets (A086) are moved off `src` before the HTML reaches
  // the page — a `pf-asset:` source is unloadable, and a CSP violation — and
  // resolved to object URLs once it is there.
  const html = useMemo(
    () => (renderMarkdown ? neutralizeAssetSrcs(renderMarkdown(text)) : ""),
    [renderMarkdown, text]
  );
  const renderedRef = useRef<HTMLDivElement | null>(null);
  useResolvedAssetImages(renderedRef, html);

  const showWrite = effectiveView !== "preview";
  const showRender = canRender && effectiveView !== "write";

  useEffect(() => {
    if (!showWrite) return;
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    // Caret to the end — the common intent is "add to this note".
    el.setSelectionRange(el.value.length, el.value.length);
  }, [showWrite]);

  /** The draft to persist, or null when nothing changed (so merely reading a
   *  note never rewrites and re-timestamps it). */
  const pending = useCallback(
    () => (!readOnly && text !== originalRef.current ? text : null),
    [readOnly, text]
  );

  const finish = useCallback(() => { onClose(pending()); }, [onClose, pending]);

  // Re-registered as the text changes, so Escape always commits the LATEST
  // draft rather than a stale closure.
  useEffect(() => {
    commitRef.current = finish;
    return () => { if (commitRef.current === finish) commitRef.current = null; };
  }, [commitRef, finish]);

  const rendered = (
    <div
      // Links inside a rendered card are for reading, not navigation — a stray
      // click must not tear the reader out of the board. Real navigation is
      // "Open in editor".
      onClick={(e) => {
        const a = (e.target as HTMLElement)?.closest?.("a");
        if (a) e.preventDefault();
      }}
      data-md-preview
      data-theme={isDark ? "dark" : "light"}
      className="pf-card-render min-h-[40dvh] flex-1 overflow-y-auto p-3 text-sm leading-relaxed"
    >
      {text.trim()
        ? <div ref={renderedRef} dangerouslySetInnerHTML={{ __html: html }} />
        : <p className="text-sm italic opacity-85">{t("cards.emptyNote")}</p>}
    </div>
  );

  const writer = (
    <textarea
      ref={areaRef}
      value={text}
      readOnly={readOnly}
      onChange={(e) => setText(e.target.value)}
      aria-label={t("cards.noteContentMarkdown")}
      spellCheck
      className={cn(
        "min-h-[40dvh] flex-1 resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none",
        showRender && "border-b border-foreground/10 sm:border-r sm:border-b-0"
      )}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          finish();
        }
      }}
    />
  );

  const ViewButton = ({ v, label }: { v: CardView; label: string }) => (
    <button
      type="button"
      onClick={() => setViewPersist(v)}
      aria-pressed={effectiveView === v}
      className={cn(
        "px-2 py-0.5 text-[11px] font-medium transition-colors",
        effectiveView === v
          ? "bg-primary/15 text-primary-strong"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {label}
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("cards.editNote", { title })}
      onPointerDown={(e) => {
        // Backdrop click saves and closes (Keep behaviour).
        if (e.target === e.currentTarget) finish();
      }}
    >
      <div
        className="my-auto flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-2xl"
        style={bg ? { backgroundColor: bg } : undefined}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-foreground/10 px-3 py-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={title}>
            {title}
          </h3>
          {canRender && (
            <div
              role="group"
              aria-label={t("cards.noteView")}
              className="hidden shrink-0 overflow-hidden rounded-md border border-border xs:flex"
            >
              <ViewButton v="preview" label={t("cards.viewPreview")} />
              {/* Split needs two columns — offer it on wider viewports only. */}
              <span className="hidden sm:contents"><ViewButton v="split" label={t("cards.viewSplit")} /></span>
              <ViewButton v="write" label={readOnly ? t("cards.viewSource") : t("cards.viewWrite")} />
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 text-xs"
            onClick={() => onOpenInEditor(pending())}
            title={t("cards.openInFullEditor")}
          >
            <ExternalLink className="size-3.5" />
            <span className="hidden sm:inline">{t("cards.openInEditor")}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={finish}
            aria-label={t("cards.closeNote")}
            title={t("cards.closeEsc")}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Body: one pane, or two side by side in split. */}
        <div className={cn("flex min-h-0 flex-1", showWrite && showRender ? "flex-col sm:flex-row" : "flex-col")}>
          {showWrite && writer}
          {showRender && rendered}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/10 px-3 py-2">
          <span className="mr-auto hidden text-[10px] opacity-85 sm:inline">
            {effectiveView === "preview" ? t("cards.footerRendered", { keys: "⌘↵" }) : t("cards.footerMarkdown", { keys: "⌘↵" })}
          </span>
          <Button size="sm" className="h-7 text-xs" onClick={finish}>
            {readOnly ? t("common.close") : t("common.done")}
          </Button>
        </div>
      </div>
    </div>
  );
}
