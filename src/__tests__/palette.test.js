import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyPalette,
  DEFAULT_PALETTE,
  getStoredPalette,
  PALETTES,
  sanitizeCssColor,
  setPalette,
} from '../theme/palette.ts';

describe('sanitizeCssColor', () => {
  it('accepts safe color forms', () => {
    expect(sanitizeCssColor('#fff')).toBe('#fff');
    expect(sanitizeCssColor('#a1b2c3')).toBe('#a1b2c3');
    expect(sanitizeCssColor('rebeccapurple')).toBe('rebeccapurple');
    expect(sanitizeCssColor('transparent')).toBe('transparent');
    expect(sanitizeCssColor('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)');
    expect(sanitizeCssColor('hsl(200 50% 40% / 0.5)')).toBe('hsl(200 50% 40% / 0.5)');
    expect(sanitizeCssColor('  #fff  ')).toBe('#fff');
  });

  it('rejects url()/expression()/var() beacons and declaration breakouts', () => {
    expect(sanitizeCssColor('url(https://evil/pixel)')).toBeUndefined();
    expect(sanitizeCssColor('red;background:url(//evil)')).toBeUndefined();
    expect(sanitizeCssColor('expression(alert(1))')).toBeUndefined();
    expect(sanitizeCssColor('var(--x)')).toBeUndefined();
    expect(sanitizeCssColor('rgb(0,0,0);}body{display:none')).toBeUndefined();
    expect(sanitizeCssColor('image-set(x)')).toBeUndefined();
    expect(sanitizeCssColor('')).toBeUndefined();
    expect(sanitizeCssColor(null)).toBeUndefined();
    expect(sanitizeCssColor('a'.repeat(100))).toBeUndefined();
  });
});

describe('accent palette', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
  });

  it('defaults to amber when nothing stored / invalid', () => {
    expect(getStoredPalette()).toBe(DEFAULT_PALETTE);
    localStorage.setItem('perssonify-palette', 'not-a-palette');
    expect(getStoredPalette()).toBe(DEFAULT_PALETTE);
  });

  it('setPalette persists and applies the data attribute', () => {
    const target = PALETTES.find((p) => p.id !== DEFAULT_PALETTE);
    setPalette(target.id);
    expect(getStoredPalette()).toBe(target.id);
    expect(document.documentElement.getAttribute('data-palette')).toBe(target.id);
  });

  it('includes the mono option (black in light / white in dark)', () => {
    expect(PALETTES.some((p) => p.id === 'mono')).toBe(true);
    setPalette('mono');
    expect(document.documentElement.getAttribute('data-palette')).toBe('mono');
  });

  it('applyPalette sets the attribute without persisting', () => {
    applyPalette('violet');
    expect(document.documentElement.getAttribute('data-palette')).toBe('violet');
    expect(localStorage.getItem('perssonify-palette')).toBeNull();
  });
});
