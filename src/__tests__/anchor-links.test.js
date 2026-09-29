import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { preprocessMarkdown } from '../engine/preprocessor.ts';
import { cleanHtmlForTurndown } from '../engine/html-cleaner.ts';
import { addBaseRules } from '../engine/turndown-rules.ts';

const pre = (md) => preprocessMarkdown(md, { wikiLinks: true });

function htmlToMd(html) {
  const td = new TurndownService({ headingStyle: 'atx', emDelimiter: '*' });
  addBaseRules(td);
  return td.turndown(cleanHtmlForTurndown(html));
}

// Round-trips markdown → html → markdown through the wiki-link/anchor path.
const roundTrip = (md) => htmlToMd(pre(md));

describe('heading anchor links', () => {
  it('parses a cross-document heading anchor', () => {
    const html = pre('See [[Guide#Setup]] first');
    expect(html).toContain('data-doc-link="Guide"');
    expect(html).toContain('data-anchor="Setup"');
  });

  it('parses a same-document heading anchor (empty target)', () => {
    const html = pre('Jump to [[#Overview]]');
    expect(html).toContain('data-doc-link=""');
    expect(html).toContain('data-anchor="Overview"');
  });

  it('supports a custom display label', () => {
    const html = pre('[[Guide#Setup|installation steps]]');
    expect(html).toContain('data-doc-link="Guide"');
    expect(html).toContain('data-anchor="Setup"');
    expect(html).toContain('>installation steps<');
  });

  it('leaves a plain document wiki link unchanged (no anchor attr)', () => {
    const html = pre('[[Guide]]');
    expect(html).toContain('data-doc-link="Guide"');
    expect(html).not.toContain('data-anchor');
  });

  it('round-trips a cross-document anchor', () => {
    expect(roundTrip('[[Guide#Setup]]').trim()).toBe('[[Guide#Setup]]');
  });

  it('round-trips a same-document anchor', () => {
    expect(roundTrip('[[#Overview]]').trim()).toBe('[[#Overview]]');
  });

  it('round-trips an anchor with a custom label', () => {
    expect(roundTrip('[[Guide#Setup|installation]]').trim()).toBe('[[Guide#Setup|installation]]');
  });

  it('round-trips a plain document link', () => {
    expect(roundTrip('[[Guide]]').trim()).toBe('[[Guide]]');
  });
});
