// Canonical (ProseMirror JSON) builders for the stress shapes. Each takes a
// rough size in KB so a case can say "50KB of tables" without hand-writing one.
const P = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const H = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

const LOREM =
  "Perssonify builds custom technology solutions for teams that need to move fast without breaking things: applications, AI integrations, and automation systems.";

const doc = (id, title, content) => ({ id, title, canonical: { type: "doc", content } });

/** Plain prose — the baseline shape every measurement is compared against. */
export function proseDoc(id, title, kb) {
  const content = [H(1, title)];
  for (let b = 0; b < kb * 1024; b += LOREM.length) content.push(P(LOREM));
  return doc(id, title, content);
}

/**
 * A document whose every line is UNIQUE and self-describing (`LINE0001` …).
 * Used to verify the harness's own markdown-pane reader: with the source known
 * exactly, "did it recover the whole document, once each" is decidable.
 */
export function numberedDoc(id, title, lines) {
  const content = [H(1, title)];
  for (let i = 1; i <= lines; i++) {
    // The body is long enough to WRAP at a normal viewport width: wrapped lines
    // are where CodeMirror's height estimates are worst, and estimate drift is
    // what the reader has to survive. A document of short uniform lines does not
    // exercise it.
    content.push(P(`LINE${String(i).padStart(4, "0")} ${LOREM} ${LOREM}`));
  }
  return doc(id, title, content);
}

/**
 * A large document of EVERY common shape — headings, marked-up prose, hard
 * breaks, bullet / ordered / task lists, code, quotes, tables, rules — in
 * roughly `kb` KB of markdown. What a real long document looks like to the
 * converters, where prose alone flatters them (A083).
 */
export function mixedDoc(id, title, kb) {
  const t = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
  const li = (text) => ({ type: "listItem", content: [P(text)] });
  const cell = (text, header) => ({
    type: header ? "tableHeader" : "tableCell",
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [P(text)],
  });
  const shapes = [
    (i) => H(2, `Section ${i}`),
    (i) => ({ type: "paragraph", content: [
      t(`${LOREM} Item ${i} has `), t("bold", [{ type: "bold" }]), t(", "), t("italic", [{ type: "italic" }]),
      t(", "), t(`code ${i}`, [{ type: "code" }]), t(" and a "),
      t("link", [{ type: "link", attrs: { href: `https://example.com/${i}`, target: "_blank" } }]), t("."),
    ] }),
    (i) => ({ type: "bulletList", content: [li(`First point ${i}`), {
      type: "listItem", content: [P("Second point"), { type: "bulletList", content: [li(`nested ${i}`)] }],
    }, li("Third point")] }),
    (i) => ({ type: "paragraph", content: [t(`Line one of ${i}`), { type: "hardBreak" }, t("line two after a hard break")] }),
    // A code block in one cycle of four: each is a React node view, and opening
    // a document mounts them one by one, each forcing a layout of the whole
    // editor (quadratic — see e2e/cases/perf.mjs). Denser, and a 4 MB fixture
    // measures that instead of what the case is for.
    (i) => (i % 48 === 4
      ? { type: "codeBlock", attrs: { language: "js" }, content: [t(`const value${i} = ${i};\n\nconsole.log(value${i});`)] }
      : P(`Plain paragraph ${i}: ${LOREM}`)),
    (i) => ({ type: "orderedList", attrs: { start: 1 }, content: [li(`one ${i}`), li("two"), li("three")] }),
    (i) => ({ type: "blockquote", content: [P(`Quoted ${i}: ${LOREM}`)] }),
    (i) => ({ type: "table", content: [
      { type: "tableRow", content: [cell("Name", true), cell("Value", true), cell("Note", true)] },
      { type: "tableRow", content: [cell(`row ${i}`), cell(String(i)), cell("ok")] },
      { type: "tableRow", content: [cell("second"), cell("2"), cell("fine")] },
    ] }),
    (i) => ({ type: "taskList", content: [
      { type: "taskItem", attrs: { checked: false }, content: [P(`Open task ${i}`)] },
      { type: "taskItem", attrs: { checked: true }, content: [P("Done task")] },
    ] }),
    () => P(`${LOREM} ${LOREM}`),
    (i) => H(3, `Subsection ${i}`),
    () => ({ type: "horizontalRule" }),
  ];
  const content = [H(1, title)];
  let bytes = 0;
  for (let i = 0; bytes < kb * 1024; i++) {
    const node = shapes[i % shapes.length](i);
    content.push(node);
    bytes += JSON.stringify(node).length / 3.8; // ≈ its markdown, measured on this mix
  }
  content.push(P("The end."));
  return doc(id, title, content);
}

/** Prose broken up by headings — exercises the split-pane anchor mapping. */
export function sectionedDoc(id, title, kb) {
  const content = [H(1, title)];
  let bytes = 0, n = 0;
  while (bytes < kb * 1024) {
    content.push(H(2, `Section ${++n}`));
    for (let i = 0; i < 4; i++) { content.push(P(LOREM)); bytes += LOREM.length; }
  }
  return doc(id, title, content);
}

/** A wide table — the shape where turndown and the PM table schema cost most. */
export function tableDoc(id, title, rows, cols = 5) {
  const cell = (text, header) => ({
    type: header ? "tableHeader" : "tableCell",
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [P(text)],
  });
  const content = [H(1, title), {
    type: "table",
    content: [
      { type: "tableRow", content: Array.from({ length: cols }, (_, c) => cell(`Column ${c + 1}`, true)) },
      ...Array.from({ length: rows }, (_, r) => ({
        type: "tableRow",
        content: Array.from({ length: cols }, (_, c) => cell(`r${r + 1}c${c + 1}`, false)),
      })),
    ],
  }];
  return doc(id, title, content);
}

/** Many fenced blocks — the masking passes in normalizeMarkdown run per block. */
export function fenceDoc(id, title, blocks) {
  const content = [H(1, title)];
  for (let i = 0; i < blocks; i++) {
    content.push(P(`Example ${i + 1}`));
    content.push({
      type: "codeBlock",
      attrs: { language: "js" },
      content: [{ type: "text", text: `const value${i} = ${i};\n\nexport default value${i};` }],
    });
  }
  return doc(id, title, content);
}

/** Deeply nested lists — recursion depth in both serializers. */
export function nestedListDoc(id, title, depth, breadth = 3) {
  const item = (level, idx) => {
    const kids = [P(`level ${level} item ${idx}`)];
    if (level < depth) {
      kids.push({
        type: "bulletList",
        content: Array.from({ length: breadth }, (_, i) => item(level + 1, i + 1)),
      });
    }
    return { type: "listItem", content: kids };
  };
  return doc(id, title, [H(1, title), {
    type: "bulletList",
    content: Array.from({ length: breadth }, (_, i) => item(1, i + 1)),
  }]);
}

/** Many inline links — the mark-heavy shape the link index walks. */
export function linkDoc(id, title, count) {
  const content = [H(1, title)];
  for (let i = 0; i < count; i += 10) {
    content.push({
      type: "paragraph",
      content: Array.from({ length: 10 }, (_, j) => ([
        { type: "text", text: " see " },
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: `https://example.com/${i + j}`, target: "_blank" } }],
          text: `link ${i + j}`,
        },
      ])).flat(),
    });
  }
  return doc(id, title, content);
}

/**
 * A small library of cross-linked documents — the graph / link-index shape.
 *
 * The links are LITERAL `[[wiki links]]` in text, not rendered link marks:
 * `scanWikiLinks` reads both forms, and a hand-built mark has to match the live
 * schema's attribute names exactly or it resolves to nothing. A seeded library
 * whose links silently do not resolve puts the map into its zero-edge mode —
 * chips instead of nodes — which looks like a broken graph and is really a
 * broken fixture.
 */
export function library(n, { kb = 2 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const id = `e2e-doc-${i + 1}`;
    const title = `Note ${i + 1}`;
    const d = proseDoc(id, title, kb);
    // A ring plus a hub, so the graph has both a cycle and a high-degree node.
    const targets = [];
    if (i > 0) targets.push(`Note ${i}`);
    if (i !== 0) targets.push("Note 1");
    if (targets.length) {
      d.canonical.content.push(P(`See ${targets.map((t) => `[[${t}]]`).join(" and ")}.`));
    }
    return d;
  });
}
