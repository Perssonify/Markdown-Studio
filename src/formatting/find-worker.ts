/**
 * Runs a user's Find regex OFF the main thread, with a timeout (A061).
 *
 * A JavaScript regex cannot be interrupted once it starts: `(a+)+$` over 28
 * characters took 5.2s in the audit, the Find panel ran the pattern three or
 * four times per keystroke, and a tab killed for hanging fires no `unload` — so
 * the crash stash that protects unsaved typing was never written. A time or
 * match budget checked BETWEEN `exec` calls cannot stop one catastrophic `exec`.
 * A Worker can simply be terminated.
 *
 * So a REGEX query runs in a Worker built from a Blob of `execAllCore`'s own
 * source (find-engine — the main-thread fallback runs the same code), and is
 * abandoned after FIND_WORKER_TIMEOUT_MS: the worker is terminated and the
 * panel says the pattern is too slow. A new job supersedes one still running
 * (its result would be stale anyway). LITERAL searches never come here: an
 * escaped pattern is linear-time and runs synchronously.
 *
 * Where a Worker cannot be created — a host page whose CSP forbids `blob:`
 * workers, jsdom, a very old engine — the pattern runs on the main thread with
 * a match cap and a time budget, after a static check refuses the classic
 * catastrophic shape (a nested quantifier). That fallback is a heuristic; the
 * Worker is the guarantee.
 */

import { execAllCore, hasNestedQuantifier, type CompiledQuery, type ExecResult } from "./find-engine";

export const FIND_WORKER_TIMEOUT_MS = 1500;
/** Main-thread fallback: stop collecting after this long (checked between execs). */
const SYNC_BUDGET_MS = 250;

export class FindTimeoutError extends Error {
  constructor() {
    super("This pattern is too slow on this document — simplify it (nested repeats like (a+)+ are the usual cause).");
    this.name = "FindTimeoutError";
  }
}
export class FindUnsafePatternError extends Error {
  constructor() {
    super("This pattern can take exponential time (a repeated group that itself repeats, like (a+)+). Simplify it.");
    this.name = "FindUnsafePatternError";
  }
}
/** A job replaced by a newer one before it finished; callers ignore it. */
export class FindSupersededError extends Error {
  constructor() { super("superseded"); this.name = "FindSupersededError"; }
}

export interface FindRunResult {
  /** One result per input text, in order. */
  results: ExecResult[];
  truncated: boolean;
}

interface FindRequest {
  source: string;
  flags: string;
  wordFilter: boolean;
  texts: string[];
  maxMatches: number;
  deadline: number;
}

/**
 * The worker's job: every text, sharing ONE match cap. Self-contained (the
 * matcher is passed in) for the same reason as execAllCore — its source text is
 * what the Worker runs.
 */
export function findRequestCore(req: FindRequest, exec: typeof execAllCore): FindRunResult {
  var results: ExecResult[] = [];
  var left = req.maxMatches;
  var truncated = false;
  for (var i = 0; i < req.texts.length; i++) {
    if (left <= 0) { results.push({ matches: [], truncated: true }); truncated = true; continue; }
    var r = exec(req.source, req.flags, req.texts[i] as string, left, req.deadline, req.wordFilter);
    left -= r.matches.length;
    if (r.truncated) truncated = true;
    results.push(r);
  }
  return { results: results, truncated: truncated };
}

/** The Worker's whole program. */
export function findWorkerSource(): string {
  return (
    '"use strict";\n' +
    "var execAllCore = " + execAllCore.toString() + ";\n" +
    "var findRequestCore = " + findRequestCore.toString() + ";\n" +
    "self.onmessage = function (e) {\n" +
    "  var d = e.data;\n" +
    "  try { self.postMessage({ id: d.id, ok: true, value: findRequestCore(d.req, execAllCore) }); }\n" +
    "  catch (err) { self.postMessage({ id: d.id, ok: false, error: String((err && err.message) || err) }); }\n" +
    "};\n"
  );
}

export interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

let blobUrl: string | null = null;
function defaultFactory(): WorkerLike | null {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  try {
    blobUrl ??= URL.createObjectURL(new Blob([findWorkerSource()], { type: "text/javascript" }));
    return new Worker(blobUrl) as unknown as WorkerLike;
  } catch {
    return null; // e.g. a CSP without blob: workers
  }
}

let factory: () => WorkerLike | null = defaultFactory;
let worker: WorkerLike | null = null;
/** No Worker this session (could not be created, or failed to start). */
let unavailable = false;
let nextId = 0;
let inflight: { id: number; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;

/** Tests: swap the Worker factory (`null` → no Worker at all). */
export function __setFindWorkerFactoryForTests(f: (() => WorkerLike | null) | null): void {
  worker?.terminate();
  worker = null;
  inflight = null;
  unavailable = false;
  factory = f ?? (() => null);
}
export function __resetFindWorkerForTests(): void {
  __setFindWorkerFactoryForTests(defaultFactory);
}

function killWorker(): void {
  worker?.terminate();
  worker = null;
}

function runSync(req: FindRequest, isRegex: boolean): FindRunResult {
  if (isRegex && hasNestedQuantifier(req.source)) throw new FindUnsafePatternError();
  return findRequestCore({ ...req, deadline: Date.now() + SYNC_BUDGET_MS }, execAllCore);
}

/**
 * Find every match of `q` in each of `texts` (sharing `maxMatches`).
 * Literal queries run synchronously; regex queries in the Worker. Rejects with
 * FindTimeoutError / FindUnsafePatternError / FindSupersededError, or the
 * pattern's own error.
 */
export function runFind(
  q: CompiledQuery,
  texts: string[],
  opts: { isRegex: boolean; maxMatches: number; timeoutMs?: number }
): Promise<FindRunResult> {
  const req: FindRequest = { source: q.source, flags: q.flags, wordFilter: q.wordFilter, texts, maxMatches: opts.maxMatches, deadline: 0 };
  if (!opts.isRegex) {
    try { return Promise.resolve(runSync(req, false)); } catch (e) { return Promise.reject(e); }
  }
  // A newer job makes the running one irrelevant — and if the running one is
  // the slow pattern the user is typing their way out of, it must not hold up
  // the next keystroke.
  if (inflight) {
    clearTimeout(inflight.timer);
    inflight.reject(new FindSupersededError());
    inflight = null;
    killWorker();
  }
  if (!worker && !unavailable) {
    worker = factory();
    if (!worker) unavailable = true;
  }
  if (!worker) {
    try { return Promise.resolve(runSync(req, true)); } catch (e) { return Promise.reject(e); }
  }
  const w = worker;
  const id = ++nextId;
  return new Promise<FindRunResult>((resolve, reject) => {
    const settle = () => {
      if (inflight?.id === id) { clearTimeout(inflight.timer); inflight = null; }
    };
    const timer = setTimeout(() => {
      if (inflight?.id !== id) return;
      inflight = null;
      killWorker();
      reject(new FindTimeoutError());
    }, opts.timeoutMs ?? FIND_WORKER_TIMEOUT_MS);
    inflight = { id, reject, timer };
    w.onmessage = (e) => {
      const msg = e.data as { id: number; ok: boolean; value?: FindRunResult; error?: string };
      if (msg.id !== id) return;
      settle();
      if (msg.ok && msg.value) resolve(msg.value);
      else reject(new SyntaxError(msg.error ?? "Invalid pattern"));
    };
    w.onerror = () => {
      // The Worker never started (a CSP that blocks blob: workers reports it
      // here, asynchronously) — stop trying for this session, and answer this
      // job on the main thread instead.
      if (inflight?.id !== id) return;
      settle();
      killWorker();
      unavailable = true;
      try { resolve(runSync(req, true)); } catch (err) { reject(err as Error); }
    };
    w.postMessage({ id, req });
  });
}
