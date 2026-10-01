/**
 * Per-document undo-history cache — VS Code-style undo stacks that survive
 * switching between documents.
 *
 * How it works: ProseMirror and CodeMirror editor states are immutable
 * persistent data structures, so "capturing" a pane's state is a reference
 * grab, not a copy. On switch-away we store both panes' states keyed by doc
 * id; on switch-back we restore them — but ONLY after validating that the
 * cached content matches the content being hydrated. If the document changed
 * by any other means (revert, host API patch, another tab, a discarded
 * draft), the entry is silently discarded and hydration proceeds with fresh
 * history. This validation is what keeps the cross-document-corruption
 * guarantees intact: a stale cache can never resurrect outdated content.
 *
 * Memory governance: JavaScript cannot measure the retained size of an
 * object graph, so sizes are ESTIMATES derived from serialized content
 * length plus a per-undo-step allowance — clearly labeled as estimates in
 * the UI. Entries are evicted LRU when the entry count or the estimated
 * byte budget is exceeded. The cache is session-only (never persisted);
 * only its CONFIG is persisted via the storage adapter's prefs.
 */

import { quickHash } from "../utils";
import { t } from "../i18n/core";

export interface HistoryCacheConfig {
  /** Master switch. Off = pre-feature behavior (fresh history per switch). */
  enabled: boolean;
  /** Maximum number of documents to keep history for (LRU beyond this). */
  maxDocs: number;
  /** Estimated-memory budget in megabytes (LRU eviction beyond this). */
  maxMB: number;
}

export const HISTORY_CACHE_DEFAULTS: HistoryCacheConfig = {
  enabled: true,
  maxDocs: 10,
  maxMB: 16,
};

export const HISTORY_CACHE_LIMITS = {
  maxDocsOptions: [5, 10, 20, 50],
  maxMBOptions: [8, 16, 32, 64],
} as const;

interface CacheEntry {
  /** Opaque pane states (PM EditorState / CM EditorState). */
  tiptapState: unknown;
  cmState: unknown;
  /** Validation fingerprints of the content at capture time. */
  tiptapDocHash: number;
  cmText: string;
  /** Estimated retained bytes (content + per-step allowance). Approximate. */
  estBytes: number;
  /** Undo/redo depths at capture (for display only). */
  undoSteps: number;
  capturedAt: number;
  lastAccess: number;
}

export interface HistoryCacheEntryStats {
  docId: string;
  estBytes: number;
  undoSteps: number;
  capturedAt: number;
}

export interface HistoryCacheStats {
  enabled: boolean;
  entryCount: number;
  totalEstBytes: number;
  budgetBytes: number;
  maxDocs: number;
  entries: HistoryCacheEntryStats[];
}

const PREFS_KEY = "historyMemory";
const PER_STEP_BYTES = 512; // allowance per undo step beyond the doc snapshot

type PrefsIO = {
  getPrefs: () => Promise<Record<string, unknown>>;
  setPrefs: (p: Record<string, unknown>) => Promise<void>;
};

class HistoryCache {
  private entries = new Map<string, CacheEntry>();
  private config: HistoryCacheConfig = { ...HISTORY_CACHE_DEFAULTS };
  private listeners = new Set<() => void>();
  private prefsIO: PrefsIO | null = null;
  private statsSnapshot: HistoryCacheStats | null = null;

  // ── Config ────────────────────────────────────────────────────────────────

  getConfig(): HistoryCacheConfig {
    return { ...this.config };
  }

  setConfig(patch: Partial<HistoryCacheConfig>): void {
    const next = { ...this.config, ...patch };
    next.maxDocs = Math.max(1, Math.min(200, Math.floor(next.maxDocs)));
    next.maxMB = Math.max(1, Math.min(512, Math.floor(next.maxMB)));
    this.config = next;
    if (!next.enabled) this.entries.clear();
    this.evictToLimits();
    this.persistConfig();
    this.emit();
  }

  /** Wire prefs persistence (called once from the editor init). */
  async init(prefsIO: PrefsIO): Promise<void> {
    this.prefsIO = prefsIO;
    try {
      const prefs = await prefsIO.getPrefs();
      const stored = prefs[PREFS_KEY] as Partial<HistoryCacheConfig> | undefined;
      if (stored && typeof stored === "object") {
        this.config = {
          enabled: typeof stored.enabled === "boolean" ? stored.enabled : this.config.enabled,
          maxDocs: typeof stored.maxDocs === "number" ? stored.maxDocs : this.config.maxDocs,
          maxMB: typeof stored.maxMB === "number" ? stored.maxMB : this.config.maxMB,
        };
        this.emit();
      }
    } catch { /* defaults stand */ }
  }

  private persistConfig(): void {
    const io = this.prefsIO;
    if (!io) return;
    io.getPrefs()
      .then((prefs) => io.setPrefs({ ...prefs, [PREFS_KEY]: this.config }))
      .catch(() => { /* best effort */ });
  }

  // ── Capture / restore ─────────────────────────────────────────────────────

  /**
   * Capture both panes' states for `docId` (called when switching AWAY).
   * `tiptapDocJSON` is the canonical JSON of the tiptap state's doc; `cmText`
   * the md pane's text; `undoSteps` the current undo depth (display only).
   */
  capture(
    docId: string,
    tiptapState: unknown,
    tiptapDocJSON: unknown,
    cmState: unknown,
    cmText: string,
    undoSteps: number
  ): void {
    if (!this.config.enabled || !docId || !tiptapState) return;
    const serialized = JSON.stringify(tiptapDocJSON) ?? "";
    const estBytes = (serialized.length + cmText.length) * 2 + Math.max(0, undoSteps) * PER_STEP_BYTES;
    this.entries.delete(docId); // re-insert = most recent in Map order
    this.entries.set(docId, {
      tiptapState,
      cmState,
      tiptapDocHash: quickHash(serialized),
      cmText,
      estBytes,
      undoSteps,
      capturedAt: Date.now(),
      lastAccess: Date.now(),
    });
    this.evictToLimits();
    this.emit();
  }

  /**
   * Attempt to retrieve a VALID entry for `docId` given the content about to
   * be hydrated. Returns the pane states to restore, or null when there is no
   * entry / the content diverged (entry is then dropped — a stale cache must
   * never resurrect outdated content). `expectedCmText` may be null to skip
   * the md-pane check (the tiptap check alone still gates the restore).
   */
  takeForRestore(
    docId: string,
    expectedCanonical: unknown,
    expectedCmText: string | null
  ): { tiptapState: unknown; cmState: unknown; cmValid: boolean } | null {
    if (!this.config.enabled) return null;
    const entry = this.entries.get(docId);
    if (!entry) return null;

    const expectedHash = quickHash(JSON.stringify(expectedCanonical) ?? "");
    if (expectedHash !== entry.tiptapDocHash) {
      // Content changed since capture — discard, never restore stale state.
      this.entries.delete(docId);
      this.emit();
      return null;
    }
    entry.lastAccess = Date.now();
    const cmValid = expectedCmText == null ? false : expectedCmText === entry.cmText;
    return { tiptapState: entry.tiptapState, cmState: entry.cmState, cmValid };
  }

  /** Drop a single document's cached history (delete/close/clear-row). */
  drop(docId: string): void {
    if (this.entries.delete(docId)) this.emit();
  }

  /** Drop everything (clear-all button, disable). */
  clear(): void {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.emit();
  }

  // ── Eviction ──────────────────────────────────────────────────────────────

  private evictToLimits(): void {
    const budget = this.config.maxMB * 1024 * 1024;
    // Map iteration order is insertion order; capture() re-inserts on update,
    // so the FIRST keys are the least recently captured. Evict from the front.
    while (
      this.entries.size > this.config.maxDocs ||
      (this.entries.size > 0 && this.totalEstBytes() > budget)
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest == null) break;
      this.entries.delete(oldest);
    }
  }

  private totalEstBytes(): number {
    let sum = 0;
    for (const e of this.entries.values()) sum += e.estBytes;
    return sum;
  }

  // ── Observability ─────────────────────────────────────────────────────────

  getStats(): HistoryCacheStats {
    // Cached snapshot so useSyncExternalStore consumers get a stable reference
    // between emits (a fresh object every call would loop React renders).
    if (this.statsSnapshot) return this.statsSnapshot;
    this.statsSnapshot = {
      enabled: this.config.enabled,
      entryCount: this.entries.size,
      totalEstBytes: this.totalEstBytes(),
      budgetBytes: this.config.maxMB * 1024 * 1024,
      maxDocs: this.config.maxDocs,
      entries: Array.from(this.entries.entries()).map(([docId, e]) => ({
        docId,
        estBytes: e.estBytes,
        undoSteps: e.undoSteps,
        capturedAt: e.capturedAt,
      })),
    };
    return this.statsSnapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.statsSnapshot = null;
    for (const l of this.listeners) l();
  }

  /** Test hook: reset to a pristine instance state. */
  _resetForTests(): void {
    this.entries.clear();
    this.config = { ...HISTORY_CACHE_DEFAULTS };
    this.prefsIO = null;
    this.statsSnapshot = null;
    this.emit();
  }
}

export const historyCache = new HistoryCache();

/** Human formatting for estimated byte counts. */
export function formatEstBytes(bytes: number): string {
  // Units are words to a translator ("Ko", "Мб"): the same messages as Settings'.
  if (bytes < 1024) return t("settings.sizeBytes", { count: bytes });
  if (bytes < 1024 * 1024) return t("settings.sizeKb", { count: (bytes / 1024).toFixed(0) });
  return t("settings.sizeMb", { count: (bytes / (1024 * 1024)).toFixed(1) });
}
