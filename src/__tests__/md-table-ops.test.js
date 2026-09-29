import { describe, it, expect } from 'vitest';
import {
  isPipeTableLine, isSeparatorLine, parsePipeRow, parseSeparator,
  findSeparatorLineIdx, renderTable, mdParseTableAtCursor,
  mdAddRowAfter, mdAddRowBefore, mdDeleteRow,
  mdAddColumnAfter, mdAddColumnBefore, mdDeleteColumn,
  mdDeleteTable,
} from '../formatting/md-table-ops';

// ---- Pure function tests (no CM6) ----

describe('isPipeTableLine', () => {
  it('matches valid pipe table rows', () => {
    expect(isPipeTableLine('| A | B |')).toBe(true);
    expect(isPipeTableLine('| --- | --- |')).toBe(true);
    expect(isPipeTableLine('|a|b|')).toBe(true);
  });

  it('rejects non-table lines', () => {
    expect(isPipeTableLine('Hello world')).toBe(false);
    expect(isPipeTableLine('| only one side')).toBe(false);
    expect(isPipeTableLine('||')).toBe(false);
    expect(isPipeTableLine('')).toBe(false);
  });
});

describe('isSeparatorLine', () => {
  it('matches separator patterns', () => {
    expect(isSeparatorLine('| --- | --- |')).toBe(true);
    expect(isSeparatorLine('| :---: | ---: |')).toBe(true);
    expect(isSeparatorLine('|---|---|')).toBe(true);
  });

  it('rejects data rows', () => {
    expect(isSeparatorLine('| Hello | World |')).toBe(false);
    expect(isSeparatorLine('| 123 | 456 |')).toBe(false);
  });
});

describe('parsePipeRow', () => {
  it('splits cells and trims', () => {
    expect(parsePipeRow('| A | B | C |')).toEqual(['A', 'B', 'C']);
    expect(parsePipeRow('|  hello  |  world  |')).toEqual(['hello', 'world']);
  });

  it('handles empty cells', () => {
    expect(parsePipeRow('|  |  |')).toEqual(['', '']);
  });
});

describe('parseSeparator', () => {
  it('detects left alignment (default)', () => {
    expect(parseSeparator('| --- | --- |')).toEqual(['', '']);
  });

  it('detects center alignment', () => {
    expect(parseSeparator('| :---: | --- |')).toEqual(['center', '']);
  });

  it('detects right alignment', () => {
    expect(parseSeparator('| --- | ---: |')).toEqual(['', 'right']);
  });

  it('handles mixed', () => {
    expect(parseSeparator('| --- | :---: | ---: |')).toEqual(['', 'center', 'right']);
  });
});

describe('findSeparatorLineIdx', () => {
  it('finds separator at index 1', () => {
    const lines = ['| A | B |', '| --- | --- |', '| 1 | 2 |'];
    expect(findSeparatorLineIdx(lines)).toBe(1);
  });

  it('returns -1 if no separator', () => {
    const lines = ['| A | B |', '| 1 | 2 |'];
    expect(findSeparatorLineIdx(lines)).toBe(-1);
  });
});

describe('renderTable', () => {
  it('renders a basic table', () => {
    const rows = [['A', 'B'], ['1', '2']];
    const alignments = ['', ''];
    const result = renderTable(rows, alignments);
    expect(result).toBe(
      '| A   | B   |\n' +
      '| --- | --- |\n' +
      '| 1   | 2   |'
    );
  });

  it('preserves alignments', () => {
    const rows = [['Name', 'Score'], ['Alice', '100']];
    const alignments = ['', 'right'];
    const result = renderTable(rows, alignments);
    expect(result).toContain('---:');
  });

  it('pads columns to widest cell', () => {
    const rows = [['Short', 'LongerHeader'], ['A', 'B']];
    const alignments = ['', ''];
    const result = renderTable(rows, alignments);
    const lines = result.split('\n');
    // All lines should have equal length
    expect(new Set(lines.map(l => l.length)).size).toBe(1);
  });

  it('handles center alignment in separator', () => {
    const rows = [['A', 'B'], ['1', '2']];
    const alignments = ['center', ''];
    const result = renderTable(rows, alignments);
    expect(result).toContain(':-:');
  });
});

// ---- CM6 integration tests ----
// These use a lightweight mock that satisfies mdParseTableAtCursor's API

function mockView(text, cursorOffset) {
  const lines = text.split('\n');
  const lineObjs = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    lineObjs.push({ number: i + 1, from: pos, to: pos + lines[i].length, text: lines[i] });
    pos += lines[i].length + 1; // +1 for \n
  }

  let currentText = text;
  const dispatched = [];

  const view = {
    state: {
      doc: {
        lineAt(p) {
          for (const l of lineObjs) {
            if (p >= l.from && p <= l.to) return l;
          }
          return lineObjs[lineObjs.length - 1];
        },
        line(n) { return lineObjs[n - 1]; },
        get lines() { return lineObjs.length; },
        get length() { return currentText.length; },
        sliceString(from, to) { return currentText.slice(from, to); },
      },
      selection: { main: { head: cursorOffset } },
    },
    dispatch(tr) {
      dispatched.push(tr);
      if (tr.changes) {
        const { from, to, insert } = tr.changes;
        currentText = currentText.slice(0, from) + insert + currentText.slice(to);
      }
    },
    getResult() { return currentText; },
    getDispatched() { return dispatched; },
  };
  return view;
}

describe('mdParseTableAtCursor', () => {
  it('parses a basic table', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const view = mockView(text, 1); // cursor in header
    const result = mdParseTableAtCursor(view);
    expect(result).not.toBeNull();
    expect(result.rows).toEqual([['A', 'B'], ['1', '2']]);
    expect(result.alignments).toEqual(['', '']);
  });

  it('returns null when cursor not in table', () => {
    const text = 'Just some text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    const view = mockView(text, 5); // cursor in "Just some text"
    expect(mdParseTableAtCursor(view)).toBeNull();
  });

  it('detects alignments', () => {
    const text = '| L | C | R |\n| --- | :---: | ---: |\n| a | b | c |';
    const view = mockView(text, 1);
    const result = mdParseTableAtCursor(view);
    expect(result.alignments).toEqual(['', 'center', 'right']);
  });
});

describe('mdAddRowAfter', () => {
  it('adds a row after cursor row', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const view = mockView(text, 25); // cursor in data row
    mdAddRowAfter(view);
    const result = view.getResult();
    const lines = result.split('\n');
    expect(lines.length).toBe(4);
    expect(lines[3]).toContain('|');
  });
});

describe('mdAddRowBefore', () => {
  it('inserts row before data row', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const view = mockView(text, 25); // cursor in data row
    mdAddRowBefore(view);
    const result = view.getResult();
    const lines = result.split('\n');
    expect(lines.length).toBe(4);
    // New row should be between separator and existing data
    expect(lines[2]).toMatch(/^\|.*\|$/);
  });
});

describe('mdDeleteRow', () => {
  it('deletes a data row', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const view = mockView(text, 25); // cursor in first data row
    mdDeleteRow(view);
    const result = view.getResult();
    expect(result).toContain('3');
    expect(result).not.toContain('1 ');
  });
});

describe('mdAddColumnAfter', () => {
  it('adds a column to all rows', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const view = mockView(text, 1);
    mdAddColumnAfter(view);
    const result = view.getResult();
    const lines = result.split('\n');
    // Each line should have 3 columns (4 pipes)
    for (const line of lines) {
      expect((line.match(/\|/g) || []).length).toBe(4);
    }
  });
});

/**
 * `mdAddColumnBefore` was imported by this file and never called once — the only
 * such case in the suite, and it is wired to a live menu item (Table ▸ Insert
 * column before, and the same entry in the right-click menu). The
 * `mdAddColumnAfter` case beside it counted PIPES, which is the one property
 * before and after share, so it would have passed just as well against the wrong
 * function. These assert WHERE the column lands.
 */
function headerCells(result) {
  return parsePipeRow(result.split('\n')[0]);
}
function separatorCells(result) {
  return parsePipeRow(result.split('\n')[1]);
}

describe('mdAddColumnBefore', () => {
  it('inserts the empty column to the LEFT of the cursor column', () => {
    const text = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    const view = mockView(text, 6); // inside cell B → col 1
    mdAddColumnBefore(view);
    const result = view.getResult();
    expect(headerCells(result)).toEqual(['A', '', 'B', 'C']);
    expect(parsePipeRow(result.split('\n')[2])).toEqual(['1', '', '2', '3']);
  });

  it('can insert at the very start of the table', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const view = mockView(text, 1); // col 0
    mdAddColumnBefore(view);
    expect(headerCells(view.getResult())).toEqual(['', 'A', 'B']);
  });

  it('shifts the alignments with the columns rather than the cell text alone', () => {
    // The separator carries per-column alignment; splicing the cells without
    // splicing `alignments` re-points every alignment one column to the left.
    // (`:---` explicit-left is normalised away by parseSeparator — left is GFM's
    // default, so the rendered table is unchanged. center and right are the two
    // that carry meaning.)
    const text = '| A | B |\n| :---: | ---: |\n| 1 | 2 |';
    const view = mockView(text, 1); // col 0
    mdAddColumnBefore(view);
    const sep = separatorCells(view.getResult());
    expect(sep).toHaveLength(3);
    expect(sep[0]).toBe('---');                                   // the new column
    expect(sep[1].startsWith(':') && sep[1].endsWith(':')).toBe(true); // A stays centred
    expect(sep[2].endsWith(':') && !sep[2].startsWith(':')).toBe(true); // B stays right
  });

  it('is a no-op when the cursor is not in a table', () => {
    const view = mockView('Just prose', 3);
    mdAddColumnBefore(view);
    expect(view.getDispatched().length).toBe(0);
  });
});

describe('mdAddColumnAfter (placement)', () => {
  it('inserts the empty column to the RIGHT of the cursor column', () => {
    const text = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    const view = mockView(text, 6); // inside cell B → col 1
    mdAddColumnAfter(view);
    const result = view.getResult();
    expect(headerCells(result)).toEqual(['A', 'B', '', 'C']);
    expect(parsePipeRow(result.split('\n')[2])).toEqual(['1', '2', '', '3']);
  });
});

describe('mdDeleteColumn', () => {
  it('removes a column from all rows', () => {
    const text = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    const view = mockView(text, 1); // cursor in col 0
    mdDeleteColumn(view);
    const result = view.getResult();
    const lines = result.split('\n');
    // Should have 2 columns now
    for (const line of lines) {
      expect((line.match(/\|/g) || []).length).toBe(3);
    }
  });
});

describe('mdDeleteTable', () => {
  it('removes the entire table', () => {
    const text = 'Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter';
    // Cursor on the header line: "| A | B |" starts at position 8
    const view = mockView(text, 9);
    mdDeleteTable(view);
    const result = view.getResult();
    expect(result).not.toContain('| A');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });
});

describe('no-op when cursor not in table', () => {
  it('mdAddRowAfter is no-op', () => {
    const text = 'Just text';
    const view = mockView(text, 3);
    mdAddRowAfter(view);
    expect(view.getDispatched().length).toBe(0);
  });

  it('mdDeleteColumn is no-op', () => {
    const text = 'No table here';
    const view = mockView(text, 3);
    mdDeleteColumn(view);
    expect(view.getDispatched().length).toBe(0);
  });
});
