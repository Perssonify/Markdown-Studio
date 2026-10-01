import { describe, it, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { mdWrap, isWrapped } from '../formatting/md-format-utils';

/**
 * Create a CM6 EditorView with given document and selection.
 * Works in jsdom — no layout/rendering needed for state/dispatch tests.
 */
function createView(doc, anchor, head = anchor) {
  const parent = document.createElement('div');
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
  });
  return new EditorView({ state, parent });
}

/** Read the current document text from a view */
function getDoc(view) {
  return view.state.doc.toString();
}

/** Read the current selection range */
function getSel(view) {
  const { from, to } = view.state.selection.main;
  return { from, to };
}

// --- mdWrap tests ---

describe('mdWrap', () => {
  it('wraps selected text with markers', () => {
    const view = createView('hello world', 0, 5); // select "hello"
    mdWrap(view, '**', '**');
    expect(getDoc(view)).toBe('**hello** world');
  });

  it('places cursor inside markers after wrap', () => {
    const view = createView('hello world', 0, 5);
    mdWrap(view, '**', '**');
    const sel = getSel(view);
    expect(sel.from).toBe(2);  // after **
    expect(sel.to).toBe(7);    // before **
  });

  it('unwraps when selection is already wrapped', () => {
    const view = createView('**hello** world', 2, 7); // select "hello" inside **
    mdWrap(view, '**', '**');
    expect(getDoc(view)).toBe('hello world');
  });

  it('wraps with single-char italic marker', () => {
    const view = createView('hello', 0, 5);
    mdWrap(view, '*', '*');
    expect(getDoc(view)).toBe('*hello*');
  });

  it('unwraps single-char italic marker', () => {
    const view = createView('*hello*', 1, 6); // select "hello" inside *
    mdWrap(view, '*', '*');
    expect(getDoc(view)).toBe('hello');
  });

  // --- Nesting tests (the polish 26 bug) ---

  it('nests italic inside bold: **text** → ***text***', () => {
    const view = createView('**hello**', 2, 7); // select "hello" inside **
    mdWrap(view, '*', '*');
    expect(getDoc(view)).toBe('***hello***');
  });

  it('nests bold inside italic: *text* → ***text***', () => {
    const view = createView('*hello*', 1, 6); // select "hello" inside *
    mdWrap(view, '**', '**');
    expect(getDoc(view)).toBe('***hello***');
  });

  it('removes italic from bold+italic: ***text*** → **text**', () => {
    const view = createView('***hello***', 3, 8); // select "hello" inside ***
    mdWrap(view, '*', '*');
    // Inner * detected as standalone (run=3, not 2) → unwraps
    expect(getDoc(view)).toBe('**hello**');
  });

  it('removes bold from bold+italic: ***text*** → *text*', () => {
    const view = createView('***hello***', 3, 8); // select "hello" inside ***
    mdWrap(view, '**', '**');
    expect(getDoc(view)).toBe('*hello*');
  });

  // --- Edge cases ---

  it('wraps empty selection (cursor) with markers', () => {
    const view = createView('hello', 2); // cursor at position 2
    mdWrap(view, '**', '**');
    expect(getDoc(view)).toBe('he****llo');
  });

  it('wraps with multi-char HTML markers', () => {
    const view = createView('hello', 0, 5);
    mdWrap(view, '<u>', '</u>');
    expect(getDoc(view)).toBe('<u>hello</u>');
  });

  it('unwraps multi-char HTML markers', () => {
    const view = createView('<u>hello</u>', 3, 8);
    mdWrap(view, '<u>', '</u>');
    expect(getDoc(view)).toBe('hello');
  });

  it('wraps strikethrough', () => {
    const view = createView('hello', 0, 5);
    mdWrap(view, '~~', '~~');
    expect(getDoc(view)).toBe('~~hello~~');
  });

  it('handles selection at document start', () => {
    const view = createView('hello', 0, 5);
    mdWrap(view, '**', '**');
    expect(getDoc(view)).toBe('**hello**');
  });

  it('handles selection at document end', () => {
    const view = createView('hello', 0, 5);
    mdWrap(view, '*', '*');
    expect(getDoc(view)).toBe('*hello*');
  });
});

// --- isWrapped tests ---

describe('isWrapped', () => {
  it('detects bold wrapper', () => {
    const view = createView('**hello**', 2, 7);
    expect(isWrapped(view, '**', '**')).toBe(true);
  });

  it('detects italic wrapper', () => {
    const view = createView('*hello*', 1, 6);
    expect(isWrapped(view, '*', '*')).toBe(true);
  });

  it('returns false when not wrapped', () => {
    const view = createView('hello world', 0, 5);
    expect(isWrapped(view, '**', '**')).toBe(false);
  });

  it('returns false for italic check when inside bold (submarker detection)', () => {
    // "**hello**" — cursor inside bold markers, checking for *
    // The * at positions 1 and 7 are part of **, not standalone italic
    const view = createView('**hello**', 2, 7);
    expect(isWrapped(view, '*', '*')).toBe(false);
  });

  it('detects italic inside bold+italic (***text***)', () => {
    const view = createView('***hello***', 3, 8);
    expect(isWrapped(view, '*', '*')).toBe(true);  // run=3, not 2
  });

  it('detects bold inside bold+italic (***text***)', () => {
    const view = createView('***hello***', 3, 8);
    expect(isWrapped(view, '**', '**')).toBe(true);
  });

  it('returns false when cursor between separate formatted regions (polish 29 false positive)', () => {
    // "Edit *Markdown* on the left" — selecting "the left"
    // There is a * before the selection (closing * of *Markdown*) and
    // no * after. isWrapped checks IMMEDIATELY adjacent chars.
    const doc = 'Edit *Markdown* on the left, or text. **Changes.**';
    const selStart = doc.indexOf('the left');
    const selEnd = selStart + 'the left'.length;
    const view = createView(doc, selStart, selEnd);
    expect(isWrapped(view, '*', '*')).toBe(false);
    expect(isWrapped(view, '**', '**')).toBe(false);
  });

  it('detects underline wrapper', () => {
    const view = createView('<u>hello</u>', 3, 8);
    expect(isWrapped(view, '<u>', '</u>')).toBe(true);
  });

  it('detects strikethrough wrapper', () => {
    const view = createView('~~hello~~', 2, 7);
    expect(isWrapped(view, '~~', '~~')).toBe(true);
  });

  it('returns false when selection is at document start (not enough room for marker)', () => {
    const view = createView('hello', 0, 5);
    expect(isWrapped(view, '**', '**')).toBe(false);
  });

  it('returns false when selection extends to document end (not enough room for marker)', () => {
    const view = createView('**hello', 2, 7);
    expect(isWrapped(view, '**', '**')).toBe(false);
  });
});

// --- Combined mdWrap + isWrapped consistency ---

describe('mdWrap + isWrapped consistency', () => {
  it('after wrapping, isWrapped returns true', () => {
    const view = createView('hello', 0, 5);
    expect(isWrapped(view, '**', '**')).toBe(false);
    mdWrap(view, '**', '**');
    expect(isWrapped(view, '**', '**')).toBe(true);
  });

  it('after unwrapping, isWrapped returns false', () => {
    const view = createView('**hello**', 2, 7);
    expect(isWrapped(view, '**', '**')).toBe(true);
    mdWrap(view, '**', '**');
    expect(isWrapped(view, '**', '**')).toBe(false);
  });

  it('bold then italic: both detected', () => {
    const view = createView('hello', 0, 5);
    mdWrap(view, '**', '**'); // → **hello**
    mdWrap(view, '*', '*');   // → ***hello***
    expect(isWrapped(view, '**', '**')).toBe(true);
    expect(isWrapped(view, '*', '*')).toBe(true);
  });

  it('remove italic from bold+italic: only bold detected', () => {
    const view = createView('***hello***', 3, 8);
    mdWrap(view, '*', '*'); // → **hello**
    expect(isWrapped(view, '**', '**')).toBe(true);
    expect(isWrapped(view, '*', '*')).toBe(false);
  });
});
