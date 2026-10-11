/**
 * Run a Vercel-style Node handler — `(req, res)` with Vercel's `req.query`,
 * `res.status()`, `res.json()` and `res.send()` helpers — against a web
 * `Request`, and return its answer as a web `Response`.
 *
 * It exists for ONE handler: the import relay, apps/web/api/import.js. That
 * file is the relay's single source — Vercel still serves it while the site
 * moves to AWS — so the API runs it as-is instead of keeping a second copy of
 * security-critical code. Only the helpers that handler uses are provided.
 */

export interface VercelLikeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string | string[]>;
}

export interface VercelLikeResponse {
  setHeader(name: string, value: string | number): VercelLikeResponse;
  status(code: number): VercelLikeResponse;
  json(body: unknown): VercelLikeResponse;
  send(body: Buffer | Uint8Array | string): VercelLikeResponse;
  end(): VercelLikeResponse;
}

export type VercelLikeHandler = (req: VercelLikeRequest, res: VercelLikeResponse) => unknown;

export async function runVercelHandler(handler: VercelLikeHandler, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value; // Headers already lower-cases names, as Node does
  });
  const query: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams) {
    const prev = query[k];
    query[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }

  let status = 200;
  const out = new Headers();
  let body: string | Uint8Array<ArrayBuffer> | null = null;
  const res: VercelLikeResponse = {
    setHeader(name, value) {
      out.set(name, String(value));
      return res;
    },
    status(code) {
      status = code;
      return res;
    },
    json(value) {
      if (!out.has("content-type")) out.set("content-type", "application/json; charset=utf-8");
      body = JSON.stringify(value);
      return res;
    },
    send(value) {
      if (typeof value === "string") {
        if (!out.has("content-type")) out.set("content-type", "text/html; charset=utf-8");
        body = value;
      } else {
        if (!out.has("content-type")) out.set("content-type", "application/octet-stream");
        body = new Uint8Array(value);
      }
      return res;
    },
    end() {
      return res;
    },
  };

  await handler({ method: request.method, url: url.pathname + url.search, headers, query }, res);
  // A 204/304 carries no body (Response throws if given one).
  const empty = status === 204 || status === 304 || request.method === "HEAD";
  return new Response(empty ? null : body, { status, headers: out });
}
