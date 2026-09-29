import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { addBaseRules } from '../engine/turndown-rules.ts';
import { SizedImage } from '../extensions/SizedImage.ts';
import { ThemeImage } from '../extensions/ThemeImage.tsx';

function td() {
  const t = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '*' });
  addBaseRules(t);
  return t;
}

describe('theme-aware & sized images', () => {
  it('parses <picture> into a themeImage node and serializes back to <picture>', () => {
    const input =
      '<p><picture>' +
      '<source media="(prefers-color-scheme: dark)" srcset="d.svg">' +
      '<source media="(prefers-color-scheme: light)" srcset="l.svg">' +
      '<img src="l.svg" alt="logo"></picture></p>';
    const editor = new Editor({ extensions: [StarterKit, ThemeImage, SizedImage], content: input });
    const html = editor.getHTML();
    expect(html).toContain('<picture');
    expect(html).toContain('d.svg');
    expect(html).toContain('l.svg');

    const md = td().turndown(html);
    expect(md).toContain('<picture');
    expect(md).toContain('prefers-color-scheme: dark');
    expect(md).toContain('d.svg');
    expect(md).toContain('l.svg');
    editor.destroy();
  });

  it('keeps width on a sized image and serializes it as an <img> tag', () => {
    const editor = new Editor({
      extensions: [StarterKit, SizedImage],
      content: '<p><img src="a.png" width="120" alt="a"></p>',
    });
    expect(editor.getHTML()).toContain('width="120"');
    const md = td().turndown(editor.getHTML());
    expect(md).toContain('<img');
    expect(md).toContain('width="120"');
    editor.destroy();
  });

  it('serializes a plain (unsized) image as Markdown, not raw HTML', () => {
    const editor = new Editor({
      extensions: [StarterKit, SizedImage],
      content: '<p><img src="a.png" alt="a"></p>',
    });
    const md = td().turndown(editor.getHTML());
    expect(md).toContain('![a](a.png)');
    expect(md).not.toContain('<img');
    editor.destroy();
  });

  it('preserves the #gh-*-mode-only fragment through the image round-trip', () => {
    const editor = new Editor({
      extensions: [StarterKit, SizedImage],
      content: '<p><img src="l.svg#gh-light-mode-only" alt="x"></p>',
    });
    const md = td().turndown(editor.getHTML());
    expect(md).toContain('l.svg#gh-light-mode-only');
    editor.destroy();
  });
});
