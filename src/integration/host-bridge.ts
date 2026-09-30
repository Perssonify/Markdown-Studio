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
 */
export interface EditorHandle {
  setDocuments: (docs: any[]) => Promise<any> | any;
  setFieldSchemas: (schemas: any) => void;
  setTheme: (theme: string) => void;
  setMode: (mode: EditorViewMode) => void;
  setAccent: (accent: string) => void;
  openDocument: (docId: string) => Promise<void> | void;
  setChrome: (level: EditorChromeLevel) => void;
  addDocuments: (docs: any[]) => Promise<any> | any;
  updateDocument: (id: string, patch: any) => Promise<any> | any;
  appendToDocument: (id: string, markdown: string) => Promise<any> | any;
  importContent: (content: string, format: string) => Promise<any> | any;
  setAssociations: (associations: any) => void;
  getCanonicalDocument: () => any;
  /** The real handle returns `{ md, fidelityReport }`, not a bare string — this
   *  interface used to disagree with the one it mirrors. */
  getMarkdown: () => { md: string; fidelityReport?: any };
  getHTML: () => string;
  getGraph: () => any;
  getAssociations?: (docId?: string) => any;
  exportAs?: (format: string) => Promise<any> | any;
  copyAsPrompt: (payload: any) => Promise<any> | any;
  getDocuments: () => any[];
  getActiveDocument: () => any;
}

export interface HostBridgeOptions {
  allowedOrigins?: string[];
}

export interface HostMessage {
  type: string;
  action?: string;
  event?: string;
  payload?: any;
  requestId?: string;
  version?: string;
  timestamp?: number;
  error?: string;
  result?: any;
}

export interface HostBridge {
  destroy: () => void;
  emit: (eventName: string, payload: any, targetWindow?: Window | null) => void;
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
    payload: any,
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

    const { action, payload, requestId } = msg;

    if (!action) return;

    try {
      let result: any;

      switch (action) {
        case "setDocuments":
          result = await handle.setDocuments(payload.documents);
          break;
        case "setFieldSchemas":
          handle.setFieldSchemas(payload.schemas);
          result = { ok: true };
          break;
        case "setTheme":
          handle.setTheme(payload.theme);
          result = { ok: true };
          break;
        case "setMode":
          // A message is untyped: refuse what the handle's type does not
          // accept, instead of storing a mode no pane renders.
          if (!VIEW_MODES.has(payload?.mode)) throw new Error(`Unknown view mode: ${String(payload?.mode)}`);
          handle.setMode(payload.mode);
          result = { ok: true };
          break;
        case "setAccent":
          handle.setAccent(payload.accent);
          result = { ok: true };
          break;
        case "openDocument":
          // Activation awaits the leave-save and target hydration. Reply only
          // after it settles, and route async failures through the error reply.
          await handle.openDocument(payload.docId ?? payload.id);
          result = { ok: true };
          break;
        case "setChrome": {
          const level = payload?.chrome ?? payload?.level;
          if (!CHROME_LEVELS.has(level)) throw new Error(`Unknown chrome level: ${String(level)}`);
          handle.setChrome(level);
          result = { ok: true };
          break;
        }
        case "addDocuments":
          result = await handle.addDocuments(payload.docs);
          break;
        case "updateDocument":
          result = await handle.updateDocument(payload.id ?? payload.docId, {
            title: payload.title,
            markdown: payload.markdown,
            canonical: payload.canonical,
          });
          break;
        case "appendToDocument":
          result = await handle.appendToDocument(payload.id ?? payload.docId, payload.markdown);
          break;
        case "importContent":
          result = await handle.importContent(payload.content, payload.format);
          break;
        case "setAssociations":
          handle.setAssociations(payload.associations);
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
          result = await handle.copyAsPrompt(payload);
          break;
        case "getDocuments":
          result = handle.getDocuments();
          break;
        case "getActiveDocument":
          result = handle.getActiveDocument();
          break;
        case "getAssociations":
          result = handle.getAssociations?.(payload?.docId);
          break;
        case "exportAs":
          result = await handle.exportAs?.(payload?.format);
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
    } catch (err: any) {
      if (requestId) {
        emit("response", { requestId, error: err.message }, event.source as Window, event.origin);
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
  call: <T = any>(action: string, payload?: any) => Promise<T>;
  on: (event: string, fn: (payload: any) => void) => () => void;
  send: (action: string, payload?: any) => void;
  destroy: () => void;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
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
  const listeners: Record<string, Array<(payload: any) => void>> = {};
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

    if (msg.event === "response" && msg.payload?.requestId) {
      const resolve = pendingRequests.get(msg.payload.requestId);
      if (resolve) {
        pendingRequests.delete(msg.payload.requestId);
        if (msg.payload.error) {
          resolve.reject(new Error(msg.payload.error));
        } else {
          resolve.resolve(msg.payload.result);
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
    call<T = any>(action: string, payload: any = {}): Promise<T> {
      return new Promise((resolve, reject) => {
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

    on(event: string, fn: (payload: any) => void): () => void {
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

    send(action: string, payload: any = {}): void {
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