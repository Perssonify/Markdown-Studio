import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  archiveEntriesToItems,
  buildZip,
  extractArchive,
  formatForName,
  isArchiveName,
  isZipEncrypted,
  normalizeArchivePath,
  sanitizeFolderName,
} from '../store/archive.ts';

const entry = (path) => ({ path, text: `content of ${path}`, format: formatForName(path) });

function fileFromBytes(bytes, name) {
  // jsdom File supports arrayBuffer() via Blob.
  return new File([bytes], name);
}

describe('archive', () => {
  it('detects archive names and maps formats', () => {
    expect(isArchiveName('x.zip')).toBe(true);
    expect(isArchiveName('x.tar.gz')).toBe(true);
    expect(isArchiveName('x.md')).toBe(false);
    expect(formatForName('a/b.md')).toBe('markdown');
    expect(formatForName('a/b.html')).toBe('html');
    expect(formatForName('a/b.json')).toBe('pmjson');
  });

  it('isZipEncrypted: false for a normal (unencrypted) zip', () => {
    expect(isZipEncrypted(buildZip({ 'a.md': '# hi' }))).toBe(false);
  });

  it('isZipEncrypted: true when the general-purpose encryption bit is set', () => {
    // Minimal local file header (PK\x03\x04) with flag bit 0 set; no EOCD, so
    // detection falls back to the local header — fflate/buildZip can't emit one.
    const buf = new Uint8Array(30);
    buf[0] = 0x50; buf[1] = 0x4b; buf[2] = 0x03; buf[3] = 0x04;
    buf[6] = 0x01; buf[7] = 0x00; // flags = 0x0001 (encrypted)
    expect(isZipEncrypted(buf)).toBe(true);
  });

  it('isZipEncrypted: false for non-zip bytes', () => {
    expect(isZipEncrypted(new Uint8Array([1, 2, 3, 4, 5]))).toBe(false);
  });

  it('round-trips a zip: buildZip → extractArchive preserves paths + text', async () => {
    const zipped = buildZip({
      'notes/intro.md': '# Intro\n\nhello',
      'notes/sub/deep.md': 'deep content',
      'root.md': 'top level',
      'skip.png': 'ignored-binary', // non-text, must be filtered out
    });
    const entries = await extractArchive(fileFromBytes(zipped, 'bundle.zip'));
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.text]));
    expect(byPath['notes/intro.md']).toContain('hello');
    expect(byPath['notes/sub/deep.md']).toBe('deep content');
    expect(byPath['root.md']).toBe('top level');
    expect(byPath['skip.png']).toBeUndefined(); // non-text filtered
    // sanity: the zip really contained all 4 files
    expect(Object.keys(unzipSync(zipped))).toHaveLength(4);
  });

  it('normalizeArchivePath: strips absolute roots, drives, and ../. segments', () => {
    expect(normalizeArchivePath('notes/intro.md')).toBe('notes/intro.md');
    expect(normalizeArchivePath('/etc/passwd.md')).toBe('etc/passwd.md');
    expect(normalizeArchivePath('../../secret.md')).toBe('secret.md');
    expect(normalizeArchivePath('a/../../b.md')).toBe('a/b.md');
    expect(normalizeArchivePath('C:\\Windows\\x.md')).toBe('Windows/x.md');
    expect(normalizeArchivePath('./a/./b.md')).toBe('a/b.md');
    expect(normalizeArchivePath('../..')).toBe('');
    // drive-relative form with no separator — the `C:` prefix is stripped so no
    // colon drive marker survives into a folder name / storage key
    expect(normalizeArchivePath('C:notes.md')).toBe('notes.md');
  });

  it('extractArchive: neutralizes traversal paths in the extracted entries', async () => {
    const zipped = buildZip({
      '../escape.md': 'nope',
      'good/inside.md': 'yes',
    });
    const entries = await extractArchive(fileFromBytes(zipped, 'bundle.zip'));
    const paths = entries.map((e) => e.path);
    // no entry retains a leading `..` traversal segment
    expect(paths.every((p) => !p.split('/').includes('..'))).toBe(true);
    expect(paths).toContain('good/inside.md');
    // the escaping entry is kept but flattened to a safe relative path
    expect(paths).toContain('escape.md');
  });
});

describe('archiveEntriesToItems', () => {
  it('wraps loose root files under a folder named after the archive', () => {
    const items = archiveEntriesToItems(
      [entry('a.md'), entry('b.md')],
      'notes.zip'
    );
    expect(items.map((i) => i.folderPath)).toEqual([['notes'], ['notes']]);
  });

  it('leaves a single top-level folder unchanged (no double-nesting)', () => {
    const items = archiveEntriesToItems(
      [entry('project/a.md'), entry('project/sub/b.md')],
      'download.zip'
    );
    expect(items.map((i) => i.folderPath)).toEqual([['project'], ['project', 'sub']]);
  });

  it('wraps a mix of loose + nested files, nesting existing folders under the base', () => {
    const items = archiveEntriesToItems(
      [entry('a.md'), entry('sub/b.md')],
      'my docs.zip'
    );
    expect(items.map((i) => i.folderPath)).toEqual([['my docs'], ['my docs', 'sub']]);
  });

  it('imports a single file at the root (nothing to organize)', () => {
    expect(archiveEntriesToItems([entry('a.md')], 'notes.zip')[0].folderPath).toEqual([]);
  });

  it('keeps a single nested file in its folder', () => {
    expect(archiveEntriesToItems([entry('sub/a.md')], 'notes.zip')[0].folderPath).toEqual(['sub']);
  });

  it('does NOT wrap a perssonify full-backup (paths preserved verbatim)', () => {
    // A backup mixes root docs and foldered docs; the loose-file wrap heuristic
    // must not fire, or the whole library nests under a synthetic folder.
    const envelope = (title) => JSON.stringify({ _format: 'perssonify-document', title, canonical: { type: 'doc', content: [] } });
    const items = archiveEntriesToItems(
      [
        { path: 'root-note.json', text: envelope('root-note'), format: 'pmjson' },
        { path: 'Work/plan.json', text: envelope('plan'), format: 'pmjson' },
      ],
      'perssonify-backup-20260804-120000000.zip'
    );
    // root doc stays at root; foldered doc keeps its folder — no wrapper level
    expect(items.map((i) => i.folderPath)).toEqual([[], ['Work']]);
  });

  it('still wraps a plain multi-file zip with a loose root file', () => {
    const items = archiveEntriesToItems(
      [entry('a.md'), entry('sub/b.md')],
      'stuff.zip'
    );
    expect(items[0].folderPath).toEqual(['stuff']);
  });

  it('sanitizes the archive base name into a folder name', () => {
    expect(sanitizeFolderName('My Notes.tar.gz')).toBe('My Notes.tar');
    expect(sanitizeFolderName('a/b:c.zip')).toBe('a_b_c');
    const items = archiveEntriesToItems([entry('x.md'), entry('y.md')], 'a/b.zip');
    expect(items[0].folderPath).toEqual(['a_b']);
  });
});

describe('archive entry filtering', () => {
  it('keeps a dot-prefixed FILE name (a real note titled ".env setup")', async () => {
    const zipped = buildZip({
      '.env setup.md': 'secrets go here',
      'notes/.gitignore reference.md': 'patterns',
      'plain.md': 'ok',
    });
    const entries = await extractArchive(fileFromBytes(zipped, 'backup.zip'));
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('.env setup.md');
    expect(paths).toContain('notes/.gitignore reference.md');
    expect(paths).toContain('plain.md');
  });

  it('still drops hidden directories and archiver junk', async () => {
    const zipped = buildZip({
      '.git/config.md': 'x',
      '.obsidian/workspace.md': 'x',
      '__MACOSX/._thing.md': 'x',
      '.DS_Store': 'x',
      'real.md': 'keep',
    });
    const entries = await extractArchive(fileFromBytes(zipped, 'backup.zip'));
    expect(entries.map((e) => e.path)).toEqual(['real.md']);
  });
});
