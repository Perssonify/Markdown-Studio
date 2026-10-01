import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import {
  applyCase,
  headingsCaseTiptap,
  transformCaseMarkdown,
  transformCaseTiptap,
} from '../formatting/case-transform.ts';

describe('applyCase', () => {
  it('upper / lower / title', () => {
    expect(applyCase('Hello World', 'upper')).toBe('HELLO WORLD');
    expect(applyCase('Hello World', 'lower')).toBe('hello world');
    expect(applyCase('hello wORLD', 'title')).toBe('Hello World');
  });
});

describe('transformCaseMarkdown (content-only)', () => {
  it('skips inline code, URLs, and HTML when content-only', () => {
    expect(transformCaseMarkdown('type `[[Doc]]` now', 'upper', true)).toBe('TYPE `[[Doc]]` NOW');
    expect(transformCaseMarkdown('[Text](https://Example.com/Path)', 'upper', true)).toBe('[TEXT](https://Example.com/Path)');
    // HTML tag syntax is preserved; the human-readable text inside it is content.
    expect(transformCaseMarkdown('a <u>b</u> c', 'upper', true)).toBe('A <u>B</u> C');
  });

  it('transforms everything when content-only is off', () => {
    expect(transformCaseMarkdown('type `[[Doc]]` now', 'upper', false)).toBe('TYPE `[[DOC]]` NOW');
  });

  it('preserves digits in the document (no sentinel collision)', () => {
    expect(transformCaseMarkdown('h2o and `x` and 3.14', 'upper', true)).toBe('H2O AND `x` AND 3.14');
  });
});

describe('transformCaseTiptap', () => {
  it('uppercases the selection but skips inline code when content-only', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: '<p>hello <code>keep</code> world</p>',
    });
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    transformCaseTiptap(editor, 'upper', true);
    const html = editor.getHTML();
    expect(html).toContain('HELLO');
    expect(html).toContain('WORLD');
    expect(html).toContain('<code>keep</code>'); // code untouched
    editor.destroy();
  });

  it('includes code when content-only is off', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: '<p>a <code>keep</code> b</p>',
    });
    editor.commands.selectAll();
    transformCaseTiptap(editor, 'upper', false);
    expect(editor.getHTML()).toContain('<code>KEEP</code>');
    editor.destroy();
  });
});

describe('headingsCaseTiptap', () => {
  it('applies case to every heading, leaving body text alone', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: '<h1>hello there</h1><p>body text</p><h2>another one</h2>',
    });
    headingsCaseTiptap(editor, 'title', true);
    const html = editor.getHTML();
    expect(html).toContain('<h1>Hello There</h1>');
    expect(html).toContain('<h2>Another One</h2>');
    expect(html).toContain('body text'); // unchanged
    editor.destroy();
  });
});
