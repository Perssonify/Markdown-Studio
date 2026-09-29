import { describe, expect, it } from 'vitest';
import { exportTimestamp, sanitizeFilename } from '../store/import-export.ts';

describe('exportTimestamp', () => {
  it('formats a date as YYYYMMDD-HHMMSSmmm (zero-padded)', () => {
    // 2026-08-04 09:07:05.042 local
    const d = new Date(2026, 7, 4, 9, 7, 5, 42);
    expect(exportTimestamp(d)).toBe('20260804-090705042');
  });

  it('pads all fields to fixed widths', () => {
    const d = new Date(2026, 0, 1, 0, 0, 0, 0);
    const ts = exportTimestamp(d);
    expect(ts).toBe('20260101-000000000');
    expect(ts).toMatch(/^\d{8}-\d{9}$/);
  });

  it('is lexicographically sortable in chronological order', () => {
    const a = exportTimestamp(new Date(2026, 0, 1, 0, 0, 0, 0));
    const b = exportTimestamp(new Date(2026, 0, 1, 0, 0, 0, 1));
    const c = exportTimestamp(new Date(2026, 0, 1, 0, 0, 1, 0));
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });
});

describe('sanitizeFilename', () => {
  it('strips filesystem-hostile characters and lowercases', () => {
    // hostile chars are removed first, then remaining whitespace → dashes
    expect(sanitizeFilename('My Report v2')).toBe('my-report-v2');
    expect(sanitizeFilename('My: Report/v2*')).toBe('my-reportv2');
  });
  it('falls back to untitled for empty input', () => {
    expect(sanitizeFilename('')).toBe('untitled');
  });
});
