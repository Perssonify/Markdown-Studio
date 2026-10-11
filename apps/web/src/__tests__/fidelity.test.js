import { describe, it, expect } from 'vitest';
import { computeFidelity } from '../store/documents/fidelity';

// --- PM JSON builders ---

function pmDoc(...content) {
  return { type: "doc", content };
}

function pmParagraph(text, marks = []) {
  const node = { type: "paragraph", content: [{ type: "text", text }] };
  if (marks.length) node.content[0].marks = marks;
  return node;
}

function pmParagraphAligned(text, align) {
  return { type: "paragraph", attrs: { textAlign: align }, content: [{ type: "text", text }] };
}

// --- Tests ---

describe('computeFidelity', () => {
  it('reports lossless for null/empty canonical', () => {
    expect(computeFidelity(null).lossless).toBe(true);
    expect(computeFidelity(null).losses).toEqual([]);
  });

  it('reports lossless for native markdown marks', () => {
    const canonical = pmDoc(
      pmParagraph('hello', [{ type: 'bold' }]),
      pmParagraph('world', [{ type: 'italic' }]),
      pmParagraph('code', [{ type: 'code' }]),
      pmParagraph('struck', [{ type: 'strike' }]),
      pmParagraph('linked', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
    );
    const report = computeFidelity(canonical, 'clean');
    expect(report.lossless).toBe(true);
  });

  it('reports loss for textStyle color in clean mode', () => {
    const canonical = pmDoc(
      pmParagraph('colored', [{ type: 'textStyle', attrs: { color: '#ff0000' } }])
    );
    const report = computeFidelity(canonical, 'clean');
    expect(report.lossless).toBe(false);
    expect(report.losses.length).toBe(1);
    expect(report.losses[0].type).toBe('textStyle');
    expect(report.summary).toContain('color');
  });

  it('reports lossless for textStyle in styled mode', () => {
    const canonical = pmDoc(
      pmParagraph('colored', [{ type: 'textStyle', attrs: { color: '#ff0000' } }])
    );
    const report = computeFidelity(canonical, 'styled');
    expect(report.lossless).toBe(true);
  });

  // This case used to assert `lossless === false` in clean mode, pinning a FALSE
  // POSITIVE. Underline, subscript and superscript are serialized by rules in
  // `addBaseRules` — which BOTH turndown instances receive — so Clean keeps
  // `<u>`/`<sub>`/`<sup>` exactly as Styled does. Measured in
  // `clean-vs-styled.test.js`. Only the `<span style="…">` carrier
  // (`addInlineStyleRule`) is mode-dependent, which is what the textStyle cases
  // above cover.
  it('reports underline, subscript and superscript lossless in BOTH modes', () => {
    for (const mark of ['underline', 'subscript', 'superscript']) {
      const canonical = pmDoc(pmParagraph('x', [{ type: mark }]));
      for (const mode of ['clean', 'styled']) {
        expect(computeFidelity(canonical, mode).lossless, `${mark} / ${mode}`).toBe(true);
      }
    }
  });

  // Likewise: a sized image round-trips through the `sizedImage` rule as
  // `<img … width="…">`, so its dimensions are not a loss. Counting them made
  // the shipped Welcome document — which has one sized logo — open with an
  // amber warning about formatting that survives intact.
  it('does not report a sized image as a loss', () => {
    const canonical = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'a.png', width: 84, height: 40 } }] }],
    };
    for (const mode of ['clean', 'styled']) {
      expect(computeFidelity(canonical, mode).lossless, mode).toBe(true);
    }
  });

  it('reports alignment losses', () => {
    const canonical = pmDoc(pmParagraphAligned('centered', 'center'));
    const report = computeFidelity(canonical, 'clean');
    expect(report.lossless).toBe(false);
    expect(report.summary).toContain('alignment');
  });

  it('does not report left alignment as loss', () => {
    const canonical = pmDoc(pmParagraphAligned('normal', 'left'));
    expect(computeFidelity(canonical, 'clean').lossless).toBe(true);
  });

  it('counts duplicate marks', () => {
    const canonical = pmDoc(
      pmParagraph('a', [{ type: 'highlight', attrs: { color: '#ff0' } }]),
      pmParagraph('b', [{ type: 'highlight', attrs: { color: '#ff0' } }]),
    );
    const report = computeFidelity(canonical, 'clean');
    expect(report.totalLossCount).toBe(2);
    expect(report.losses.length).toBe(1); // deduplicated, count=2
    expect(report.losses[0].count).toBe(2);
  });

  it('produces summary with multiple loss types', () => {
    const canonical = pmDoc(
      pmParagraph('colored', [{ type: 'textStyle', attrs: { color: '#f00' } }]),
      pmParagraph('fonted', [{ type: 'textStyle', attrs: { fontFamily: 'Arial' } }]),
      pmParagraphAligned('centered', 'center'),
    );
    const report = computeFidelity(canonical, 'clean');
    expect(report.summary).toContain('color');
    expect(report.summary).toContain('font');
    expect(report.summary).toContain('alignment');
    expect(report.summary).toContain('not in MD');
  });
});
