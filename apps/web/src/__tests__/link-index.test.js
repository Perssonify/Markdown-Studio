import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  scanWikiLinks,
  resolveTarget,
  buildLinkIndex,
  updateDocInIndex,
  getBacklinks,
  getForwardLinks,
  exportGraph,
} from '../store/link-index';

// --- PM JSON builders ---

function pmDoc(...content) {
  return { type: "doc", content };
}

function pmParagraph(text) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function makeDoc(id, title, text) {
  return {
    id,
    title,
    canonical: pmDoc(pmParagraph(text)),
    tags: [],
    metadata: {},
    created: '2024-01-01',
    updated: '2024-01-01',
  };
}

// --- Tests ---

describe('scanWikiLinks', () => {
  it('detects simple wiki links', () => {
    const canonical = pmDoc(pmParagraph('See [[My Document]] for details'));
    const links = scanWikiLinks(canonical);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('My Document');
    expect(links[0].displayText).toBe('My Document');
    expect(links[0].raw).toBe('[[My Document]]');
  });

  it('detects pipe-separated links', () => {
    const canonical = pmDoc(pmParagraph('See [[doc-123|Click Here]]'));
    const links = scanWikiLinks(canonical);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('doc-123');
    expect(links[0].displayText).toBe('Click Here');
  });

  it('detects multiple links in one paragraph', () => {
    const canonical = pmDoc(pmParagraph('Link to [[A]] and [[B]]'));
    expect(scanWikiLinks(canonical)).toHaveLength(2);
  });

  it('detects links across multiple paragraphs', () => {
    const canonical = pmDoc(pmParagraph('See [[A]]'), pmParagraph('Also [[B]]'));
    expect(scanWikiLinks(canonical)).toHaveLength(2);
  });

  it('returns empty for no links', () => {
    expect(scanWikiLinks(pmDoc(pmParagraph('no links here')))).toEqual([]);
  });

  it('strips a #heading anchor so the target is the document', () => {
    const links = scanWikiLinks(pmDoc(pmParagraph('jump to [[Guide#Setup]] now')));
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('Guide');
  });

  it('ignores a same-document anchor ([[#Heading]]) as a doc link', () => {
    expect(scanWikiLinks(pmDoc(pmParagraph('see [[#Overview]]')))).toEqual([]);
  });

  it('detects a rendered wiki link (link mark with docLink)', () => {
    const canonical = pmDoc({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Guide', marks: [{ type: 'link', attrs: { docLink: 'Guide', anchor: null, href: '#' } }] }],
    });
    const links = scanWikiLinks(canonical);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('Guide');
  });

  it('strips the anchor from a rendered heading-anchor link mark', () => {
    const canonical = pmDoc({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Setup', marks: [{ type: 'link', attrs: { docLink: 'Guide#Setup', anchor: 'Setup', href: '#' } }] }],
    });
    const links = scanWikiLinks(canonical);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('Guide');
  });

  it('returns empty for null/empty canonical', () => {
    expect(scanWikiLinks(null)).toEqual([]);
    expect(scanWikiLinks({})).toEqual([]);
  });

  it('trims whitespace in targets', () => {
    const canonical = pmDoc(pmParagraph('See [[ My Doc ]]'));
    const links = scanWikiLinks(canonical);
    expect(links[0].target).toBe('My Doc');
  });
});

describe('resolveTarget', () => {
  const docs = [
    { id: 'abc', title: 'Alpha Document' },
    { id: 'def', title: 'Beta Notes' },
  ];

  it('resolves by exact ID', () => {
    expect(resolveTarget('abc', docs)).toBe('abc');
  });

  it('resolves by exact title (case-insensitive)', () => {
    expect(resolveTarget('alpha document', docs)).toBe('abc');
    expect(resolveTarget('BETA NOTES', docs)).toBe('def');
  });

  // A059: this used to assert the opposite. Partial (`includes`) matching sent
  // `[[C# Tips]]` to "Changelog" in the graph and backlinks — the first title
  // containing "c" — while a click on the same link said "Document not found".
  // A link names ONE document; a fragment of a title names none.
  it('does NOT resolve a partial title (A059)', () => {
    expect(resolveTarget('Alpha', docs)).toBeNull();
    expect(resolveTarget('Beta', docs)).toBeNull();
  });

  it('returns null for unresolvable target', () => {
    expect(resolveTarget('nonexistent', docs)).toBeNull();
  });

  it('prefers exact ID over title match', () => {
    const docsWithConflict = [
      { id: 'exact', title: 'Different Title' },
      { id: 'other', title: 'exact' },
    ];
    expect(resolveTarget('exact', docsWithConflict)).toBe('exact');
  });
});

describe('buildLinkIndex', () => {
  it('builds forward and reverse maps', () => {
    const docs = [
      makeDoc('a', 'Doc A', 'Link to [[Doc B]]'),
      makeDoc('b', 'Doc B', 'Link to [[Doc A]]'),
      makeDoc('c', 'Doc C', 'No links'),
    ];
    const index = buildLinkIndex(docs);

    expect(index.forward.get('a')).toEqual(new Set(['b']));
    expect(index.forward.get('b')).toEqual(new Set(['a']));
    expect(index.forward.has('c')).toBe(false);

    expect(index.reverse.get('b')).toEqual(new Set(['a']));
    expect(index.reverse.get('a')).toEqual(new Set(['b']));
  });

  it('tracks unresolved links', () => {
    const docs = [
      makeDoc('a', 'Doc A', 'Link to [[Nonexistent]]'),
    ];
    const index = buildLinkIndex(docs);
    expect(index.unresolved.get('a')).toHaveLength(1);
    expect(index.unresolved.get('a')[0].target).toBe('Nonexistent');
  });

  it('ignores self-links', () => {
    const docs = [
      makeDoc('a', 'Doc A', 'Link to [[Doc A]]'),
    ];
    const index = buildLinkIndex(docs);
    expect(index.forward.has('a')).toBe(false);
  });

  it('handles empty document set', () => {
    const index = buildLinkIndex([]);
    expect(index.forward.size).toBe(0);
    expect(index.reverse.size).toBe(0);
  });
});

describe('updateDocInIndex', () => {
  it('updates forward links when document changes', () => {
    const docs = [
      makeDoc('a', 'Doc A', 'Link to [[Doc B]]'),
      makeDoc('b', 'Doc B', 'No links'),
    ];
    const index = buildLinkIndex(docs);
    expect(index.forward.get('a')).toEqual(new Set(['b']));

    // Change doc A to link to nothing
    const updatedA = makeDoc('a', 'Doc A', 'No more links');
    updateDocInIndex(index, updatedA, docs);

    expect(index.forward.has('a')).toBe(false);
    expect(index.reverse.has('b')).toBe(false);
  });

  it('adds new forward links', () => {
    const docs = [
      makeDoc('a', 'Doc A', 'No links'),
      makeDoc('b', 'Doc B', 'No links'),
    ];
    const index = buildLinkIndex(docs);

    const updatedA = makeDoc('a', 'Doc A', 'Now links to [[Doc B]]');
    updateDocInIndex(index, updatedA, docs);

    expect(index.forward.get('a')).toEqual(new Set(['b']));
    expect(index.reverse.get('b')).toEqual(new Set(['a']));
  });

  // The incremental link-index hot path (useLinkIndex) relies on this: for a
  // content edit, splicing the changed doc into the existing index must yield the
  // SAME graph as a full rebuild. If this ever diverges, the incremental path is
  // wrong and must fall back to a full rebuild.
  it('incremental update matches a full rebuild after a content edit', () => {
    const docs = [
      makeDoc('a', 'Doc A', 'Link to [[Doc B]]'),
      makeDoc('b', 'Doc B', 'No links'),
      makeDoc('c', 'Doc C', 'See [[Doc A]]'),
    ];
    const incremental = buildLinkIndex(docs);

    // Doc A drops its B link and gains a C link.
    const editedA = makeDoc('a', 'Doc A', 'Now points to [[Doc C]] instead');
    const nextDocs = [editedA, docs[1], docs[2]];
    updateDocInIndex(incremental, editedA, nextDocs);

    const full = buildLinkIndex(nextDocs);

    const norm = (idx) => ({
      forward: [...idx.forward.entries()].map(([k, v]) => [k, [...v].sort()]).sort(),
      reverse: [...idx.reverse.entries()].map(([k, v]) => [k, [...v].sort()]).sort(),
      unresolved: [...idx.unresolved.keys()].sort(),
    });
    expect(norm(incremental)).toEqual(norm(full));
  });
});

describe('getBacklinks / getForwardLinks', () => {
  it('returns backlinks with title and context', () => {
    const docs = [
      makeDoc('a', 'Doc A', 'See [[Doc B]] for info'),
      makeDoc('b', 'Doc B', 'No links'),
    ];
    const index = buildLinkIndex(docs);
    const backlinks = getBacklinks(index, 'b', docs);

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].docId).toBe('a');
    expect(backlinks[0].title).toBe('Doc A');
  });

  it('returns forward links with title', () => {
    const docs = [
      makeDoc('a', 'Doc A', 'Link to [[Doc B]]'),
      makeDoc('b', 'Doc B', 'No links'),
    ];
    const index = buildLinkIndex(docs);
    const fwd = getForwardLinks(index, 'a', docs);

    expect(fwd).toHaveLength(1);
    expect(fwd[0].docId).toBe('b');
    expect(fwd[0].title).toBe('Doc B');
  });

  it('returns empty for document with no links', () => {
    const docs = [makeDoc('a', 'Doc A', 'No links')];
    const index = buildLinkIndex(docs);
    expect(getBacklinks(index, 'a', docs)).toEqual([]);
    expect(getForwardLinks(index, 'a', docs)).toEqual([]);
  });
});

describe('exportGraph', () => {
  it('exports nodes and edges', () => {
    const docs = [
      makeDoc('a', 'Doc A', 'Link to [[Doc B]]'),
      makeDoc('b', 'Doc B', 'No links'),
    ];
    const index = buildLinkIndex(docs);
    const graph = exportGraph(docs, index);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0].id).toBe('a');
    expect(graph.nodes[0].backlinks).toBe(0);
    expect(graph.nodes[0].forwardLinks).toBe(1);
    expect(graph.nodes[1].backlinks).toBe(1);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].source).toBe('a');
    expect(graph.edges[0].target).toBe('b');
  });

  it('exports empty graph', () => {
    const graph = exportGraph([], buildLinkIndex([]));
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });
});

describe("wiki links inside code are not indexed (F2)", () => {
  const textNode = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
  const para = (...content) => ({ type: "paragraph", content });

  it("ignores a [[Doc]] inside an inline code span", () => {
    const canonical = {
      type: "doc",
      content: [para(textNode("type "), textNode("[[Document title]]", [{ type: "code" }]), textNode(" to link"))],
    };
    expect(scanWikiLinks(canonical)).toEqual([]);
  });

  it("ignores wiki links inside a fenced code block", () => {
    const canonical = {
      type: "doc",
      content: [{ type: "codeBlock", content: [textNode("see [[Other Doc]] here")] }],
    };
    expect(scanWikiLinks(canonical)).toEqual([]);
  });

  it("still indexes a real [[Doc]] in ordinary prose", () => {
    const canonical = { type: "doc", content: [para(textNode("see [[Other Doc]]"))] };
    expect(scanWikiLinks(canonical).map((l) => l.target)).toEqual(["Other Doc"]);
  });
});

/**
 * `fullDocsRef.current`'s IDENTITY is treated as "has the library changed?" by
 * consumers — the library body-search caches an id→doc map on it. The
 * incremental path (taken on every ordinary content edit) mutated the same
 * array object, so that cache kept handing back the PRE-EDIT record: a word you
 * had just typed did not match, a word you had just deleted still did, until
 * some document was added, deleted or renamed.
 */
describe("the incremental path replaces the docs array rather than mutating it", () => {
  const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
  const src = read("src/hooks/useLinkIndex.ts");
  const body = src.slice(src.indexOf("const applyIncremental"), src.indexOf("const rebuildLinks") > src.indexOf("const applyIncremental") ? src.indexOf("const rebuildLinks") : undefined);

  it("does not write through fullDocsRef.current", () => {
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Any of these on the SAME array is the bug.
    expect(code).not.toMatch(/const arr = fullDocsRef\.current;[\s\S]*?arr\[\w+\] =/);
    expect(code).not.toMatch(/arr\.push\(/);
    expect(code).not.toMatch(/arr\.splice\(/);
    expect(code).toMatch(/fullDocsRef\.current = next/);
  });
});
