import { describe, it, expect } from 'vitest';
import {
  generateId,
  createOrigin,
  createDocument,
  deriveTitleFromCanonical,
  resolveDocTitle,
  extractText,
  computeCounts,
  serializeForStorage,
  deserializeFromStorage,
  toSummary,
  extractFields,
  extractTags,
  syncFieldsToMetadata,
} from '../store/document';

// --- Helper: PM JSON builders ---

function pmDoc(...content) {
  return { type: "doc", content };
}

function pmHeading(level, text) {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

function pmParagraph(text) {
  return { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
}

function pmFieldBlock(fields) {
  return { type: "fieldBlock", attrs: { fields } };
}

// --- Tests ---

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(5);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('createOrigin', () => {
  it('creates an origin with required fields', () => {
    const o = createOrigin('markdown', '# Hello', 'user-typed');
    expect(o.format).toBe('markdown');
    expect(o.raw).toBe('# Hello');
    expect(o.source).toBe('user-typed');
    expect(o.timestamp).toBeTruthy();
    expect(o.alternates).toBeNull();
  });

  it('accepts alternates', () => {
    const o = createOrigin('html', '<p>hi</p>', 'clipboard-paste', { 'text/plain': 'hi' });
    expect(o.alternates).toEqual({ 'text/plain': 'hi' });
  });
});

describe('createDocument', () => {
  it('creates a document with defaults', () => {
    const doc = createDocument();
    expect(doc.id).toBeTruthy();
    expect(doc.title).toBe('Untitled');
    expect(doc.canonical.type).toBe('doc');
    expect(doc.residuals).toEqual([]);
    expect(doc.tags).toEqual([]);
    expect(doc.created).toBeTruthy();
    expect(doc.updated).toBeTruthy();
  });

  it('accepts custom options', () => {
    const doc = createDocument({
      id: 'custom-id',
      title: 'My Doc',
      tags: ['test', 'review'],
    });
    expect(doc.id).toBe('custom-id');
    expect(doc.title).toBe('My Doc');
    expect(doc.tags).toEqual(['test', 'review']);
  });
});

describe('extractText', () => {
  it('extracts text from a text node', () => {
    expect(extractText({ type: 'text', text: 'hello' })).toBe('hello');
  });

  it('extracts text recursively from nested content', () => {
    const node = pmDoc(pmParagraph('hello '), pmParagraph('world'));
    expect(extractText(node)).toBe('hello world');
  });

  it('returns empty string for null/undefined', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
  });

  it('returns empty string for node without content', () => {
    expect(extractText({ type: 'horizontalRule' })).toBe('');
  });
});

describe('deriveTitleFromCanonical', () => {
  it('extracts title from first heading', () => {
    const canonical = pmDoc(pmHeading(1, 'My Title'), pmParagraph('body text'));
    expect(deriveTitleFromCanonical(canonical)).toBe('My Title');
  });

  it('falls back to first paragraph when no heading', () => {
    const canonical = pmDoc(pmParagraph('First paragraph text'));
    expect(deriveTitleFromCanonical(canonical)).toBe('First paragraph text');
  });

  it('truncates long paragraph fallback to 60 chars', () => {
    const long = 'A'.repeat(80);
    const canonical = pmDoc(pmParagraph(long));
    const title = deriveTitleFromCanonical(canonical);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toContain('…');
  });

  it('returns Untitled for empty/null canonical', () => {
    expect(deriveTitleFromCanonical(null)).toBe('Untitled');
    expect(deriveTitleFromCanonical({})).toBe('Untitled');
    expect(deriveTitleFromCanonical(pmDoc())).toBe('Untitled');
  });

  it('returns Untitled for empty heading text', () => {
    const canonical = pmDoc({ type: "heading", attrs: { level: 1 }, content: [] });
    expect(deriveTitleFromCanonical(canonical)).toBe('Untitled');
  });
});

describe('resolveDocTitle', () => {
  it('derives from content when no userTitle is pinned', () => {
    const doc = { title: 'Untitled 3', userTitle: null };
    const canonical = pmDoc(pmHeading(1, 'Project Alpha'));
    expect(resolveDocTitle(doc, canonical)).toEqual({ title: 'Project Alpha', userTitle: null, titlePinnedByUser: false });
  });

  it('keeps the unique placeholder while the doc is still empty', () => {
    const doc = { title: 'Untitled 3', userTitle: null };
    expect(resolveDocTitle(doc, pmDoc())).toEqual({ title: 'Untitled 3', userTitle: null, titlePinnedByUser: false });
  });

  it('an explicit rename always wins over content (legacy string heuristic)', () => {
    const doc = { title: 'My Name', userTitle: 'My Name' };
    const canonical = pmDoc(pmHeading(1, 'Different Heading'));
    expect(resolveDocTitle(doc, canonical)).toEqual({ title: 'My Name', userTitle: 'My Name', titlePinnedByUser: true });
  });

  it('heals legacy "Untitled N" pins once real content exists', () => {
    // Older versions pinned userTitle at creation, permanently blocking
    // content derivation. Those pins (no provenance flag) must yield to a heading.
    const doc = { title: 'Untitled 2', userTitle: 'Untitled 2' };
    const canonical = pmDoc(pmHeading(1, 'Real Title'));
    expect(resolveDocTitle(doc, canonical)).toEqual({ title: 'Real Title', userTitle: null, titlePinnedByUser: false });
  });

  it('keeps a legacy placeholder pin while the doc is empty', () => {
    const doc = { title: 'Untitled 2', userTitle: 'Untitled 2' };
    expect(resolveDocTitle(doc, pmDoc())).toEqual({ title: 'Untitled 2', userTitle: 'Untitled 2', titlePinnedByUser: false });
  });

  it('honors a provenance-flagged pin VERBATIM even when it reads "Untitled N"', () => {
    // The bug the flag fixes: a user who deliberately names a doc "Untitled 5"
    // must keep it — the old string heuristic mis-healed it away.
    const doc = { title: 'Untitled 5', userTitle: 'Untitled 5', titlePinnedByUser: true };
    const canonical = pmDoc(pmHeading(1, 'Some Heading'));
    expect(resolveDocTitle(doc, canonical)).toEqual({ title: 'Untitled 5', userTitle: 'Untitled 5', titlePinnedByUser: true });
  });

  it('a flagged pin wins over content in general', () => {
    const doc = { title: 'Chosen', userTitle: 'Chosen', titlePinnedByUser: true };
    const canonical = pmDoc(pmHeading(1, 'A Heading'));
    expect(resolveDocTitle(doc, canonical)).toEqual({ title: 'Chosen', userTitle: 'Chosen', titlePinnedByUser: true });
  });
});

describe('titlePinnedByUser provenance', () => {
  it('createDocument defaults the flag false for a fresh doc', () => {
    const doc = createDocument({ title: 'X' });
    expect(doc.titlePinnedByUser).toBe(false);
  });

  it('migration: a legacy non-placeholder userTitle back-fills the flag true', () => {
    const doc = createDocument({ userTitle: 'My Notes' });
    expect(doc.titlePinnedByUser).toBe(true);
  });

  it('migration: a legacy "Untitled N" pin stays unflagged so it can heal', () => {
    const doc = createDocument({ userTitle: 'Untitled 2' });
    expect(doc.titlePinnedByUser).toBe(false);
  });

  it('round-trips the flag through storage', () => {
    const doc = createDocument({ userTitle: 'Untitled 5', titlePinnedByUser: true });
    const restored = deserializeFromStorage(serializeForStorage(doc));
    expect(restored.titlePinnedByUser).toBe(true);
    expect(restored.userTitle).toBe('Untitled 5');
  });
});

describe('computeCounts', () => {
  it('counts words and characters', () => {
    const canonical = pmDoc(pmParagraph('hello world'));
    const counts = computeCounts(canonical);
    expect(counts.words).toBe(2);
    expect(counts.chars).toBe(11);
  });

  it('returns zero for empty document', () => {
    const canonical = pmDoc(pmParagraph(''));
    const counts = computeCounts(canonical);
    expect(counts.words).toBe(0);
    expect(counts.chars).toBe(0);
  });

  it('handles multiple paragraphs', () => {
    const canonical = pmDoc(pmParagraph('one two'), pmParagraph('three'));
    const counts = computeCounts(canonical);
    // extractText concatenates without separators: "one twothree" = 2 words
    expect(counts.words).toBe(2);
  });
});

describe('serializeForStorage / deserializeFromStorage', () => {
  it('round-trips a document', () => {
    const doc = createDocument({ title: 'Test', tags: ['a'] });
    const json = serializeForStorage(doc);
    const restored = deserializeFromStorage(json);
    expect(restored.id).toBe(doc.id);
    expect(restored.title).toBe('Test');
    expect(restored.tags).toEqual(['a']);
  });

  it('excludes caches from serialized form', () => {
    const doc = createDocument({ markdownCache: 'cached', fidelityReport: { lossless: true } });
    const json = serializeForStorage(doc);
    const parsed = JSON.parse(json);
    expect(parsed.markdownCache).toBeUndefined();
    expect(parsed.fidelityReport).toBeUndefined();
  });

  it('returns null for invalid JSON', () => {
    expect(deserializeFromStorage('not json')).toBeNull();
  });

  it('handles object input (already parsed)', () => {
    const doc = createDocument({ title: 'Already Parsed' });
    const restored = deserializeFromStorage({ title: 'Already Parsed', id: doc.id });
    expect(restored.title).toBe('Already Parsed');
  });
});

describe('toSummary', () => {
  it('creates a summary with word count', () => {
    const doc = createDocument({
      title: 'My Doc',
      canonical: pmDoc(pmParagraph('hello world')),
    });
    const summary = toSummary(doc);
    expect(summary.id).toBe(doc.id);
    expect(summary.title).toBe('My Doc');
    expect(summary.wordCount).toBe(2);
    expect(summary.hasResiduals).toBe(false);
  });

  it('reports hasResiduals when residuals exist', () => {
    const doc = createDocument({ residuals: [{ type: 'unknown', data: 'x' }] });
    expect(toSummary(doc).hasResiduals).toBe(true);
  });
});

describe('extractFields / extractTags', () => {
  it('extracts fields from fieldBlock nodes', () => {
    const canonical = pmDoc(
      pmFieldBlock([{ key: 'status', value: 'draft' }, { key: 'author', value: 'Alice' }]),
      pmParagraph('body')
    );
    const fields = extractFields(canonical);
    expect(fields.status).toBe('draft');
    expect(fields.author).toBe('Alice');
  });

  it('returns empty object for no fields', () => {
    expect(extractFields(pmDoc(pmParagraph('text')))).toEqual({});
    expect(extractFields(null)).toEqual({});
  });

  it('extracts tags from comma-separated tags field', () => {
    const canonical = pmDoc(
      pmFieldBlock([{ key: 'tags', value: 'react, editor, markdown' }])
    );
    const tags = extractTags(canonical);
    expect(tags).toEqual(['react', 'editor', 'markdown']);
  });

  it('returns empty array for no tags', () => {
    expect(extractTags(pmDoc(pmParagraph('text')))).toEqual([]);
  });
});

describe('syncFieldsToMetadata', () => {
  it('merges field values into metadata', () => {
    const doc = createDocument({
      canonical: pmDoc(
        pmFieldBlock([{ key: 'status', value: 'published' }, { key: 'tags', value: 'a, b' }])
      ),
      metadata: { existing: true },
    });
    const result = syncFieldsToMetadata(doc);
    expect(result.metadata.status).toBe('published');
    expect(result.metadata.existing).toBe(true);
    expect(result.tags).toEqual(['a', 'b']);
  });

  it('returns doc unchanged if no canonical', () => {
    const doc = { title: 'no canonical' };
    expect(syncFieldsToMetadata(doc)).toBe(doc);
  });
});
