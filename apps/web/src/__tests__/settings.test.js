import { describe, expect, it } from 'vitest';
import {
  applyFlavor,
  DEFAULT_MARKDOWN_FEATURES,
  FLAVOR_PRESETS,
  normalizeMarkdownFeatures,
} from '../store/settings.ts';

describe('markdown settings', () => {
  it('applyFlavor sets flavor + its preset toggles, keeps rich flags', () => {
    const start = { ...DEFAULT_MARKDOWN_FEATURES, math: false, tables: true };
    const cm = applyFlavor(start, 'commonmark');
    expect(cm.flavor).toBe('commonmark');
    expect(cm.tables).toBe(false); // preset turns tables off
    expect(cm.math).toBe(false); // rich flag preserved
    const extra = applyFlavor(cm, 'markdown-extra');
    expect(extra.footnotes).toBe(true);
    expect(extra.tables).toBe(true);
  });

  it('presets differ as expected', () => {
    expect(FLAVOR_PRESETS.commonmark.tables).toBe(false);
    expect(FLAVOR_PRESETS.gfm.tables).toBe(true);
    expect(FLAVOR_PRESETS.gfm.footnotes).toBe(false);
    expect(FLAVOR_PRESETS['markdown-extra'].footnotes).toBe(true);
  });

  it('normalizeMarkdownFeatures fills defaults and tolerates junk', () => {
    expect(normalizeMarkdownFeatures(null)).toEqual(DEFAULT_MARKDOWN_FEATURES);
    expect(normalizeMarkdownFeatures('nope')).toEqual(DEFAULT_MARKDOWN_FEATURES);
    const partial = normalizeMarkdownFeatures({ math: false });
    expect(partial.math).toBe(false);
    expect(partial.flavor).toBe(DEFAULT_MARKDOWN_FEATURES.flavor);
  });
});
