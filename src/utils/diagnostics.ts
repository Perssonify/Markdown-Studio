/**
 * Privacy-safe error diagnostics.
 *
 * There was no error reporting of any kind: no `window.onerror`, no
 * `unhandledrejection`, and the error boundary only wrote to the console. A crash
 * in the field left nothing behind that a user could send, and the only tool the
 * runbooks had ([DIAG] logs) is off by default.
 *
 * This keeps a small ring of what went wrong, locally, and nothing else:
 *   - event kind, app version, a coarse browser/OS family, timestamp;
 *   - the error's class and a REDACTED first line of its message;
 *   - where it happened — script file basename and line:col, never a full URL.
 * Document content is never recorded. Messages are the only free text and they
 * are the dangerous part (a KaTeX or Mermaid parse error echoes the source it
 * failed on; a JSON error echoes the input), so they are cut to their first
 * line, quoted fragments and URLs are removed, and the rest is truncated.
 *
 * Nothing leaves the device. A user can COPY the report (the crash screen and
 * the About page offer it); a host embedding the library, or a future endpoint,
 * can subscribe with `setErrorReporter`. Both only ever see redacted entries.
 */
import { VERSION } from "../constants";
import { safeStorage } from "./safe-storage";

export type DiagnosticKind =
  | "error" // uncaught exception
  | "unhandledrejection"
  | "render" // caught by an error boundary
  | "chunk" // a lazy chunk failed to load
  | "save" // a save failed, was refused, or conflicted
  | "sw" // service-worker registration / update problems
  | "boot"; // the boot watchdog had to intervene

export interface DiagnosticEntry {
  /** ISO timestamp of the (latest) occurrence. */
  t: string;
  kind: DiagnosticKind;
  /** App version that produced it. */
  v: string;
  /** Error class, e.g. "TypeError". */
  name: string;
  /** Redacted, truncated first line of the message. */
  message: string;
  /** Script basename + line:col, when known. */
  where?: string;
  /** Up to MAX_FRAMES frames as `fn@file.js:line:col`. */
  stack?: string[];
  /** How many consecutive identical events this entry stands for. */
  count?: number;
}

export type ErrorReporter = (entry: DiagnosticEntry) => void;

export const DIAGNOSTICS_KEY = "pf:diagnostics";
/** Written by the inline boot watchdog in index.html just before it recovers. */
export const BOOT_RECOVERY_KEY = "pf:boot-recovered";
const MAX_ENTRIES = 25;
const MAX_MESSAGE = 200;
const MAX_FRAMES = 6;

// ── Redaction ────────────────────────────────────────────────────────────────

/**
 * Reduce an error message to something safe to hand to a stranger. Keeps the
 * shape of the error ("Cannot read properties of undefined (reading …)") and
 * drops anything that may have come from the user's text.
 */
export function redactMessage(raw: unknown): string {
  let s = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  // First line only: Mermaid and friends put the offending source below it.
  s = s.split(/\r?\n/, 1)[0] ?? "";
  // KaTeX: "… at position 12: <the formula>", and the unknown command it names
  // ("Undefined control sequence: \salary") is the user's own word too.
  s = s.replace(/(\bat position \d+):.*$/i, "$1: …");
  s = s.replace(/\\[A-Za-z@]+/g, "\\…");
  // URLs → origin only (paths and queries carry document names and tokens).
  s = s.replace(/\b(https?:\/\/[^/\s"'`<>]+)[^\s"'`<>]*/gi, "$1/…");
  s = s.replace(/\b(blob|data|file):[^\s"'`<>]*/gi, "$1:…");
  // Quoted fragments — the classic carrier of user input in error text.
  s = s.replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”|‘[^’]*’/g, "\"…\"");
  // Anything still email-shaped.
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > MAX_MESSAGE ? s.slice(0, MAX_MESSAGE - 1) + "…" : s;
}

/** `https://host/assets/index-abc.js?x=1` → `index-abc.js`. */
function basename(url: string): string {
  const noQuery = url.split(/[?#]/, 1)[0] ?? "";
  if (/^(blob|data):/i.test(noQuery)) return noQuery.slice(0, noQuery.indexOf(":") + 1) + "…";
  const parts = noQuery.split("/");
  return parts[parts.length - 1] || noQuery;
}

/** Chromium (`at fn (url:1:2)`) and Firefox/Safari (`fn@url:1:2`) frames. */
export function summarizeStack(stack: unknown): string[] | undefined {
  if (typeof stack !== "string" || !stack) return undefined;
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const chrome = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/);
    const gecko = !chrome && line.match(/^\s*([^@\s]*)@(.+?):(\d+):(\d+)\s*$/);
    const m = chrome || gecko;
    if (!m) continue;
    const fn = (m[1] || "<anonymous>").replace(/[^\w$.<>[\] -]/g, "").slice(0, 60) || "<anonymous>";
    frames.push(`${fn}@${basename(m[2] ?? "")}:${m[3]}:${m[4]}`);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames.length ? frames : undefined;
}

/** "Chrome 140 · Windows" — the family and major version, nothing finer. */
export function uaFamily(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const pick = (re: RegExp) => ua.match(re)?.[1];
  const browser =
    (pick(/Edg(?:e|A|iOS)?\/(\d+)/) && `Edge ${pick(/Edg(?:e|A|iOS)?\/(\d+)/)}`) ||
    (pick(/OPR\/(\d+)/) && `Opera ${pick(/OPR\/(\d+)/)}`) ||
    (pick(/SamsungBrowser\/(\d+)/) && `Samsung Internet ${pick(/SamsungBrowser\/(\d+)/)}`) ||
    (pick(/(?:Firefox|FxiOS)\/(\d+)/) && `Firefox ${pick(/(?:Firefox|FxiOS)\/(\d+)/)}`) ||
    (pick(/CriOS\/(\d+)/) && `Chrome ${pick(/CriOS\/(\d+)/)}`) ||
    (pick(/Chrome\/(\d+)/) && `Chrome ${pick(/Chrome\/(\d+)/)}`) ||
    (/Safari\//.test(ua) && pick(/Version\/(\d+)/) && `Safari ${pick(/Version\/(\d+)/)}`) ||
    "Unknown browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown OS";
  // In-app webviews are how many people first meet the app; worth knowing.
  const webview = /FBAN|FBAV|Instagram|Line\/|\bwv\b|WhatsApp|Slack|Telegram/.test(ua) ? " (in-app webview)" : "";
  return `${browser} · ${os}${webview}`;
}

// ── The ring ─────────────────────────────────────────────────────────────────

let ring: DiagnosticEntry[] | null = null;
let reporter: ErrorReporter | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function load(): DiagnosticEntry[] {
  if (ring) return ring;
  ring = [];
  try {
    const raw = safeStorage.get(DIAGNOSTICS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ring = parsed.filter((e) => e && typeof e.kind === "string").slice(-MAX_ENTRIES);
  } catch {
    ring = [];
  }
  return ring;
}

/** Persist at most once a second: an error loop must not also be a write loop. */
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    safeStorage.set(DIAGNOSTICS_KEY, JSON.stringify(load()));
  }, 1000);
}

/** Subscribe a host or endpoint to every (redacted) entry. `null` unsubscribes. */
export function setErrorReporter(fn: ErrorReporter | null): void {
  reporter = fn;
}

export interface RecordInput {
  kind: DiagnosticKind;
  error?: unknown;
  /** Used when there is no Error object (e.g. a save status). */
  name?: string;
  message?: unknown;
  /** A script URL + position, e.g. from an ErrorEvent. */
  source?: { file?: string; line?: number; col?: number };
}

/** Record one event. Never throws. Returns the stored (redacted) entry. */
export function recordDiagnostic(input: RecordInput): DiagnosticEntry | null {
  try {
    const err = input.error as { name?: unknown; message?: unknown; stack?: unknown } | undefined;
    const isObj = !!err && typeof err === "object";
    const entry: DiagnosticEntry = {
      t: new Date().toISOString(),
      kind: input.kind,
      v: VERSION,
      name: String(input.name ?? (isObj && typeof err!.name === "string" ? err!.name : "Error")).slice(0, 60),
      message: redactMessage(input.message ?? (isObj ? err!.message : input.error)),
    };
    const src = input.source;
    if (src?.file) entry.where = `${basename(src.file)}${src.line ? `:${src.line}:${src.col ?? 0}` : ""}`;
    const stack = isObj ? summarizeStack(err!.stack) : undefined;
    if (stack) entry.stack = stack;

    const entries = load();
    const last = entries[entries.length - 1];
    if (last && last.kind === entry.kind && last.name === entry.name && last.message === entry.message && last.where === entry.where) {
      last.count = (last.count ?? 1) + 1;
      last.t = entry.t;
    } else {
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    }
    schedulePersist();
    try {
      reporter?.(entry);
    } catch {
      /* a reporter must never turn one error into two */
    }
    return entry;
  } catch {
    return null;
  }
}

/** Newest last. A copy — callers cannot mutate the ring. */
export function getDiagnostics(): DiagnosticEntry[] {
  return load().map((e) => ({ ...e, stack: e.stack ? [...e.stack] : undefined }));
}

export function clearDiagnostics(): void {
  ring = [];
  safeStorage.remove(DIAGNOSTICS_KEY);
}

/** Test seam: forget the in-memory ring (and any pending write). */
export function _resetDiagnosticsForTests(): void {
  ring = null;
  reporter = null;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
}

// ── Capture ──────────────────────────────────────────────────────────────────

let installed = false;

/**
 * Capture uncaught errors and unhandled rejections into the ring. For pages the
 * app OWNS (the standalone shell, the iframe embed) — never call it from the
 * library entry, where it would record the host page's errors.
 *
 * Bubble phase on purpose: resource load failures (a document's broken image)
 * only reach a CAPTURING listener, and their URLs are user content.
 */
export function installGlobalErrorCapture(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener("error", (ev: ErrorEvent) => {
    recordDiagnostic({
      kind: "error",
      error: ev.error ?? undefined,
      message: ev.error ? undefined : ev.message,
      source: { file: ev.filename, line: ev.lineno, col: ev.colno },
    });
  });
  target.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    const reason = ev.reason as unknown;
    recordDiagnostic({
      kind: "unhandledrejection",
      error: reason instanceof Error ? reason : undefined,
      name: reason instanceof Error ? undefined : "UnhandledRejection",
      message: reason instanceof Error ? undefined : reason,
    });
  });
  // The inline boot watchdog cannot load this module, so it leaves a note.
  const note = safeStorage.get(BOOT_RECOVERY_KEY);
  if (note) {
    safeStorage.remove(BOOT_RECOVERY_KEY);
    let reason: unknown = note;
    try {
      reason = (JSON.parse(note) as { reason?: unknown }).reason ?? note;
    } catch {
      /* a plain string is fine */
    }
    recordDiagnostic({ kind: "boot", name: "BootRecovery", message: reason });
  }
}

/** Test seam for installGlobalErrorCapture's idempotence. */
export function _resetCaptureForTests(): void {
  installed = false;
}

// ── The report ───────────────────────────────────────────────────────────────

/**
 * The text a user pastes into a bug report. `extra` lets a caller add state
 * this module deliberately does not import (save status, service-worker state).
 */
export function buildDiagnosticsReport(extra: Record<string, string> = {}): string {
  const lines = [
    "Markdown Studio diagnostics",
    `App version: ${VERSION}`,
    `Browser: ${uaFamily()}`,
    `Generated: ${new Date().toISOString()}`,
    `Online: ${typeof navigator !== "undefined" && navigator.onLine === false ? "no" : "yes"}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${redactMessage(v)}`),
    "",
  ];
  const entries = getDiagnostics().reverse();
  if (!entries.length) lines.push("No errors recorded.");
  else lines.push(`Recent events (newest first, ${entries.length}):`);
  for (const e of entries) {
    lines.push(`- ${e.t} [${e.kind}] ${e.name}: ${e.message}${e.where ? ` @ ${e.where}` : ""}${e.count && e.count > 1 ? ` (×${e.count})` : ""} (v${e.v})`);
    for (const f of e.stack ?? []) lines.push(`    at ${f}`);
  }
  lines.push("", "This report contains no document content.");
  return lines.join("\n");
}

/** Copy text to the clipboard, falling back to a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or unavailable — try the old way */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
