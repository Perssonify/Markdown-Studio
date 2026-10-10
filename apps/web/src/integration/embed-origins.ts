import { APP_HOSTS } from "../constants";
import type { IDBStorageConfig } from "../store/persistence/idb-storage-adapter";

/**
 * Which host origin(s) the iframe embed's bridge will talk to — pure, so the
 * rules can be tested without an iframe.
 *
 * The bridge can read and overwrite every document the embed can see, so the
 * answer decides who may drive it. It used to be "whatever `?allowed_origin=`
 * says, else `document.referrer`'s origin": both chosen by whoever frames the
 * embed, so ANY framing page got the bridge. Now:
 *
 *  1. A DEPLOY-TIME allowlist (`VITE_EMBED_ALLOWED_ORIGINS`, comma-separated,
 *     baked in at build) is the real control. When it is set, nothing outside
 *     it is ever allowed, whatever the URL or the referrer says. Set it for any
 *     deployment that serves the embed from an origin holding user documents.
 *  2. Where the browser reports the actual framer (`location.ancestorOrigins`,
 *     Chromium and WebKit), a requested origin must BE that framer. An
 *     `?allowed_origin=` naming some other window is dropped, and a page that is
 *     not framed at all gets no bridge partner.
 *  3. Requested origins, in order: `?allowed_origin=` (repeatable or
 *     comma-separated; a literal `*` is rejected — a wildcard would let whoever
 *     frames the embed relay documents onward), else the reported framer
 *     (ancestorOrigins[0]), else `document.referrer`'s origin.
 *  4. Nothing left → `[]`: deny all, the safe failure.
 */

/** A string is an origin when parsing it round-trips to exactly itself. */
function asOrigin(value: string): string | null {
  const v = value.trim();
  if (!v || v === "*" || v === "null") return null;
  try {
    return new URL(v).origin === v ? v : null;
  } catch {
    return null;
  }
}

function list(values: Iterable<string>): string[] {
  const out: string[] = [];
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const o = asOrigin(part);
      if (o && !out.includes(o)) out.push(o);
    }
  }
  return out;
}

export interface EmbedOriginInputs {
  /** The iframe's own query string. */
  params: URLSearchParams;
  /** `document.referrer` ("" when suppressed). */
  referrer: string;
  /**
   * `location.ancestorOrigins`: undefined where the browser does not provide it
   * (Firefox), EMPTY when the page is not framed. Index 0 is the direct parent.
   */
  ancestorOrigins?: ArrayLike<string> | null;
  /** `import.meta.env.VITE_EMBED_ALLOWED_ORIGINS`, raw. */
  deployAllowlist?: string | null;
}

export function resolveEmbedAllowedOrigins({ params, referrer, ancestorOrigins, deployAllowlist }: EmbedOriginInputs): string[] {
  const knowsFramer = ancestorOrigins != null;
  const framer = knowsFramer && ancestorOrigins!.length > 0 ? asOrigin(String(ancestorOrigins![0])) : null;
  // Rule 2: the browser says we are not framed — there is no host to talk to.
  if (knowsFramer && !framer) return [];

  const explicit = list(params.getAll("allowed_origin"));
  let requested: string[];
  if (explicit.length) {
    requested = explicit;
  } else if (framer) {
    requested = [framer];
  } else {
    let fromReferrer: string | null = null;
    try {
      fromReferrer = referrer ? asOrigin(new URL(referrer).origin) : null;
    } catch {
      /* opaque or malformed referrer */
    }
    requested = fromReferrer ? [fromReferrer] : [];
  }

  // Rule 2: a requested origin must be the window that actually framed us.
  if (framer) requested = requested.filter((o) => o === framer);

  // Rule 1: the deployment's allowlist has the last word.
  const allow = deployAllowlist ? list([deployAllowlist]) : [];
  if (deployAllowlist && deployAllowlist.trim()) requested = requested.filter((o) => allow.includes(o));

  return requested;
}

/** The embed's database on the app's own hosts. Never rename: on-disk contract. */
export const EMBED_APP_HOST_DB = "perssonify-embed-docs";

/**
 * Where the iframe embed keeps its documents, for the host it is served from
 * (A072).
 *
 * On one of the APP's own hosts (APP_HOSTS) it gets a database of its own. The
 * app's library lives in `perssonify-docs` there, and anything that shares that
 * database with the embed is reachable by whichever page frames the embed —
 * the bridge can read and overwrite every document the embed sees. Version
 * history and the crash stash follow the name (`configureLocalStores`), so
 * they stay apart too.
 *
 * Anywhere else — a self-hosted embed — it returns undefined: the default
 * `perssonify-docs`, the name every existing embed user's documents are in.
 * Renaming it there would open those embeds on an empty library.
 */
export function embedStorageConfig(hostname: string): IDBStorageConfig | undefined {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, "");
  return APP_HOSTS.includes(host) ? { dbName: EMBED_APP_HOST_DB } : undefined;
}
