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

  it('preserves inline code content exactly', () => {
    const out = preprocessMarkdown('use `?import_url=` and `<img width="120">`', {});
    expect(out).toContain('`?import_url=`');
    expect(out).toContain('`<img width="120">`');
  });
});
