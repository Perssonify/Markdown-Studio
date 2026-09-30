import { RefObject } from "react";

const PROTOCOL = "perssonify";
const PROTOCOL_VERSION = "1.0";

/** The editor's view modes: markdown only, rich only ("html") or both side by side. */
export type EditorViewMode = "md" | "html" | "split";
/** How much of the editor's chrome is shown. */
export type EditorChromeLevel = "full" | "minimal" | "none";

const VIEW_MODES: ReadonlySet<unknown> = new Set<EditorViewMode>(["md", "html", "split"]);
const CHROME_LEVELS: ReadonlySet<unknown> = new Set<EditorChromeLevel>(["full", "minimal", "none"]);

/**
 * What the bridge drives. The integration's own `EditorHandle` must be
 * assignable to it: `PerssonifyEditorIntegration` passes its handle ref here
 * without a cast, so the type gate holds the two together. `setMode` and
 * `setChrome` used to take `string` here and the literal unions there, so a
 * consumer handing the integration's ref type to `createHostBridge` got TS2345
 * (parameters are contravariant: a handle that accepts three modes is not one
 * that accepts any string). A handle written against this interface with wider
 * parameters still fits.
 *
 * The members are METHODS, and what crosses the wire is `unknown`: the bridge
 * forwards untyped message values and posts back whatever the handle returns.
 * Method parameters compare bivariantly, which is what lets a handle whose
 * `addDocuments` takes a precise document shape still satisfy `unknown[]`.
 */
export interface EditorHandle {
  setDocuments(docs: unknown[]): unknown;
  setFieldSchemas(schemas: unknown): void;
  setTheme(theme: string): void;
  setMode(mode: EditorViewMode): void;
  setAccent(accent: string): void;
  openDocument(docId: string): Promise<void> | void;
  setChrome(level: EditorChromeLevel): void;
  addDocuments(docs: unknown[]): unknown;
  updateDocument(id: string, patch: { title?: string; markdown?: string; canonical?: unknown }): unknown;
  appendToDocument(id: string, markdown: string): unknown;
  importContent(content: string, format: string): unknown;
  setAssociations(associations: unknown): void;
  getCanonicalDocument(): unknown;
  /** The real handle returns `{ md, fidelityReport }`, not a bare string — this
   *  interface used to disagree with the one it mirrors. */
  getMarkdown(): { md: string; fidelityReport?: unknown };
  getHTML(): string;
  getGraph(): unknown;
  getAssociations?(docId?: string): unknown;
  exportAs?(format: string): unknown;
  copyAsPrompt(payload: unknown): unknown;
  getDocuments(): unknown[];
  getActiveDocument(): unknown;
}

export interface HostBridgeOptions {
  allowedOrigins?: string[];
}

export interface HostMessage {
  type: string;
  action?: string;
  event?: string;
  payload?: unknown;
  requestId?: string;
  version?: string;
  timestamp?: number;
  error?: string;
  result?: unknown;
}

export interface HostBridge {
  destroy: () => void;
  emit: (eventName: string, payload: unknown, targetWindow?: Window | null) => void;
}

/** A thrown value's message, as the error reply carries it. `err.message` alone
 *  sent `undefined` for a thrown string, which the client reads as success. */
function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

export function createHostBridge(
  editorRef: RefObject<EditorHandle | null>,
  opts: HostBridgeOptions = {}
): HostBridge {
  // Secure by default: deny all cross-origin messages unless the embedder
  // explicitly passes an allowlist (pass ["*"] to opt into any origin).
  const { allowedOrigins = [] } = opts;

  function isOriginAllowed(origin: string): boolean {
    return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
  }

  function emit(
    eventName: string,
    payload: unknown,
    targetWindow: Window | null = null,
    targetOrigin?: string
  ): void {
    const target = targetWindow || window.parent;
    if (target === window) return;

    // When no explicit target origin is given (proactive emits like "ready" /
    // "onChange"), post only to the configured allowlist — never "*", which
    // would broadcast document content to any framing origin. An empty
    // allowlist means no proactive cross-origin emit at all.
    const origins =
      targetOrigin != null
        ? [targetOrigin]
        : allowedOrigins.includes("*")
          ? ["*"]
          : allowedOrigins;

    const message = {
      type: PROTOCOL,
      version: PROTOCOL_VERSION,
      event: eventName,
      payload,
      timestamp: Date.now(),
    };

    for (const origin of origins) {
      try {
        target.postMessage(message, origin);
      } catch (e) {
        console.warn("[HostBridge] postMessage failed:", e);
      }
    }
  }

  async function handleMessage(event: MessageEvent): Promise<void> {
    if (!isOriginAllowed(event.origin)) return;
    
    const msg = event.data as HostMessage;
    if (!msg || msg.type !== PROTOCOL) return;

    const handle = editorRef.current;
    if (!handle) return;

    const { action, requestId } = msg;

    if (!action) return;

    // The wire is untyped. Fields are handed to the handle as they arrived —
    // it owns their meaning — and only the two enums are checked here. The
    // casts assert nothing at runtime: a message with no payload still throws
    // on its first field read, as it always has, and gets an error reply.
    const payload = msg.payload as Record<string, unknown>;
    const text = (value: unknown) => value as string;

    try {
      let result: unknown;

      switch (action) {
        case "setDocuments":
          result = await handle.setDocuments(payload["documents"] as unknown[]);
          break;
        case "setFieldSchemas":
          handle.setFieldSchemas(payload["schemas"]);
          result = { ok: true };
          break;
        case "setTheme":
          handle.setTheme(text(payload["theme"]));
          result = { ok: true };
          break;
        case "setMode": {
          // A message is untyped: refuse what the handle's type does not
          // accept, instead of storing a mode no pane renders.
          const mode = payload?.["mode"];
          if (!VIEW_MODES.has(mode)) throw new Error(`Unknown view mode: ${String(mode)}`);
          handle.setMode(mode as EditorViewMode);
          result = { ok: true };
          break;
        }
        case "setAccent":
          handle.setAccent(text(payload["accent"]));
          result = { ok: true };
          break;
        case "openDocument":
          // Activation awaits the leave-save and target hydration. Reply only
          // after it settles, and route async failures through the error reply.
          await handle.openDocument(text(payload["docId"] ?? payload["id"]));
          result = { ok: true };
          break;
        case "setChrome": {
          const level = payload?.["chrome"] ?? payload?.["level"];
          if (!CHROME_LEVELS.has(level)) throw new Error(`Unknown chrome level: ${String(level)}`);
          handle.setChrome(level as EditorChromeLevel);
          result = { ok: true };
          break;
        }
        case "addDocuments":
          result = await handle.addDocuments(payload["docs"] as unknown[]);
          break;
        case "updateDocument":
          result = await handle.updateDocument(text(payload["id"] ?? payload["docId"]), {
            title: payload["title"] as string | undefined,
            markdown: payload["markdown"] as string | undefined,
            canonical: payload["canonical"],
          });
          break;
        case "appendToDocument":
          result = await handle.appendToDocument(text(payload["id"] ?? payload["docId"]), text(payload["markdown"]));
          break;
        case "importContent":
          result = await handle.importContent(text(payload["content"]), text(payload["format"]));
          break;
        case "setAssociations":
          handle.setAssociations(payload["associations"]);
          result = { ok: true };
          break;
        case "getCanonicalDocument":
          result = handle.getCanonicalDocument();
          break;
        case "getMarkdown":
          result = handle.getMarkdown();
          break;
        case "getHTML":
          result = handle.getHTML();
          break;
        case "getGraph":
          result = handle.getGraph();
          break;
        case "copyAsPrompt":
          result = await handle.copyAsPrompt(msg.payload);
          break;
        case "getDocuments":
          result = handle.getDocuments();
          break;
        case "getActiveDocument":
          result = handle.getActiveDocument();
          break;
        case "getAssociations":
          result = handle.getAssociations?.(payload?.["docId"] as string | undefined);
          break;
        case "exportAs":
          result = await handle.exportAs?.(text(payload?.["format"]));
          break;
        default:
          // REJECT rather than resolve. `createEditorClient` only rejects on a
          // top-level `error`, so returning `{ result: { error } }` resolved the
          // host's promise as a success carrying an error object — an iframe
          // host's "Export as Word" button silently did nothing while the same
          // editor mounted as a React component exported fine.
          if (requestId) {
            emit("response", { requestId, error: `Unknown action: ${action}` }, event.source as Window, event.origin);
          }
          return;
      }

      if (requestId) {
        emit("response", { requestId, result }, event.source as Window, event.origin);
      }
    } catch (err) {
      if (requestId) {
        emit("response", { requestId, error: errorMessage(err) }, event.source as Window, event.origin);
      }
    }
  }

  window.addEventListener("message", handleMessage);

  emit("ready", { version: PROTOCOL_VERSION });

  return {
    destroy() {
      window.removeEventListener("message", handleMessage);
    },
    emit,
  };
}

export interface EditorClient {
  // The two `any`s are the published contract, kept on purpose: a host reads a
  // reply or an event payload without naming its type. `unknown` there would
  // stop every such host compiling.
  call: <T = any>(action: string, payload?: unknown) => Promise<T>;
  on: (event: string, fn: (payload: any) => void) => () => void;
  send: (action: string, payload?: unknown) => void;
  destroy: () => void;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason?: unknown): void;
}

/** What a "response" event carries. */
interface ResponsePayload {
  requestId?: string;
  error?: string;
  result?: unknown;
}

/**
 * Resolve the origin this client will talk to.
 *
 * The default used to be `"*"`, which meant the host posted document-driving
 * commands to any origin AND accepted responses from any origin — while its
 * counterpart `createHostBridge` was deny-by-default. It also disagreed with the
 * integration guide, which tells readers to pass `{ allowedOrigins }`: an object
 * landed in this positional slot, `postMessage(msg, {...})` threw, and
 * `event.origin !== editorOrigin` was always true, so a reader who followed the
 * docs got a dead client and one who did not got a wildcard.
 *
 * There is no need to configure it at all: the client is handed the iframe, so
 * the editor's origin is `iframe.src`. An explicit value still wins, and the
 * documented object shape is accepted.
 */
function resolveEditorOrigin(
  iframe: HTMLIFrameElement,
  opts?: string | { editorOrigin?: string; allowedOrigins?: string[] }
): string {
  const explicit =
    typeof opts === "string"
      ? opts
      : opts?.editorOrigin ?? opts?.allowedOrigins?.[0];
  if (explicit) return explicit;
  try {
    const src = iframe.getAttribute("src");
    if (src) return new URL(src, window.location.href).origin;
  } catch { /* unparseable src — fall through */ }
  console.warn(
    "[EditorClient] Could not determine the editor's origin from the iframe's src. " +
      "Pass it explicitly: createEditorClient(iframe, \"https://editor.example\")."
  );
  return "*";
}

export function createEditorClient(
  iframe: HTMLIFrameElement,
  opts?: string | { editorOrigin?: string; allowedOrigins?: string[] }
): EditorClient {
  const editorOrigin = resolveEditorOrigin(iframe, opts);
  const listeners: Record<string, Array<(payload: unknown) => void>> = {};
  let requestCounter = 0;
  const pendingRequests = new Map<string, PendingRequest>();

  function handleMessage(event: MessageEvent): void {
    // An origin identifies the publisher, not this editor instance. Sibling
    // iframes can share it (and even request ids); their events/replies must
    // never resolve this client's calls or reach its content listeners.
    const source = iframe.contentWindow;
    if (!source || event.source !== source) return;
    if (editorOrigin !== "*" && event.origin !== editorOrigin) return;
    
    const msg = event.data as HostMessage;
    if (!msg || msg.type !== PROTOCOL) return;

    const reply = msg.payload as ResponsePayload | undefined;
    if (msg.event === "response" && reply?.requestId) {
      const resolve = pendingRequests.get(reply.requestId);
      if (resolve) {
        pendingRequests.delete(reply.requestId);
        if (reply.error) {
          resolve.reject(new Error(reply.error));
        } else {
          resolve.resolve(reply.result);
        }
      }
      return;
    }

    if (msg.event) {
      const eventListeners = listeners[msg.event];
      if (eventListeners) {
        for (const fn of eventListeners) {
          try {
            fn(msg.payload);
          } catch (e) {
            console.error("[EditorClient] Listener error:", e);
          }
        }
      }
    }
  }

  window.addEventListener("message", handleMessage);

  return {
    call<T>(action: string, payload: unknown = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const requestId = `req-${++requestCounter}-${Date.now()}`;
        pendingRequests.set(requestId, { resolve, reject });

        const contentWindow = iframe.contentWindow;
        if (!contentWindow) {
          reject(new Error("iframe has no contentWindow"));
          return;
        }

        contentWindow.postMessage(
          {
            type: PROTOCOL,
            action,
            payload,
            requestId,
          },
          editorOrigin
        );

        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            reject(new Error(`Request ${action} timed out`));
          }
        }, 10000);
      });
    },

    on(event: string, fn: (payload: unknown) => void): () => void {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event]!.push(fn);
      
      return () => {
        const currentListeners = listeners[event];
        if (currentListeners) {
          listeners[event] = currentListeners.filter((f) => f !== fn);
        }
      };
    },

    send(action: string, payload: unknown = {}): void {
      const contentWindow = iframe.contentWindow;
      if (contentWindow) {
        contentWindow.postMessage(
          { type: PROTOCOL, action, payload },
          editorOrigin
        );
      }
    },

    destroy(): void {
      window.removeEventListener("message", handleMessage);
      pendingRequests.clear();
    },
  };
}