import { describe, expect, it } from 'vitest';
import { sanitizePastedHtml } from '../engine/html-cleaner.ts';
import { sanitizeForIngest } from '../store/importExport/ingest.ts';

describe('paste sanitizer (sanitizePastedHtml)', () => {
  it('strips on* event-handler attributes', () => {
    const out = sanitizePastedHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
  });
  it('strips javascript: URLs', () => {
    const out = sanitizePastedHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });
  it('keeps benign content', () => {
    const out = sanitizePastedHtml('<a href="https://example.com">link</a>');
    expect(out).toContain('https://example.com');
  });
});

describe('ingest sanitizer (sanitizeForIngest, DOM-based)', () => {
  it('drops on* handlers and javascript: URLs but preserves text/images', () => {
    const out = sanitizeForIngest(
      '<p>hi <a href="javascript:alert(1)">x</a> <img src="y" onerror="alert(1)"> <img src="data:image/png;base64,AAAA"></p>'
    );
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('data:image/png'); // inline images allowed
    expect(out).toContain('hi'); // text preserved
  });

  it('removes blocked elements but keeps their text', () => {
    const out = sanitizeForIngest('<p>safe</p><script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('safe');
  });
});
