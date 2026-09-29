import { Editor } from '@tiptap/core';
import { TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { cleanHtmlForTurndown } from '../engine/html-cleaner.ts';
import { addBaseRules, addInlineStyleRule } from '../engine/turndown-rules.ts';
import { BackgroundColor } from '../extensions/BackgroundColor.ts';

/**
 * Regression guard for the background-color bug.
 *
 * Root cause: highlight was a `<mark>` (Highlight extension) with no matching
 * Turndown rule, so background color was silently dropped on HTML→MD/save.
 * Fix: represent it as a `backgroundColor` attribute on the `textStyle` mark →
 * `<span style="background-color: …">`, which the existing styled-span Turndown
 * rule already preserves.
 */
describe('background-color', () => {
  it('setBackgroundColor renders a background-color span in TipTap', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, BackgroundColor],
      content: '<p>hello</p>',
    });
    editor.commands.selectAll();
    editor.commands.setBackgroundColor('#ffff00');

    const html = editor.getHTML();
    expect(html).toContain('background-color');
    // Browsers normalize #ffff00 to rgb(255, 255, 0); accept either form.
    expect(html).toMatch(/#ffff00|rgb\(255,\s*255,\s*0\)/);

    editor.destroy();
  });

  it('parses a background-color span back into the mark (round-trip)', () => {
    const input = '<p><span style="background-color: #ffff00">hello</span></p>';
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, BackgroundColor],
      content: input,
    });
    // The mark survives a parse→serialize cycle rather than being dropped.
    expect(editor.getHTML()).toContain('background-color');
    editor.destroy();
  });

  it('preserves background-color through the styled HTML→Markdown path', () => {
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
    });
    addBaseRules(td);
    addInlineStyleRule(td);

    const html = '<p><span style="background-color: #ffff00">hi</span></p>';
    const md = td.turndown(cleanHtmlForTurndown(html));

    expect(md).toContain('background-color');
    expect(md).toContain('#ffff00');
    expect(md).toContain('hi');
  });
});
