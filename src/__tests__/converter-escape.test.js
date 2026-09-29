/**
 * Literal text must stay literal across projections (A040), styled spans must
 * stay well-formed (A042), and maths must not be found where there is none
 * (A049) — nor lost where there is. Round trips go through the real engine and
 * schema (converter-harness.js).
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { escapeMarkdownText } from "../engine/turndown-rules";
import { engineFor, htmlRoundTrip, roundTrip } from "./converter-harness";

/** Every node type in a PM JSON tree. */
const typesIn = (json) => {
  const out = new Set();
  const walk = (n) => {
    if (!n) return;
    out.add(n.type);
    for (const m of n.marks ?? []) out.add(`mark:${m.type}`);
    (n.content ?? []).forEach(walk);
  };
  walk(json);
  return out;
};
const textOf = (json) => {
  let s = "";
  const walk = (n) => {
    if (n.type === "text") s += n.text;
    if (n.type === "hardBreak") s += "\n";
    (n.content ?? []).forEach(walk);
  };
  walk(json);
  return s;
};

/** The rich content must be identical after the second trip (nothing turned into markup). */
function expectStableLiteral(md, opts) {
  const r = roundTrip(md, opts);
  expect(r.md2, "markdown keeps drifting").toBe(r.md1);
  expect(r.json2, "the rich content changed on the second trip").toEqual(r.json1);
  return r;
}

describe("A040 — literal characters do not become live markup", () => {
  it("keeps an escaped tag as text, not a line break or a Details node", () => {
    const r = expectStableLiteral("Use &lt;br&gt; for a break and &lt;details&gt; too");
    expect(textOf(r.json2)).toBe("Use <br> for a break and <details> too");
    expect(typesIn(r.json2).has("hardBreak")).toBe(false);
    expect(typesIn(r.json2).has("details")).toBe(false);
  });

  it("keeps text typed in the rich pane about an element as text", () => {
    const r = htmlRoundTrip("<p>use the &lt;details&gt; element</p>");
    expect(r.md1).toBe("use the \\<details> element");
    expect(typesIn(r.json2).has("details")).toBe(false);
    expect(textOf(r.json2)).toBe("use the <details> element");
  });

  it("never turns quoted HTML into real markup in the markdown a host is handed", () => {
    const quoted = '<p>&lt;img src=x onerror=alert(1)&gt; and &lt;div class="fixed inset-0"&gt;</p>';
    const r = htmlRoundTrip(quoted);
    const html = engineFor().mdToHtml(r.md1);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<div class/i);
    expect(textOf(r.json2)).toBe('<img src=x onerror=alert(1)> and <div class="fixed inset-0">');
  });

  it("keeps a literal character reference literal", () => {
    const r = expectStableLiteral("Write &amp;lt; to get a less-than");
    expect(textOf(r.json2)).toBe("Write &lt; to get a less-than");
  });

  it("keeps escaped dollars as text while maths is on", () => {
    const r = expectStableLiteral("Price \\$x\\$ here");
    expect(typesIn(r.json2).has("mathInline")).toBe(false);
    expect(textOf(r.json2)).toBe("Price $x$ here");
  });

  it("keeps a `1)` paragraph a paragraph", () => {
    const r = expectStableLiteral("1\\) text");
    expect(r.json2.content[0].type).toBe("paragraph");
  });

  it("keeps literal double tildes literal while strikethrough is on", () => {
    const r = expectStableLiteral("a \\~\\~b\\~\\~ c");
    expect(typesIn(r.json2).has("mark:strike")).toBe(false);
  });

  it("keeps literal curly groups literal while the curly syntax is on", () => {
    const features = { curlyBraceFormatting: true };
    const r = htmlRoundTrip("<p>{color=red}x{/color}</p>", { features });
    expect(r.md1).toBe("\\{color=red}x\\{/color}");
    expect(textOf(r.json2)).toBe("{color=red}x{/color}");
  });

  describe("…without backslash noise in ordinary prose", () => {
    it.each([
      ["comparisons and ampersands", "a < b, b > c and Tom & Jerry"],
      ["prices", "It costs $5 and then $10, or $5-$10 in bulk."],
      ["a single tilde", "Around ~32 000 spheres"],
      ["numbers", "In 1999) we moved; 2) is not at a line start"],
      ["braces with the curly syntax off", "## Returns {Promise}\n\nobject {a: 1}"],
    ])("%s", (_name, md) => {
      const r = roundTrip(md);
      expect(r.md1).toBe(md);
      expect(r.md2).toBe(md);
    });

    it("escapes `$` only while maths is on", () => {
      expect(escapeMarkdownText("$x$", { math: true })).toBe("\\$x$");
      expect(escapeMarkdownText("$x$", { math: false })).toBe("$x$");
      const r = roundTrip("Price $x$ here", { features: { math: false } });
      expect(r.md1).toBe("Price $x$ here");
    });

    it("escapes `~~` only while strikethrough is on", () => {
      expect(escapeMarkdownText("~~x~~", { strikethrough: false })).toBe("~~x~~");
      expect(escapeMarkdownText("~~x~~", { strikethrough: true })).toBe("\\~\\~x\\~\\~");
    });

    it("escapes `{` only while the curly syntax is on, and only for its groups", () => {
      expect(escapeMarkdownText("{color=red}x{/color}", { curly: false })).toBe("{color=red}x{/color}");
      expect(escapeMarkdownText("{Promise} {color=red}", { curly: true })).toBe("{Promise} \\{color=red}");
    });
  });
});

describe("A042 — a styled font survives Styled mode", () => {
  it("writes a quoted font family as a well-formed attribute", () => {
    const html = '<p><span style="font-family: &quot;Courier New&quot;, monospace">mono</span> text</p>';
    const r = htmlRoundTrip(html);
    expect(r.md1).toBe("<span style=\"font-family: 'Courier New', monospace\">mono</span> text");
    expect(r.md2).toBe(r.md1);
    const mark = r.json2.content[0].content[0].marks.find((m) => m.type === "textStyle");
    expect(mark.attrs.fontFamily).toMatch(/Courier New/);
    expect(textOf(r.json2)).toBe("mono text");
  });
});

describe("A049 — maths only where there is maths", () => {
  it("leaves a price range alone", () => {
    const r = roundTrip("It costs $5-$10 today.");
    expect(r.html1).not.toContain("data-math-inline");
    expect(r.md1).toBe("It costs $5-$10 today.");
  });

  it("keeps a mid-paragraph `$$…$$` in its paragraph", () => {
    const r = roundTrip("The formula $$x^2$$ inline.");
    expect(r.json1.content).toHaveLength(1);
    expect(r.json1.content[0].type).toBe("paragraph");
    expect(r.md1).toBe("The formula $$x^2$$ inline.");
    expect(r.md2).toBe(r.md1);
  });

  it("still renders block maths on its own lines, and inline maths", () => {
    const r = roundTrip("Euler $e^{i\\pi}+1=0$ here.\n\n$$x^2 + y^2$$");
    expect(typesIn(r.json1).has("mathInline")).toBe(true);
    expect(typesIn(r.json1).has("mathBlock")).toBe(true);
    expect(r.md1).toBe("Euler $e^{i\\pi}+1=0$ here.\n\n$$x^2 + y^2$$");
  });

  it("keeps a formula that is directly followed by a digit a formula", () => {
    // `$x$2` reads back as maths (the digit guard only applies to money-like
    // content). A formula that STARTS with a digit and is followed by one
    // would read as money, so the serializer separates them invisibly.
    const html =
      '<p>Area <span data-math-inline="x">x</span>2 and <span data-math-inline="2x">2x</span>3 units</p>';
    const r = htmlRoundTrip(html);
    expect(r.md1).toBe("Area $x$2 and $2x$<!---->3 units");
    const inline = r.json2.content[0].content.filter((n) => n.type === "mathInline");
    expect(inline.map((n) => n.attrs.latex)).toEqual(["x", "2x"]);
    expect(textOf(r.json2)).toBe("Area 2 and 3 units");
    expect(r.md2).toBe(r.md1);
  });

  it("does not let an escape make an earlier dollar open a formula", () => {
    for (const text of ["$$a$ b", "$a $b$", "x$$a$$b$", "$$$x$"]) {
      const r = htmlRoundTrip(`<p>${text}</p>`);
      expect(typesIn(r.json2).has("mathInline"), text).toBe(false);
      expect(typesIn(r.json2).has("mathBlock"), text).toBe(false);
      expect(textOf(r.json2), text).toBe(text);
    }
  });

  it("writes a formula the tokenizer will read back", () => {
    // A latex attribute with surrounding spaces or a blank line (both reachable
    // through the equation dialog) used to fall apart into text.
    const doc = '<p>a <span data-math-inline=" x^2 ">x</span> b</p><div data-math-block="a\n\nb">ab</div>';
    const r = htmlRoundTrip(doc);
    expect(r.md1).toBe("a $x^2$ b\n\n$$a\nb$$");
    expect(typesIn(r.json2).has("mathInline")).toBe(true);
    expect(typesIn(r.json2).has("mathBlock")).toBe(true);
  });
});

describe("A097 — no lookbehind in the modules the entry chunk loads", () => {
  // A `(?<=` / `(?<!` in a regex LITERAL is a parse-time SyntaxError on
  // Safari/iOS before 16.4: one in the entry chunk blanks the whole app.
  // Lazily loaded modules only fail when opened; they are listed so a new one
  // is a conscious decision, not an accident.
  const LAZY_ALLOWED = new Set(["src/ui/FindReplace.tsx"]);

  // Only regex LITERALS are parsed with the script. A lookbehind in a string
  // handed to `new RegExp` inside try/catch fails at run time, where it can be
  // caught (find-engine.ts, md-format-utils.ts do exactly that), so the scan
  // asks the TypeScript parser which tokens really are regex literals — a
  // plain text search flagged the safe form and could not tell them apart.
  const regexLiterals = (file, text) => {
    const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const found = [];
    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) found.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  };

  it("finds none outside the known lazy-loaded exceptions", () => {
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__") walk(p);
        } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
          const rel = p.replace(/\\/g, "/").replace(/^.*?\/src\//, "src/");
          if (LAZY_ALLOWED.has(rel)) continue;
          if (regexLiterals(name, readFileSync(p, "utf8")).some((re) => /\(\?<[=!]/.test(re))) hits.push(rel);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });

  it("the scan sees a lookbehind literal and ignores one compiled from a string", () => {
    expect(regexLiterals("a.ts", "const r = /(?<!x)y/g;")).toEqual(["/(?<!x)y/g"]);
    expect(regexLiterals("a.ts", 'try { new RegExp("(?<!x)y"); } catch {}')).toEqual([]);
  });
});
