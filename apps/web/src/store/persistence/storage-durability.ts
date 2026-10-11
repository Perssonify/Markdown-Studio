/**
 * Storage durability — protection against the BROWSER losing the library
 * (production-readiness audit A017 / A022 / A004).
 *
 * Every document lives in this origin's IndexedDB and nowhere else, and the
 * platform can take it away: Safari deletes script-writable storage after seven
 * days without a visit unless the site is installed (Home Screen / Dock);
 * Chromium evicts "best-effort" origins under disk pressure; a private window
 * discards everything on close; and storage is per-origin, so a domain move
 * strands it. The data-loss guards elsewhere defend against our own bugs; this
 * module is about the platform:
 *
 *  - PERSISTENCE: ask the browser to keep this origin's data
 *    (`navigator.storage.persist()`) after the first successful save, and report
 *    the state and usage in Settings.
 *  - BACKUPS: remember when the last full, restorable backup ran and nudge
 *    gently once it is stale (or has never happened).
 *  - THE CANARY: a tiny localStorage record of how many documents this origin
 *    held. An IndexedDB that comes back EMPTY while the canary remembers
 *    documents is a wipe, not a first visit — so it is explained instead of
 *    greeted by freshly seeded starter documents that make it look like one.
 *    It catches the losses that leave localStorage behind (Chromium eviction,
 *    a damaged or deleted database); a wipe that takes localStorage too is
 *    indistinguishable from a new visitor, and is treated as one.
 *  - AVAILABILITY: whether saving works at all in this window.
 *  - THE MOVE: whether this page is running on the retired origin.
 *
 * Read-only and conservative by design: nothing here writes, moves or deletes a
 * document. The most any of it does is show a notice, or skip seeding the
 * starter documents into a library the browser has just emptied.
 *
 * Every `pf:` key below is an on-disk contract once shipped — do not rename.
 */
import { LEGACY_APP_HOST } from "@/constants";
import { safeStorage } from "@/utils/safe-storage";
import { MemoryStorageAdapter, type StorageAdapter } from "./storage-adapter";
import { t } from "@/i18n/core";

// ── Keys & timings ─────────────────────────────────────────────────────────

export const CANARY_KEY = "pf:library-canary";
export const LAST_BACKUP_KEY = "pf:last-full-backup";
export const CONTENT_SINCE_KEY = "pf:content-since";
export const BACKUP_SNOOZE_KEY = "pf:backup-nudge-snoozed-until";
export const PERSIST_ATTEMPT_KEY = "pf:persist-requested-at";
export const INSTALL_TIP_SNOOZE_KEY = "pf:install-tip-snoozed-until";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** A full backup older than this is stale. */
export const BACKUP_STALE_MS = 7 * DAY_MS;
/** Grace before nudging someone who has never backed up: not on their first day. */
export const FIRST_BACKUP_GRACE_MS = DAY_MS;
/** How long "Not now" on the backup nudge lasts. */
export const BACKUP_SNOOZE_MS = 7 * DAY_MS;
/** How long "Got it" on the install tip lasts. */
export const INSTALL_TIP_SNOOZE_MS = 30 * DAY_MS;
/**
 * Minimum gap between automatic `persist()` requests. Chromium decides silently
 * and may say yes later as engagement grows; Firefox shows a prompt, so asking
 * on every visit would nag.
 */
export const PERSIST_RETRY_MS = 7 * DAY_MS;

function readNumber(key: string): number | null {
  const raw = safeStorage.get(key);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Observable session state (for the notices UI) ─────────────────────────

export interface WipeInfo {
  /** How many documents the canary last saw here. */
  expectedCount: number;
  /** When it saw them (ms epoch; 0 if unknown). */
  lastSeenAt: number;
}

interface DurabilityState {
  /** Set at boot when the library came back empty but the canary remembers documents. */
  wipe: WipeInfo | null;
  /** The boot check has run; the canary may be written from now on. */
  canaryArmed: boolean;
  /** Bumped when a stored value the UI reads changes (backup time, snoozes). */
  revision: number;
}

let state: DurabilityState = { wipe: null, canaryArmed: false, revision: 0 };
const listeners = new Set<() => void>();

function setState(patch: Partial<DurabilityState>): void {
  state = { ...state, ...patch, revision: state.revision + 1 };
  for (const l of listeners) l();
}

export function subscribeDurability(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDurabilitySnapshot(): DurabilityState {
  return state;
}

// ── The canary ─────────────────────────────────────────────────────────────

export interface LibraryCanary {
  count: number;
  at: number;
}

export function readCanary(): LibraryCanary | null {
  const raw = safeStorage.get(CANARY_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { count?: unknown; at?: unknown };
    if (typeof v.count === "number" && Number.isFinite(v.count) && v.count >= 0) {
      return { count: v.count, at: Number(v.at) || 0 };
    }
  } catch {
    /* corrupt — treat as absent */
  }
  return null;
}

function writeCanary(count: number, now: number): void {
  safeStorage.set(CANARY_KEY, JSON.stringify({ count, at: now }));
}

/** Pure: an EMPTY library where the canary remembers documents was wiped. */
export function detectWipe(storedCount: number, canary: LibraryCanary | null): WipeInfo | null {
  if (storedCount > 0 || !canary || canary.count <= 0) return null;
  return { expectedCount: canary.count, lastSeenAt: canary.at };
}

/**
 * The boot check. Call once, right after the library has been read from
 * storage and BEFORE anything is seeded into it. Returns true when the library
 * looks wiped — the caller must then NOT seed starter documents (that would
 * dress the loss up as a first visit, and the notice explains it instead).
 * Arms the canary either way.
 */
export function noteLibraryAtBoot(storedCount: number, now = Date.now()): boolean {
  const wipe = detectWipe(storedCount, readCanary());
  if (!wipe) writeCanary(storedCount, now);
  setState({ wipe, canaryArmed: true });
  return wipe !== null;
}

/**
 * Keep the canary current as the library changes. A no-op until the boot check
 * has run (the library is not known yet). While a detected wipe is unanswered
 * an empty library is NOT recorded — reloading must not turn the evidence into
 * a clean slate — but any document arriving (a restored backup, a new note)
 * retires the notice and is recorded normally.
 */
export function recordLibrarySize(count: number, now = Date.now()): void {
  if (!state.canaryArmed) return;
  if (state.wipe) {
    if (count === 0) return;
    setState({ wipe: null });
  }
  writeCanary(count, now);
}

/** The user has read the wipe notice: start this origin afresh. */
export function acknowledgeWipe(now = Date.now()): void {
  writeCanary(0, now);
  setState({ wipe: null });
}

// ── Backups ────────────────────────────────────────────────────────────────

/** Record that a full, restorable backup was just downloaded. */
export function recordFullBackup(now = Date.now()): void {
  safeStorage.set(LAST_BACKUP_KEY, String(now));
  setState({});
}

export function readLastBackup(): number | null {
  return readNumber(LAST_BACKUP_KEY);
}

export function readContentSince(): number | null {
  return readNumber(CONTENT_SINCE_KEY);
}

export function snoozeBackupNudge(now = Date.now()): void {
  safeStorage.set(BACKUP_SNOOZE_KEY, String(now + BACKUP_SNOOZE_MS));
  setState({});
}

export interface BackupNudgeInput {
  now: number;
  docCount: number;
  /** First successful save in this browser (null: nothing written yet). */
  contentSince: number | null;
  lastBackupAt: number | null;
  snoozedUntil: number | null;
}

/**
 * Pure: is a backup reminder due? Only once the library holds something the
 * user has written; never while snoozed; for someone who has never backed up,
 * not before a day has passed (the first session belongs to the writing); and
 * otherwise once the last full backup is older than a week.
 */
export function backupNudgeDue(i: BackupNudgeInput): boolean {
  if (i.docCount <= 0 || i.contentSince == null) return false;
  if (i.snoozedUntil != null && i.now < i.snoozedUntil) return false;
  if (i.lastBackupAt == null) return i.now - i.contentSince >= FIRST_BACKUP_GRACE_MS;
  return i.now - i.lastBackupAt > BACKUP_STALE_MS;
}

export function backupNudgeInput(docCount: number, now = Date.now()): BackupNudgeInput {
  return {
    now,
    docCount,
    contentSince: readContentSince(),
    lastBackupAt: readLastBackup(),
    snoozedUntil: readNumber(BACKUP_SNOOZE_KEY),
  };
}

/** "today", "yesterday", "12 days ago" — whole days, as a reminder needs. */
export function daysAgoLabel(then: number, now = Date.now()): string {
  const days = Math.floor((now - then) / DAY_MS);
  if (days <= 0) return t("notices.today");
  if (days === 1) return t("notices.yesterday");
  return t("notices.daysAgo", { count: days });
}

// ── Persistent storage ─────────────────────────────────────────────────────

/** The slice of `StorageManager` used here (injectable for tests). */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

function storageManager(): StorageManagerLike | undefined {
  try {
    return typeof navigator !== "undefined" ? (navigator.storage as StorageManagerLike | undefined) : undefined;
  } catch {
    return undefined;
  }
}

export interface PersistenceStatus {
  /** The browser exposes persist()/persisted(). */
  supported: boolean;
  /** null when unknown (unsupported, or the query failed). */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

/** Current persistence state and usage. Never throws. */
export async function readPersistenceStatus(sm: StorageManagerLike | undefined = storageManager()): Promise<PersistenceStatus> {
  const out: PersistenceStatus = {
    supported: typeof sm?.persist === "function" && typeof sm?.persisted === "function",
    persisted: null,
    usage: null,
    quota: null,
  };
  try {
    if (typeof sm?.persisted === "function") out.persisted = await sm.persisted();
  } catch {
    /* unknown */
  }
  try {
    if (typeof sm?.estimate === "function") {
      const e = await sm.estimate();
      out.usage = typeof e?.usage === "number" ? e.usage : null;
      out.quota = typeof e?.quota === "number" ? e.quota : null;
    }
  } catch {
    /* unknown */
  }
  return out;
}

/**
 * Ask the browser to keep this origin's data. Automatic calls are throttled to
 * one per {@link PERSIST_RETRY_MS} unless `force` (a user's button press).
 * Resolves the browser's answer, or null when not asked (unsupported,
 * throttled, or the call failed). Never throws.
 */
export async function requestPersistence(
  opts: { force?: boolean; now?: number; sm?: StorageManagerLike } = {},
): Promise<boolean | null> {
  const sm = opts.sm ?? storageManager();
  const now = opts.now ?? Date.now();
  try {
    if (typeof sm?.persist !== "function" || typeof sm?.persisted !== "function") return null;
    if (await sm.persisted()) return true;
    const last = readNumber(PERSIST_ATTEMPT_KEY);
    if (!opts.force && last != null && now - last < PERSIST_RETRY_MS) return null;
    safeStorage.set(PERSIST_ATTEMPT_KEY, String(now));
    return await sm.persist();
  } catch {
    return null;
  }
}

// ── The session watcher ────────────────────────────────────────────────────

/** The slice of the document store the watcher reads (injectable for tests). */
export interface WatchedStore {
  getState(): { documents: readonly unknown[]; saveStatus: string };
  subscribe(listener: (s: { documents: readonly unknown[]; saveStatus: string }) => void): () => void;
}

let persistRequestedThisSession = false;

/**
 * Watch the library for the session: keep the canary current, and on the FIRST
 * successful save note that the library now holds the user's writing and ask
 * the browser to persist this origin's storage. Returns an unsubscribe.
 */
export function startDurabilityWatch(
  store: WatchedStore,
  opts: { sm?: StorageManagerLike; now?: () => number } = {},
): () => void {
  const now = opts.now ?? Date.now;
  let lastCount = -1;
  const onState = (s: { documents: readonly unknown[]; saveStatus: string }) => {
    const count = s.documents.length;
    if (count !== lastCount) {
      lastCount = count;
      recordLibrarySize(count, now());
    }
    if (s.saveStatus === "saved" && !persistRequestedThisSession) {
      persistRequestedThisSession = true;
      if (readContentSince() == null) {
        safeStorage.set(CONTENT_SINCE_KEY, String(now()));
        setState({});
      }
      void requestPersistence({ sm: opts.sm, now: now() });
    }
  };
  onState(store.getState());
  return store.subscribe(onState);
}

// ── Safari: install to escape the 7-day cap ────────────────────────────────

/**
 * Pure: WebKit browsers that apply the seven-day cap on script-writable storage
 * — every iOS/iPadOS browser (all WebKit) and desktop Safari. Chromium, Firefox,
 * Edge and Opera also say "Safari" in their user agents and are excluded.
 */
export function isSevenDayCapBrowser(ua: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPod|iPad/.test(ua)) return true;
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return true; // iPadOS desktop UA
  return /Safari\//.test(ua) && /Version\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Firefox/.test(ua);
}

/** Pure: iPhone/iPad (Home Screen) rather than a Mac (Dock). */
export function isAppleMobile(ua: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

/** Running as an installed web app (exempt from the seven-day cap). */
export function isInstalledApp(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return typeof window !== "undefined" && !!window.matchMedia?.("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

export interface InstallTipInput {
  sevenDayCap: boolean;
  installed: boolean;
  /** null = unknown; a granted persistence request already protects the data. */
  persisted: boolean | null;
  docCount: number;
  snoozedUntil: number | null;
  now: number;
}

/** Pure: show the "install to keep your library" tip? */
export function installTipDue(i: InstallTipInput): boolean {
  if (!i.sevenDayCap || i.installed || i.persisted === true || i.docCount <= 0) return false;
  return !(i.snoozedUntil != null && i.now < i.snoozedUntil);
}

export function readInstallTipSnooze(): number | null {
  return readNumber(INSTALL_TIP_SNOOZE_KEY);
}

export function snoozeInstallTip(now = Date.now()): void {
  safeStorage.set(INSTALL_TIP_SNOOZE_KEY, String(now + INSTALL_TIP_SNOOZE_MS));
  setState({});
}

// ── The move (A004) ────────────────────────────────────────────────────────

/** Pure: is this page running on the retired origin? */
export function isLegacyOrigin(hostname: string): boolean {
  return hostname.toLowerCase() === LEGACY_APP_HOST;
}

// ── Availability (A022) ────────────────────────────────────────────────────

/**
 * Does saving work in this window? False for the in-memory adapter (chosen when
 * neither IndexedDB nor localStorage is usable) and for an IndexedDB adapter
 * whose database refused to open — Safari private mode, blocked site data and
 * some in-app browsers take that path, and every save then fails. Never throws.
 */
export async function storagePersists(adapter: StorageAdapter): Promise<boolean> {
  if (adapter instanceof MemoryStorageAdapter) return false;
  const isReady = (adapter as { isReady?: () => Promise<void> }).isReady;
  if (typeof isReady === "function") {
    try {
      await isReady.call(adapter);
    } catch {
      return false;
    }
  }
  return true;
}

// ── Which notice to show ───────────────────────────────────────────────────

export type DurabilityNotice = "unavailable" | "wiped" | "moved" | "backup" | "install";

export interface NoticeInput {
  /** Saving works in this window (false ⇒ nothing persists). */
  storageOk: boolean;
  /** The app-level notices are enabled (standalone app, not an embed). */
  appNotices: boolean;
  wiped: boolean;
  legacyOrigin: boolean;
  movedDismissed: boolean;
  backupDue: boolean;
  installDue: boolean;
}

/**
 * Pure: at most ONE notice, most urgent first. A stack of strips over the
 * editor reads as an error page; the next one surfaces when this one is dealt
 * with. "Not saving" outranks everything and cannot be dismissed (A022) — it
 * is also the only one an embed ever shows.
 */
export function pickDurabilityNotice(i: NoticeInput): DurabilityNotice | null {
  if (!i.storageOk) return "unavailable";
  if (!i.appNotices) return null;
  if (i.wiped) return "wiped";
  if (i.legacyOrigin && !i.movedDismissed) return "moved";
  if (i.backupDue) return "backup";
  if (i.installDue) return "install";
  return null;
}

// ── Tests ──────────────────────────────────────────────────────────────────

export function _resetDurabilityForTests(): void {
  state = { wipe: null, canaryArmed: false, revision: 0 };
  persistRequestedThisSession = false;
  listeners.clear();
}
