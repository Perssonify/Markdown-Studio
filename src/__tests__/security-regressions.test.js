import { gzipSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sanitizePastedHtml } from '../engine/html-cleaner.ts';
import { createHostBridge } from '../integration/host-bridge.ts';
import { extractArchive } from '../store/archive.ts';
import { sanitizeForIngest } from '../store/ingest.ts';
import { deserializeFromStorage, serializeForStorage, createDocument } from '../store/document.ts';
import { ingest } from '../store/ingest.ts';
import { StorageQuotaError } from '../store/idb-storage-adapter.ts';
import { useDocumentStore } from '../store/documentStore.ts';

function fileFromBytes(bytes, name) {
  return new File([bytes], name);
}

function dangerousImageDoc() {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'x' } }],
      },
    ],
  };
}

function containsDangerousSrc(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.attrs?.src && String(node.attrs.src).toLowerCase().includes('javascript:')) return true;
  return Array.isArray(node.content) && node.content.some(containsDangerousSrc);
}

describe('security regression hardening', () => {
  it('removes unquoted and obfuscated dangerous image src values from pasted HTML', () => {
    const out = sanitizePastedHtml('<p>x<img src=javascript:alert(1)><img src="java\nscript:alert(2)"><img src="data:text/html;base64,PHNjcmlwdD4="></p>');

    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/java\s*script:/i);
    expect(out).not.toMatch(/data:text\/html/i);
  });

  it('sanitizes dangerous image src values from PM JSON import envelopes', () => {
    const raw = JSON.stringify({ _format: 'perssonify-document', id: 'doc-1', title: 'Unsafe', canonical: dangerousImageDoc() });
    const result = ingest(raw, 'pmjson', 'file-import', { mdToHtml: (md) => md });

    expect(result.doc.title).toBe('Unsafe');
    expect(containsDangerousSrc(result.doc.canonical)).toBe(false);
  });

  it('sanitizes dangerous image src values when restoring stored documents', () => {
    const stored = serializeForStorage(createDocument({ title: 'Stored', canonical: dangerousImageDoc() }));
    const restored = deserializeFromStorage(stored);

    expect(restored).toBeTruthy();
    expect(containsDangerousSrc(restored.canonical)).toBe(false);
  });

  it('responds to allowed host messages using the original event origin', async () => {
    const source = { postMessage: vi.fn() };
    const editorRef = {
      current: {
        getMarkdown: () => '# safe',
      },
    };
    const bridge = createHostBridge(editorRef, { allowedOrigins: ['https://host.example'] });

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://host.example',
      source,
      data: { type: 'perssonify', action: 'getMarkdown', requestId: 'req-1' },
    }));
    await Promise.resolve();
    await Promise.resolve();

    const response = source.postMessage.mock.calls.find(([message]) => message?.event === 'response');
    expect(response?.[1]).toBe('https://host.example');
    bridge.destroy();
  });

  it('rejects archives that expand beyond configured entry size limits', async () => {
    const zip = zipSync({ 'huge.md': strToU8('a'.repeat(120)) });

    await expect(
      extractArchive(fileFromBytes(zip, 'huge.zip'), { maxEntryBytes: 100 })
    ).rejects.toThrow(/archive entry too large/i);
  });

  it('rejects gzip archives that expand beyond configured total size limits', async () => {
    const gz = gzipSync(strToU8('a'.repeat(120)));

    await expect(
      extractArchive(fileFromBytes(gz, 'huge.md.gz'), { maxTotalBytes: 100 })
    ).rejects.toThrow(/archive too large/i);
  });
});

describe('document store quota errors', () => {
  beforeEach(() => {
    useDocumentStore.setState({
      documents: [],
      activeDoc: null,
      activeDocId: null,
      openTabs: [],
      saveStatus: 'ready',
      fidelityReport: null,
      counts: { words: 0, chars: 0 },
      storageMetrics: null,
      _engine: { mdToHtml: (md) => `<p>${md}</p>` },
      _syncMode: 'clean',
      _unsavedEdits: new Map(),
    });
  });

  it('rethrows StorageQuotaError so editor-level callbacks can fire', async () => {
    const doc = createDocument({ title: 'Quota' });
    const quota = new StorageQuotaError('quota exceeded');
    const adapter = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      save: vi.fn(async () => { throw quota; }),
      delete: vi.fn(async () => {}),
      getPrefs: vi.fn(async () => ({})),
      setPrefs: vi.fn(async () => {}),
    };

    useDocumentStore.getState().initStorage(adapter);
    // hydratedDocId must match activeDocId or the save is refused up-front.
    useDocumentStore.setState({ activeDoc: doc, activeDocId: doc.id, hydratedDocId: doc.id });

    await expect(
      useDocumentStore.getState().saveActiveDoc({ getJSON: () => doc.canonical })
    ).rejects.toBe(quota);
    // A086: a full store parks the TERMINAL "full" status. It used to be the
    // transient "error", which re-armed autosave every few seconds forever
    // ("Save failed — retrying") with nothing telling the user what would help.
    expect(useDocumentStore.getState().saveStatus).toBe('full');
  });
});

/**
 * The ingest sanitizer's attribute filter.
 *
 * It checked dangerous schemes on `href` / `src` / `xlink:href` only — not
 * `srcset` (which is deliberately allowed for `<picture>` theme images), not
 * `poster` or `background`, and not `style` at all. That output is injected
 * into a live document by the Cards preview (`dangerouslySetInnerHTML`), so a
 * pasted note could make a private, offline-capable editor announce itself to a
 * third party, or lay down `position: fixed` over the page.
 */
describe("sanitizeForIngest — URL-bearing attributes and inline style", () => {
  const attrOf = (html, sel, attr) => {
    const d = new DOMParser().parseFromString(sanitizeForIngest(html), "text/html");
    return d.querySelector(sel)?.getAttribute(attr) ?? null;
  };

  it("strips a javascript: URL from srcset, poster and background", () => {
    expect(attrOf('<img srcset="javascript:alert(1) 1x">', "img", "srcset")).toBeNull();
    expect(attrOf('<video poster="javascript:alert(1)"></video>', "video", "poster")).toBeNull();
    expect(attrOf('<table background="javascript:alert(1)"></table>', "table", "background")).toBeNull();
  });

  it("checks EVERY candidate in a srcset, not just the first", () => {
    expect(attrOf('<img srcset="/a.png 1x, javascript:alert(1) 2x">', "img", "srcset")).toBeNull();
    expect(attrOf('<img srcset="/a.png 1x, /b.png 2x">', "img", "srcset")).toBe("/a.png 1x, /b.png 2x");
  });

  it("drops style declarations that fetch or escape the box", () => {
    expect(attrOf('<p style="background-image: url(https://tracker.example/p.gif)">x</p>', "p", "style")).toBeNull();
    expect(attrOf('<p style="position: fixed; top: 0">x</p>', "p", "style")).toBeNull();
    expect(attrOf('<p style="width: expression(alert(1))">x</p>', "p", "style")).toBeNull();
  });

  it("keeps the styles the editor itself round-trips", () => {
    expect(attrOf('<span style="color: rgb(1, 2, 3)">x</span>', "span", "style")).toContain("color: rgb(1, 2, 3)");
    expect(attrOf('<span style="background-color: #ff0">x</span>', "span", "style")).toContain("background-color: #ff0");
    expect(attrOf('<p style="text-align: center">x</p>', "p", "style")).toContain("text-align: center");
    // Table column widths ride on <col style="width: …"> and must survive.
    expect(attrOf('<table><colgroup><col style="width: 120px"></colgroup></table>', "col", "style"))
      .toContain("width: 120px");
  });

  it("keeps a safe declaration even when a dangerous one sits beside it", () => {
    const style = attrOf('<p style="color: red; position: fixed">x</p>', "p", "style");
    expect(style).toContain("color: red");
    expect(style).not.toContain("position");
  });
});
