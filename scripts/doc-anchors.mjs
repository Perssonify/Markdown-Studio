/**
 * Documentation line-number anchors: check them, and repair them.
 *
 * The docs link into the source with `…/src/x.ts#L123` anchors. A line number is
 * the most useful and the most perishable thing a document can carry: every
 * insertion above it moves it, silently, and a reader who follows one lands in
 * the middle of an unrelated function and concludes the document is wrong about
 * more than the number. Measured before this existed, 72 of 171 anchors had
 * drifted off their subject.
 *
 * The rule is deterministic, so it can be enforced rather than reviewed. Each
 * anchor is credited to the last backticked identifier before it on the same
 * markdown line — that is what the sentence is pointing at — and the anchor must
 * land within WINDOW lines of it. `--fix` re-points the anchor at the best
 * definition of that identifier.
 *
 * Anchors with no identifier to check against are left alone (they point at a
 * region, not a symbol); an identifier that does not appear in the file AT ALL
 * is reported and never auto-fixed, because that is a documentation error a
 * number cannot repair.
 *
 *   node scripts/doc-anchors.mjs          # report
 *   node scripts/doc-anchors.mjs --fix    # repair what can be repaired
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** How far from the named symbol an anchor may land and still be "on" it. */
export const WINDOW = 5;

const DOC_FILES = () =>
  [
    ...fs.readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`),
    "CLAUDE.md",
    "README.md",
  ].filter((f) => fs.existsSync(path.join(ROOT, f)));

const LINK = /\[([^\]]*)\]\((?:\.\.\/)?((?:src|api|e2e|build|scripts)\/[^)#\s]+)#L(\d+)\)/g;
// `ingest()` names a function as surely as `ingest` does — the trailing call
// parens are prose, not part of the identifier.
const IDENT = /`([A-Za-z_$][\w$.]*)(?:\(\))?`/g;

/** Every anchor in a markdown file, with the identifier it is credited to. */
export function anchorsIn(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(LINK)) {
      const before = line.slice(0, m.index);
      const idents = [...before.matchAll(IDENT)].map((x) => x[1]);
      out.push({
        row: i + 1,
        label: m[1],
        file: m[2],
        line: Number(m[3]),
        // Every identifier before the link, nearest first. The nearest one is
        // usually the subject, but a sentence often names several across
        // different files ("the `_unsavedEdits` Map in `useDocumentStore`
        // (…documentStore.ts#L71)"), so the checker credits the nearest one
        // that actually occurs in the file being linked.
        idents: idents.reverse().map((x) => x.split(".").pop()),
        match: m[0],
      });
    }
  });
  return out;
}

/**
 * Where a symbol lives in a file: `{ line, tier }`.
 *
 * Tier 1–3 are DEFINITIONS (an export, a declaration, a class or object
 * member) — a line number there is a fact, and stays one until the definition
 * itself moves. Tier 4 is a mere mention, which is where false precision comes
 * from: `pmjson` occurs a dozen times in ingest.ts and "the first one" is not
 * what any sentence means. Callers keep a number for a definition and drop it
 * for a mention. `{ line: 0 }` means the symbol is not in the file at all.
 */
export function defineLine(source, name) {
  const lines = source.split("\n");
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tiers = [
    new RegExp(`^\\s*export\\s+(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${esc}\\b`),
    new RegExp(`^\\s*(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${esc}\\b`),
    new RegExp(`^\\s*(?:readonly\\s+|private\\s+|public\\s+)*${esc}\\s*[:(]`),
    new RegExp(`\\b${esc}\\b`),
  ];
  // Import statements and comment lines mention a symbol without being about
  // it — pointing a reader at `import { quickHash } from …` is worse than the
  // stale number it replaced.
  const noise = (l) => /^\s*(?:import\b|export\s+\{|\}\s*from\b|\/\/|\*|\/\*)/.test(l);
  for (let t = 0; t < tiers.length; t++) {
    const i = lines.findIndex((l) => tiers[t].test(l) && !noise(l));
    if (i >= 0) return { line: i + 1, tier: t + 1 };
  }
  return { line: 0, tier: 0 };
}

/** Check every anchor. Returns { drift, missing, unresolved, total }. */
export function audit(root = ROOT) {
  const drift = [], missing = [], unresolved = [];
  let total = 0;
  for (const doc of DOC_FILES()) {
    const text = fs.readFileSync(path.join(root, doc), "utf8");
    for (const a of anchorsIn(text)) {
      total++;
      const src = path.join(root, a.file);
      if (!fs.existsSync(src)) { missing.push({ doc, ...a }); continue; }
      if (!a.idents.length) continue;
      const source = fs.readFileSync(src, "utf8");
      const lines = source.split("\n");
      const ident = a.idents.find((n) => defineLine(source, n).line > 0);
      if (!ident) { unresolved.push({ doc, ...a }); continue; }
      const { line: at, tier } = defineLine(source, ident);
      // Accept any landing within WINDOW of ANY occurrence of the identifier —
      // a doc may legitimately point at a call site rather than the definition.
      const esc = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${esc}\\b`);
      const near = lines
        .slice(Math.max(0, a.line - 1 - WINDOW), a.line + WINDOW)
        .some((l) => re.test(l));
      if (!near) drift.push({ doc, ...a, ident, should: at, tier });
    }
  }
  return { drift, missing, unresolved, total };
}

/** Re-point drifted anchors at their symbol's definition. Returns the count. */
export function fix(root = ROOT) {
  const { drift } = audit(root);
  const byDoc = new Map();
  for (const d of drift) {
    if (!byDoc.has(d.doc)) byDoc.set(d.doc, []);
    byDoc.get(d.doc).push(d);
  }
  let n = 0;
  for (const [doc, items] of byDoc) {
    const p = path.join(root, doc);
    const lines = fs.readFileSync(p, "utf8").split("\n");
    for (const d of items) {
      const row = lines[d.row - 1];
      // The VISIBLE label usually repeats the number ("src/x.ts:43", or a bare
      // ":43" for a second reference into the same file). Rewriting only the
      // href would leave the document showing one line and linking to another —
      // a worse state than the drift being repaired.
      const href = d.match.slice(d.match.indexOf("](") + 2, -1);
      let next;
      if (d.tier <= 3) {
        const label = d.label.replace(/:(\d+)$/, `:${d.should}`);
        next = `[${label}](${href.replace(/#L\d+$/, `#L${d.should}`)})`;
      } else {
        // A mention, not a definition: link the FILE and let the reader search
        // the name the sentence already gives them. Inventing a line number
        // here trades a stale fact for a confident guess.
        const label = d.label.replace(/:\d+$/, "").replace(/^:\d+$/, "");
        next = label
          ? `[${label}](${href.replace(/#L\d+$/, "")})`
          : `[${d.file}](${href.replace(/#L\d+$/, "")})`;
      }
      if (row.includes(d.match)) {
        lines[d.row - 1] = row.replace(d.match, next);
        n++;
      }
    }
    fs.writeFileSync(p, lines.join("\n"));
  }
  return n;
}

// Compared as paths, not URLs: on Windows `import.meta.url` is
// `file:///C:/…` while argv[1] is `C:\…`, so a string comparison never matched
// and the script exited 0 having checked and repaired nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes("--fix")) {
    const n = fix();
    console.log(`repaired ${n} anchor(s)`);
  }
  const { drift, missing, unresolved, total } = audit();
  console.log(`${total} anchors checked`);
  for (const m of missing) console.log(`MISSING FILE  ${m.doc}:${m.row} → ${m.file}`);
  for (const u of unresolved) console.log(`NO SUCH SYMBOL  ${u.doc}:${u.row} → none of ${u.idents.map((i) => "`" + i + "`").join(", ")} is in ${u.file}`);
  for (const d of drift)
    console.log(
      d.tier <= 3
        ? `DRIFTED  ${d.doc}:${d.row} → ${d.file}#L${d.line} (\`${d.ident}\` is defined at L${d.should})`
        : `UNPINNABLE  ${d.doc}:${d.row} → ${d.file}#L${d.line} (\`${d.ident}\` is only mentioned there — drop the line number)`
    );
  process.exit(drift.length + missing.length + unresolved.length ? 1 : 0);
}
