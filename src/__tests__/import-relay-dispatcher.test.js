// @vitest-environment node
/**
 * The relay's pinned connection works over a REAL socket (A113, undici 8).
 *
 * `import-relay.test.js` stubs `fetch`, so it proves the relay's decisions but
 * never that a request can actually be made. That gap hid a total failure:
 * the relay handed an `Agent` from the `undici` PACKAGE to Node's BUILT-IN
 * `fetch`, which is a different undici — the one bundled with Node (7.x in
 * Node 24). undici 8 removed the legacy handler wrappers, so that pairing
 * throws `invalid onRequestStart method` on every request: each import would
 * have answered 502 "Couldn't fetch that URL." with every unit test green.
 * The relay now takes `fetch` from the same package as its `Agent`.
 *
 * Driven against a local server through `pinnedFetch`, the relay's own
 * fetch-with-pinned-DNS. It does not vet addresses (`assertPublicUrl` does,
 * before it is called), which is what lets a loopback server stand in for a
 * public host here: the request names `pinned.example`, the pinned lookup
 * answers 127.0.0.1, and nothing else may be resolved.
 */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pinnedFetch } from "../../api/import.js";

let server;
let port;
const seen = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, url: req.url });
    res.setHeader("content-type", "text/markdown");
    res.end("# relayed\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const LOOPBACK = [{ address: "127.0.0.1", family: 4 }];

describe("pinnedFetch — the relay's fetch over a pinned connection", () => {
  it("fetches through the pinned address and streams the body", async () => {
    const res = await pinnedFetch(`http://pinned.example:${port}/doc.md`, "pinned.example", LOOPBACK, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown");
    // readCapped reads the body as a web stream.
    expect(typeof res.body?.getReader).toBe("function");
    expect(await res.text()).toBe("# relayed\n");
    expect(seen.at(-1)).toEqual({ host: `pinned.example:${port}`, url: "/doc.md" });
  });

  it("refuses to connect to a host other than the one that was vetted", async () => {
    const before = seen.length;
    await expect(
      pinnedFetch(`http://other.example:${port}/`, "pinned.example", LOOPBACK, { signal: AbortSignal.timeout(10_000) }),
    ).rejects.toThrow();
    expect(seen.length).toBe(before);
  });
});
