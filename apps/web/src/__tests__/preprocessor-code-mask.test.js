import { describe, expect, it } from 'vitest';
import { preprocessMarkdown } from '../engine/preprocessor.ts';

describe('preprocessor code masking', () => {
  it('leaves wiki links inside inline code literal', () => {
    const out = preprocessMarkdown('type `[[Doc]]` to link', { wikiLinks: true });
    expect(out).toContain('`[[Doc]]`');
    expect(out).not.toContain('data-doc-link');
  });

  it('still converts wiki links outside code', () => {
    const out = preprocessMarkdown('see [[Doc]] now', { wikiLinks: true });
    expect(out).toContain('data-doc-link');
  });

  it('leaves wiki links and task syntax inside fenced code literal', () => {
    const out = preprocessMarkdown('```\n[[Doc]]\n- [ ] task\n```', {
      wikiLinks: true,
      taskLists: true,
    });
    expect(out).toContain('[[Doc]]');
    expect(out).not.toContain('data-doc-link');
    expect(out).not.toContain('type="checkbox"');
  });

  it('restores a mask that took in another mask (A083)', () => {
    // The backtick run spans a fence that interrupts its paragraph: the fence
    // is masked first, then the run is masked WITH the fence's placeholder in
    // it. One restore pass left "@@PFCODE0@@" in the document.
    for (const md of [
      '[[Page]]\n\n`start\n```\ncode\n```\nend`',
      '[[Page]]\n\n`a\n~~~\nb\n~~~\nc` and `d\n```\ne\n```\nf`',
    ]) {
      const out = preprocessMarkdown(md, { wikiLinkTablePipes: true });
      expect(out).not.toContain('@@PFCODE');
      expect(out).toBe(md);
    }
  });

  it('preserves inline code content exactly', () => {
    const out = preprocessMarkdown('use `?import_url=` and `<img width="120">`', {});
    expect(out).toContain('`?import_url=`');
    expect(out).toContain('`<img width="120">`');
  });
});
