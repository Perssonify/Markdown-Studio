import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileFindQuery,
  execAllCore,
  expandReplacement,
  firstMatchFrom,
  hasNestedQuantifier,
  mdCodeRanges,
  mdHeadingRanges,
  pickMatch,
} from "../formatting/find-engine";
import {
  FindSupersededError,
  FindTimeoutError,
  FindUnsafePatternError,
  __resetFindWorkerForTests,
  __setFindWorkerFactoryForTests,
  findRequestCore,
  findWorkerSource,
  runFind,
} from "../formatting/find-worker";

const OPT = { regex: false, caseSensitive: false, wholeWord: false };
const all = (q, text, max = 10000) => execAllCore(q.source, q.flags, text, max, 0, q.wordFilter);
const texts = (q, text) => all(q, text).matches.map((m) => text.slice(m.index, m.index + m.length));

describe("compileFindQuery", () => {
  it("escapes a literal query", () => {
    expect(texts(compileFindQuery("a.b(c)", OPT, "md"), "a.b(c) axb(c)")).toEqual(["a.b(c)"]);
  });

  it("is case-insensitive unless asked", () => {
    expect(texts(compileFindQuery("foo", OPT, "md"), "foo Foo")).toEqual(["foo", "Foo"]);
    expect(texts(compileFindQuery("foo", { ...OPT, caseSensitive: true }, "md"), "foo Foo")).toEqual(["foo"]);
  });

  it("makes ^ and $ LINE anchors in the markdown pane (A067)", () => {
    const md = compileFindQuery("^- ", { ...OPT, regex: true }, "md");
    expect(all(md, "- a\n- b\ntext - c").matches.map((m) => m.index)).toEqual([0, 4]);
    // The rich pane matches per text node; `m` is not added there.
    expect(compileFindQuery("^x", { ...OPT, regex: true }, "rich").flags).not.toContain("m");
  });

  it("whole word works in every script (A098) — `\\b` only knew ASCII", () => {
    const ww = { ...OPT, wholeWord: true };
    expect(texts(compileFindQuery("мир", ww, "md"), "мир миров мир")).toEqual(["мир", "мир"]);
    expect(texts(compileFindQuery("Café", ww, "md"), "Café cafés Café.")).toEqual(["Café", "Café"]);
    expect(texts(compileFindQuery("cat", ww, "md"), "cat catalog scat cat_ cat")).toEqual(["cat", "cat"]);
    // A decomposed "é" (e + combining acute) is part of the word.
    expect(texts(compileFindQuery("Cafe", ww, "md"), "Café Cafe")).toEqual(["Cafe"]);
    // CJK: a match must not sit inside a longer run of letters.
    expect(all(compileFindQuery("東京", ww, "md"), "東京 東京都").matches).toHaveLength(1);
  });

  it("keeps a user regex that is only valid WITHOUT the u flag, checking whole word per match", () => {
    const q = compileFindQuery('\\"мир\\"', { regex: true, caseSensitive: false, wholeWord: false }, "md");
    expect(q.flags).not.toContain("u");
    const ww = compileFindQuery("м\\ир", { regex: true, caseSensitive: false, wholeWord: true }, "md");
    expect(ww.wordFilter).toBe(true);
    expect(texts(ww, "мир мирный мир")).toEqual(["мир", "мир"]);
  });

  it("throws the pattern's own error for an invalid regex", () => {
    expect(() => compileFindQuery("(a", { ...OPT, regex: true }, "md")).toThrow(SyntaxError);
  });
});

describe("execAllCore", () => {
  it("advances past zero-length matches instead of stalling (A067)", () => {
    const q = compileFindQuery("^", { ...OPT, regex: true }, "md");
    expect(all(q, "a\nb\nc").matches.map((m) => m.index)).toEqual([0, 2, 4]);
    const astral = compileFindQuery("(?=x)|", { ...OPT, regex: true }, "md");
    expect(() => all(astral, "😀😀x")).not.toThrow();
  });

  it("caps the number of matches and says so", () => {
    const r = all(compileFindQuery("a", OPT, "md"), "aaaaa", 3);
    expect(r.matches).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  it("reports capture groups and their offsets", () => {
    const q = compileFindQuery("(\\d+)-(?<b>\\d+)", { ...OPT, regex: true }, "md");
    const [m] = all(q, "x 12-34").matches;
    expect(m.groups).toEqual(["12", "34"]);
    expect(m.named).toEqual({ b: "34" });
    if (m.indices) expect(m.indices).toEqual([[2, 4], [5, 7]]);
  });
});

describe("expandReplacement — built from the ORIGINAL match (A060)", () => {
  /** What String.prototype.replace does for the first match, for comparison. */
  function viaNative(pattern, flags, input, template) {
    return input.replace(new RegExp(pattern, flags), template);
  }
  function viaEngine(pattern, flags, input, template) {
    const [m] = execAllCore(pattern, flags, input, 1, 0, false).matches;
    return input.slice(0, m.index) + expandReplacement(template, m, input) + input.slice(m.index + m.length);
  }
  const CASES = [
    ["(\\d+)-(\\d+)", "x 12-34 y", "$2-$1"],
    ["b+", "abbbc", "[$&]"],
    ["b+", "abbbc", "<$`|$'>"],
    ["b", "abc", "$$ and $"],
    ["(?<y>\\d{4})-(?<m>\\d\\d)", "on 2024-06!", "$<m>/$<y>"],
    ["(a)", "a", "$10 $01 $0 $2"],
    ["(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)", "abcdefghij", "$10|$11|$1"],
    ["(?<n>x)", "x", "$<n $<missing>!"],
    ["x", "x", "$<n>"],
  ];
  for (const [pattern, input, template] of CASES) {
    it(`matches String.replace for /${pattern}/ with "${template}"`, () => {
      expect(viaEngine(pattern, "g", input, template)).toBe(viaNative(pattern, "", input, template));
    });
  }

  it("replaces a LOOKAHEAD match (it used to be counted and never replaced)", () => {
    const q = compileFindQuery("\\d+(?=px)", { ...OPT, regex: true }, "md");
    const input = "width: 12px; margin: 5em; 7px";
    const ms = all(q, input).matches;
    let out = "";
    let at = 0;
    for (const m of ms) { out += input.slice(at, m.index) + expandReplacement("N", m, input); at = m.index + m.length; }
    out += input.slice(at);
    expect(out).toBe("width: Npx; margin: 5em; Npx");
  });

  it("sees lookbehind context too", () => {
    const q = compileFindQuery("(?<=\\$)\\d+", { ...OPT, regex: true }, "md");
    const input = "cost $40 or 40";
    const [m] = all(q, input).matches;
    expect(expandReplacement("[$&]", m, input)).toBe("[40]");
    expect(all(q, input).matches).toHaveLength(1);
  });
});

describe("navigation", () => {
  const R = [{ from: 0, to: 0 }, { from: 3, to: 3 }, { from: 5, to: 8 }];

  it("Next moves past a selected ZERO-LENGTH match (A067)", () => {
    expect(pickMatch(R, 0, 0, 1)).toBe(1);
    expect(pickMatch(R, 3, 3, 1)).toBe(2);
    expect(pickMatch(R, 5, 8, 1)).toBe(0); // wraps
  });

  it("Previous does too", () => {
    expect(pickMatch(R, 5, 8, -1)).toBe(1);
    expect(pickMatch(R, 3, 3, -1)).toBe(0);
    expect(pickMatch(R, 0, 0, -1)).toBe(2); // wraps
  });

  it("find-as-you-type anchors on the selection's START (no jumping ahead)", () => {
    // "a" selected [0,1]; typing "b" → "ab" matches [0,2] and [3,5]: keep the first.
    expect(firstMatchFrom([{ from: 0, to: 2 }, { from: 3, to: 5 }], 0)).toBe(0);
  });
});

describe("hasNestedQuantifier", () => {
  it.each([
    ["(a+)+$", true], ["(a*)*", true], ["(\\w+\\s?)+$", true], ["([a-z]+)*x", true],
    ["(?:x{2,})+", true], ["((ab)+c)+", true],
    ["(a|b)+", false], ["a+b+c*", false], ["(x{1,1})+", false], ["[(a+)+]", false],
    ["\\(a+\\)+", false], ["(abc)+", false],
  ])("%s → %s", (src, bad) => expect(hasNestedQuantifier(src)).toBe(bad));
});

describe("markdown regions skip fenced code (A062)", () => {
  const DOC = "# Real\n```bash\n# install\n```\n## Also real";
  it("headings", () => {
    expect(mdHeadingRanges(DOC).map(([s, e]) => DOC.slice(s, e))).toEqual(["Real", "Also real"]);
  });
  it("code", () => {
    expect(mdCodeRanges(DOC).map(([s, e]) => DOC.slice(s, e))).toEqual(["```bash\n# install\n```"]);
  });
});

// ── The worker (A061) ───────────────────────────────────────────────────────

describe("the Worker program", () => {
  it("is self-contained and runs the same matcher (evaluated in isolation)", () => {
    const posted = [];
    const self = { postMessage: (m) => posted.push(m) };
    new Function("self", findWorkerSource())(self);
    const q = compileFindQuery("\\d+(?=px)", { ...OPT, regex: true }, "md");
    const req = { source: q.source, flags: q.flags, wordFilter: q.wordFilter, texts: ["1px 2em 3px", "4px"], maxMatches: 100, deadline: 0 };
    self.onmessage({ data: { id: 7, req } });
    expect(posted[0]).toEqual({ id: 7, ok: true, value: JSON.parse(JSON.stringify(findRequestCore(req, execAllCore))) });
    expect(posted[0].value.results.map((r) => r.matches.length)).toEqual([2, 1]);
  });

  it("reports a pattern error instead of dying", () => {
    const posted = [];
    const self = { postMessage: (m) => posted.push(m) };
    new Function("self", findWorkerSource())(self);
    self.onmessage({ data: { id: 1, req: { source: "(", flags: "g", wordFilter: false, texts: ["x"], maxMatches: 1, deadline: 0 } } });
    expect(posted[0].ok).toBe(false);
  });
});

/** An in-process stand-in for a Worker: runs the real program, asynchronously. */
function fakeWorkerFactory({ hang = false, fail = false } = {}) {
  const made = [];
  const factory = () => {
    const w = {
      onmessage: null, onerror: null, terminated: false,
      postMessage(msg) {
        if (fail) { setTimeout(() => w.onerror?.(new Error("blocked")), 0); return; }
        if (hang) return; // a catastrophic pattern that never comes back
        const scope = { postMessage: (m) => setTimeout(() => w.onmessage?.({ data: m }), 0) };
        new Function("self", findWorkerSource())(scope);
        scope.onmessage({ data: msg });
      },
      terminate() { w.terminated = true; },
    };
    made.push(w);
    return w;
  };
  return { factory, made };
}

describe("runFind — the regex runs off the main thread, with a timeout", () => {
  afterEach(() => __resetFindWorkerForTests());
  const RX = { ...OPT, regex: true };

  it("answers a regex from the worker", async () => {
    const { factory, made } = fakeWorkerFactory();
    __setFindWorkerFactoryForTests(factory);
    const r = await runFind(compileFindQuery("a+", RX, "md"), ["aa b aaa"], { isRegex: true, maxMatches: 10 });
    expect(r.results[0].matches.map((m) => m.length)).toEqual([2, 3]);
    expect(made).toHaveLength(1);
  });

  it("abandons a pattern that runs too long, and TERMINATES the worker", async () => {
    const { factory, made } = fakeWorkerFactory({ hang: true });
    __setFindWorkerFactoryForTests(factory);
    await expect(
      runFind(compileFindQuery("(a+)+$", RX, "md"), ["a".repeat(40) + "!"], { isRegex: true, maxMatches: 10, timeoutMs: 20 })
    ).rejects.toBeInstanceOf(FindTimeoutError);
    expect(made[0].terminated).toBe(true);
  });

  it("a new job supersedes one still running", async () => {
    const { factory, made } = fakeWorkerFactory({ hang: true });
    __setFindWorkerFactoryForTests(factory);
    const first = runFind(compileFindQuery("(a+)+$", RX, "md"), ["aaaa!"], { isRegex: true, maxMatches: 10, timeoutMs: 5000 });
    const second = runFind(compileFindQuery("b", RX, "md"), ["b"], { isRegex: true, maxMatches: 10, timeoutMs: 20 });
    await expect(first).rejects.toBeInstanceOf(FindSupersededError);
    expect(made[0].terminated).toBe(true);
    await expect(second).rejects.toBeInstanceOf(FindTimeoutError); // the stand-in still hangs
  });

  it("falls back to the main thread when the worker cannot start", async () => {
    const { factory } = fakeWorkerFactory({ fail: true });
    __setFindWorkerFactoryForTests(factory);
    const r = await runFind(compileFindQuery("a+", RX, "md"), ["aa"], { isRegex: true, maxMatches: 10 });
    expect(r.results[0].matches).toHaveLength(1);
  });

  it("a worker that ANSWERED before and then dies is not replaced by a main-thread run", async () => {
    // The main-thread fallback is for a Worker that never started (a CSP
    // block). One that ran and then died was killed by the pattern itself —
    // running that pattern on the main thread is what the Worker prevents.
    let jobs = 0;
    const made = [];
    __setFindWorkerFactoryForTests(() => {
      const w = {
        onmessage: null, onerror: null, terminate() { w.dead = true; },
        postMessage(msg) {
          jobs++;
          if (jobs === 2) { setTimeout(() => w.onerror?.(new Error("out of memory")), 0); return; }
          const scope = { postMessage: (m) => setTimeout(() => w.onmessage?.({ data: m }), 0) };
          new Function("self", findWorkerSource())(scope);
          scope.onmessage({ data: msg });
        },
      };
      made.push(w);
      return w;
    });
    const q = compileFindQuery("a", RX, "md");
    await expect(runFind(q, ["aa"], { isRegex: true, maxMatches: 10 })).resolves.toBeTruthy();
    await expect(runFind(q, ["aa"], { isRegex: true, maxMatches: 10 })).rejects.toThrow(/could not be run/);
    // …and the next job gets a fresh Worker rather than the main thread.
    await expect(runFind(q, ["aa"], { isRegex: true, maxMatches: 10 })).resolves.toBeTruthy();
    expect(made.length).toBe(2);
  });

  it("without a worker, refuses the classic catastrophic shape rather than hang", async () => {
    __setFindWorkerFactoryForTests(null);
    await expect(
      runFind(compileFindQuery("(a+)+$", RX, "md"), ["a".repeat(28) + "!"], { isRegex: true, maxMatches: 10 })
    ).rejects.toBeInstanceOf(FindUnsafePatternError);
  });

  it("never sends a LITERAL search to the worker (it is linear-time)", async () => {
    const factory = vi.fn(() => null);
    __setFindWorkerFactoryForTests(factory);
    const r = await runFind(compileFindQuery("(a+)+$", OPT, "md"), ["(a+)+$"], { isRegex: false, maxMatches: 10 });
    expect(r.results[0].matches).toHaveLength(1);
    expect(factory).not.toHaveBeenCalled();
  });
});
