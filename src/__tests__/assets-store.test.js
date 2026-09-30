import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSETS_DB_NAME, assetStore, sha256Hex } from "../store/asset-store";
import { assetRef } from "../store/asset-refs";
import { configureLocalStores, clearLocalData, useDocumentStore } from "../store/documentStore";

/**
 * The asset store (A086) against a REAL database (fake-indexeddb: real
 * transactions, real auto-commit). Each case gets a database of its own, so no
 * case can pass on another's leftovers.
 */

let n = 0;
const fresh = () => assetStore._resetForTests({ useIndexedDB: true, dbName: `assets-test-${++n}` });

/** A tiny but genuine PNG header + some bytes, unique per `seed`. */
function png(seed = 1, size = 64) {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 20]);
  for (let i = 24; i < size; i++) b[i] = (seed * 31 + i) & 0xff;
  return b;
}

beforeEach(fresh);

describe("asset store: storing and reading", () => {
  it("stores bytes content-addressed by their SHA-256 and reads them back", async () => {
    const bytes = png(1);
    const hash = await assetStore.put(bytes, "image/png");
    expect(hash).toBe(await sha256Hex(bytes));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const got = await assetStore.get(hash);
    expect(got.mime).toBe("image/png");
    expect([...got.bytes]).toEqual([...bytes]);
  });

  it("stores the same picture once, however often it is put", async () => {
    const a = await assetStore.put(png(2), "image/png");
    const b = await assetStore.put(png(2).slice(), "image/png");
    expect(a).toBe(b);
    expect((await assetStore.stats()).count).toBe(1);
  });

  it("stores exactly the bytes of a view, not its whole buffer", async () => {
    const big = new Uint8Array(200);
    big.set(png(3), 50);
    const view = big.subarray(50, 114);
    const hash = await assetStore.put(view, "image/png");
    const got = await assetStore.get(hash);
    expect(got.bytes.byteLength).toBe(64);
    expect((await assetStore.list())[0].size).toBe(64);
  });

  it("refuses what is not a raster image, and empty input — the caller keeps it inline", async () => {
    expect(await assetStore.put(new TextEncoder().encode("<svg onload=alert(1)>"), "image/svg+xml")).toBeNull();
    expect(await assetStore.put(new TextEncoder().encode("<b>x</b>"), "text/html")).toBeNull();
    expect(await assetStore.put(new Uint8Array(0), "image/png")).toBeNull();
    expect((await assetStore.stats()).count).toBe(0);
  });

  it("a write that does not COMMIT hands out no hash — so no reference is ever written for it", async () => {
    const realPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (...args) {
      if (this.name === "bytes") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return realPut.apply(this, args);
    });
    try {
      expect(await assetStore.put(png(20), "image/png")).toBeNull();
    } finally {
      spy.mockRestore();
    }
    expect((await assetStore.stats()).count).toBe(0);
  });

  it("putDataUrl decodes a data: URL", async () => {
    const bytes = png(4);
    let bin = "";
    for (const x of bytes) bin += String.fromCharCode(x);
    const hash = await assetStore.putDataUrl(`data:image/png;base64,${btoa(bin)}`);
    expect(hash).toBe(await sha256Hex(bytes));
  });

  it("hasMany answers in one pass which hashes exist", async () => {
    const a = await assetStore.put(png(5), "image/png");
    const missing = "f".repeat(64);
    expect([...(await assetStore.hasMany([a, missing]))]).toEqual([a]);
  });

  it("dataUrl returns a self-contained data: URL for an asset, null for none", async () => {
    const hash = await assetStore.put(png(6), "image/png");
    expect(await assetStore.dataUrl(hash)).toMatch(/^data:image\/png;base64,/);
    expect(await assetStore.dataUrl("0".repeat(64))).toBeNull();
  });
});

describe("asset store: availability and the inline fallback", () => {
  it("is unavailable, and stores nothing, without IndexedDB (the default test reset)", async () => {
    assetStore._resetForTests();
    expect(await assetStore.available()).toBe(false);
    expect(await assetStore.put(png(7), "image/png")).toBeNull();
  });

  it("is unavailable when a host turns it off", async () => {
    assetStore.configure({ enabled: false });
    expect(await assetStore.available()).toBe(false);
    expect(await assetStore.put(png(8), "image/png")).toBeNull();
  });

  it("is unavailable without WebCrypto (an insecure context)", async () => {
    const subtle = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
    try {
      fresh();
      expect(await assetStore.available()).toBe(false);
      expect(await assetStore.put(png(9), "image/png")).toBeNull();
    } finally {
      Object.defineProperty(globalThis.crypto, "subtle", { value: subtle, configurable: true });
    }
  });
});

describe("asset store: namespacing (configureLocalStores)", () => {
  afterEach(() => assetStore._resetForTests());

  it("keeps each namespace's images in its own database", async () => {
    assetStore.configure({ dbName: `ns-a-${n}` });
    const hash = await assetStore.put(png(10), "image/png");
    assetStore.configure({ dbName: `ns-b-${n}` });
    expect(await assetStore.get(hash)).toBeNull();
    assetStore.configure({ dbName: `ns-a-${n}` });
    expect(await assetStore.get(hash)).not.toBeNull();
  });

  it("maps storageConfig like version history: default name, host namespace, off switch", () => {
    configureLocalStores();
    expect(assetStore.databaseName()).toBe(ASSETS_DB_NAME);
    expect(assetStore.isEnabled()).toBe(true);

    configureLocalStores({ dbName: "tenant-a" });
    expect(assetStore.databaseName()).toBe("perssonify-assets:tenant-a");

    configureLocalStores({ namespace: "user-7" });
    expect(assetStore.databaseName()).toBe("perssonify-assets:user-7");

    configureLocalStores({ assets: false });
    expect(assetStore.isEnabled()).toBe(false);
  });

  it("is OFF for a host's own adapter unless its config opts in", () => {
    configureLocalStores({ dbName: "server-backed" }, { customAdapter: true });
    expect(assetStore.isEnabled()).toBe(false);
    configureLocalStores({ dbName: "server-backed", assets: true }, { customAdapter: true });
    expect(assetStore.isEnabled()).toBe(true);
  });

  it("a host adapter injected without any config keeps images inline", () => {
    assetStore.configure({ enabled: true });
    const adapter = {
      list: async () => [], get: async () => null, save: async () => {}, delete: async () => {},
      getPrefs: async () => ({}), setPrefs: async () => {},
    };
    useDocumentStore.getState().initStorage(adapter);
    expect(assetStore.isEnabled()).toBe(false);
  });
});

describe("asset store: display URLs", () => {
  beforeEach(() => {
    let i = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${++i}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("shares one object URL per asset and revokes it after the last release", async () => {
    const hash = await assetStore.put(png(11), "image/png");
    const a = await assetStore.acquireUrl(hash);
    const b = await assetStore.acquireUrl(hash);
    expect(a).toMatch(/^blob:/);
    expect(b).toBe(a);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    assetStore.releaseUrl(hash);
    vi.advanceTimersByTime(5000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // one holder left
    assetStore.releaseUrl(hash);
    vi.advanceTimersByTime(5000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(a);
    expect(assetStore.liveUrlCount()).toBe(0);
  });

  it("a re-acquire inside the grace period keeps the URL alive (a node view re-created)", async () => {
    const hash = await assetStore.put(png(12), "image/png");
    const a = await assetStore.acquireUrl(hash);
    vi.useFakeTimers();
    assetStore.releaseUrl(hash);
    const again = await assetStore.acquireUrl(hash);
    vi.advanceTimersByTime(5000);
    expect(again).toBe(a);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    assetStore.releaseUrl(hash);
  });

  it("resolves a missing asset to null, and to the asset once it is stored", async () => {
    const bytes = png(13);
    const hash = await sha256Hex(bytes);
    expect(await assetStore.acquireUrl(hash)).toBeNull();
    assetStore.releaseUrl(hash);
    const changed = vi.fn();
    assetStore.subscribe(changed);
    await assetStore.put(bytes, "image/png");
    expect(changed).toHaveBeenCalled();
    expect(await assetStore.acquireUrl(hash)).toMatch(/^blob:/);
    assetStore.releaseUrl(hash);
  });
});

describe("asset store: deleting", () => {
  it("deleteUnused deletes only what has not been used since the cutoff — re-checked in the deleting transaction", async () => {
    const old = await assetStore.put(png(14), "image/png");
    const now = Date.now();
    // Nothing is older than a cutoff in the past.
    let r = await assetStore.deleteUnused([old], now - 60_000);
    expect(r.deleted).toEqual([]);
    // A cutoff in the future makes it eligible…
    r = await assetStore.deleteUnused([old], now + 60_000);
    expect(r.deleted).toEqual([old]);
    expect(await assetStore.get(old)).toBeNull();
  });

  it("putting an existing image refreshes its last-used stamp, so a collection racing it keeps it", async () => {
    const t0 = 1_000_000_000_000;
    const spy = vi.spyOn(Date, "now").mockReturnValue(t0);
    const hash = await assetStore.put(png(15), "image/png");
    spy.mockReturnValue(t0 + 10 * 86_400_000); // ten days later: re-pasted
    await assetStore.put(png(15), "image/png");
    spy.mockRestore();
    const meta = (await assetStore.list()).find((a) => a.hash === hash);
    expect(meta.touched).toBe(t0 + 10 * 86_400_000);
    // A collector that decided "unused since day 5" must now leave it alone.
    const r = await assetStore.deleteUnused([hash], t0 + 5 * 86_400_000);
    expect(r.deleted).toEqual([]);
  });

  it("clearAll erases every asset", async () => {
    await assetStore.put(png(16), "image/png");
    await assetStore.put(png(17), "image/png");
    await assetStore.clearAll();
    expect((await assetStore.stats()).count).toBe(0);
  });

  it("clearLocalData (Erase all local data) erases the asset store too", async () => {
    const hash = await assetStore.put(png(18), "image/png");
    await clearLocalData();
    expect(await assetStore.get(hash)).toBeNull();
    expect((await assetStore.stats()).count).toBe(0);
  });

  it("references are built for the stored hash", async () => {
    const hash = await assetStore.put(png(19), "image/png");
    expect(assetRef(hash)).toBe(`pf-asset:${hash}`);
  });
});
