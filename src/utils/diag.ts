/**
 * Markdown Studio — Diagnostic Logger
 *
 * Provides structured, timestamped logging with categories for tracing init
 * flows, state changes, and user interactions when explicitly enabled.
 */

const _start = Date.now();

function ts(): string {
  return `+${Date.now() - _start}ms`;
}

export function isDiagEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  if (env?.["VITE_PERSSONIFY_DIAG"] === "true") return true;
  if (typeof window === "undefined") return false;

  try {
    if (new URLSearchParams(window.location.search).get("diag") === "1") return true;
    return window.localStorage?.getItem("perssonify-diag") === "1";
  } catch {
    return false;
  }
}

function fmt(category: string, action: string, data?: unknown): string {
  const dataStr =
    data !== undefined
      ? typeof data === "object"
        ? " " +
          JSON.stringify(
            data,
            (_k, v) => {
              // Truncate long strings, skip functions, skip circular refs
              if (typeof v === "function") return "[fn]";
              if (typeof v === "string" && v.length > 120)
                return v.slice(0, 120) + "…";
              if (
                v &&
                typeof v === "object" &&
                "type" in v &&
                "content" in v
              )
                return `[TiptapNode:${(v as { type: string }).type}]`;
              return v;
            },
            0
          )
        : " " + String(data)
      : "";
  return `[DIAG ${ts()}] [${category}] ${action}${dataStr}`;
}

export function diag(category: string, action: string, data?: unknown): void {
  if (!isDiagEnabled()) return;
  console.info(fmt(category, action, data));
}

/** Log a lifecycle event: mount, unmount, effect fired, etc. */
export function diagLife(
  component: string,
  event: string,
  data?: unknown
): void {
  diag("LIFE", `${component}.${event}`, data);
}

/** Log a state change */
export function diagState(
  component: string,
  name: string,
  value: unknown
): void {
  const display =
    value && typeof value === "object"
      ? Array.isArray(value)
        ? `[${value.length} items]`
        : Object.keys(value as object).join(",")
      : value;
  diag("STATE", `${component}.${name} =`, display);
}

/** Log a user interaction */
export function diagClick(
  component: string,
  action: string,
  data?: unknown
): void {
  diag("CLICK", `${component}.${action}`, data);
}

/** Log an init step */
export function diagInit(step: string, data?: unknown): void {
  diag("INIT", step, data);
}

/** Log an error with context */
export function diagError(context: string, error: unknown): void {
  const err = error as { message?: string; stack?: string } | null | undefined;
  diag("ERROR", context, {
    message: err?.message,
    stack: err?.stack?.split("\n")[1]?.trim(),
  });
}

/** Check and log a condition */
export function diagCheck<T>(label: string, value: T): T {
  const type =
    value === null
      ? "null"
      : value === undefined
        ? "undefined"
        : typeof value;
  const truthy = !!value;
  diag("CHECK", label, {
    type,
    truthy,
    ...(type === "string" ? { length: (value as string).length } : {}),
  });
  return value;
}

/** Dump current state of key refs/values */
export function diagSnapshot(label: string, obj: Record<string, unknown>): void {
  const snap: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) snap[k] = String(v);
    else if (typeof v === "function") snap[k] = "[fn]";
    else if (
      typeof v === "boolean" ||
      typeof v === "number" ||
      typeof v === "string"
    )
      snap[k] = v;
    else if (v && typeof v === "object" && "current" in v)
      snap[k] = (v as { current: unknown }).current ? "[ref:set]" : "[ref:empty]";
    else if (Array.isArray(v)) snap[k] = `[${v.length} items]`;
    else snap[k] = "[object]";
  }
  diag("SNAP", label, snap);
}
