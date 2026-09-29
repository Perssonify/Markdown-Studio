/**
 * A077 — third-party licence notices ship with the app.
 *
 * The built app carried no LICENSE/NOTICE/third-party file at all, and the
 * About-page credits omitted mammoth, @zip.js, highlight.js, the d3 modules,
 * dompurify, jszip, pako, sax and the OFL text for the bundled fonts.
 * scripts/third-party-licenses.mjs now generates the notice from what is
 * ACTUALLY in a build; public/third-party-licenses.txt is the committed copy
 * served at /third-party-licenses.txt.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  bareImports,
  collectPackages,
  embeddedPackages,
  packageFromPath,
  renderNotices,
} from "../../scripts/third-party-licenses.mjs";
import { CREDITS, THIRD_PARTY_NOTICES_PATH, TOOLING_GROUP } from "../data/credits";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("path and marker parsing", () => {
  it("names the package from the LAST node_modules segment", () => {
    expect(packageFromPath("/x/node_modules/react/cjs/react.production.min.js")).toMatchObject({ name: "react", inner: "cjs/react.production.min.js" });
    expect(packageFromPath("C:\\app\\node_modules\\@tiptap\\core\\dist\\index.js")).toMatchObject({ name: "@tiptap/core", inner: "dist/index.js" });
    expect(packageFromPath("/x/node_modules/mermaid/node_modules/katex/dist/katex.mjs")).toMatchObject({ name: "katex" });
    expect(packageFromPath("/x/src/App.tsx")).toBe(null);
  });

  it("reads the packages a prebuilt file says it embeds", () => {
    const content = [
      "//#region node_modules/sax/lib/sax.js",
      "var sax = 1;",
      "//#region node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml/dist/js-yaml.mjs",
      "// node_modules/@chevrotain/utils/lib/print.js",
      "const s = 'node_modules/not-a-marker/x.js';",
    ].join("\n");
    expect(embeddedPackages(content).sort()).toEqual(["@chevrotain/utils", "js-yaml", "sax"]);
  });

  it("reads bare CSS and entry imports, not relative ones", () => {
    expect(bareImports('@import "tailwindcss";\n@import \'tw-animate-css\';\n@import "./local.css";').sort()).toEqual(["tailwindcss", "tw-animate-css"]);
    expect(bareImports('import "@fontsource-variable/geist";\nimport "katex/dist/katex.min.css";\nimport "./styles.css";').sort()).toEqual(["@fontsource-variable/geist", "katex"]);
  });
});

describe("collecting a build", () => {
  let root;
  const pkg = (name, extra = {}, licence = "MIT", text = `Copyright ${name}`) => {
    const dir = join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license: licence, ...extra }));
    if (text != null) writeFileSync(join(dir, "LICENSE"), text);
    return dir;
  };
  const file = (rel, body = "") => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "g4-licences-"));
    pkg("plain");
    pkg("@scope/nolicence", {}, "ISC", null);
    pkg("umd-lib", { dependencies: { inner: "^1", "@types/node": "*" } });
    pkg("@types/node"); // installed, so only the types filter keeps it out
    pkg("inner", { dependencies: { deeper: "^1" } });
    pkg("deeper");
    pkg("esm-lib", { dependencies: { "not-bundled": "^1" } });
    pkg("not-bundled");
    pkg("host");
    pkg("embedded-one");
    pkg("a-font", {}, "OFL-1.1", "SIL OPEN FONT LICENSE Version 1.1");
    pkg("unused");
    file("src/styles.css", '@import "a-font";');
    file("src/main.tsx", 'import "./styles.css";');
    file(
      "dist-app/assets/index.js.map",
      JSON.stringify({
        sources: [
          "../../node_modules/plain/index.js",
          "../../node_modules/@scope/nolicence/dist/x.js",
          "../../node_modules/umd-lib/dist/umd-lib.min.js",
          "../../node_modules/esm-lib/dist/index.js",
          "../../node_modules/host/dist/index.mjs",
          "../../src/App.tsx",
        ],
        sourcesContent: [
          "", "", "", "",
          "//#region node_modules/embedded-one/index.js\n//#region node_modules/ghost/index.js\n",
          "",
        ],
      }),
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const collect = () => collectPackages({ distDir: join(root, "dist-app"), rootDir: root });
  const kinds = (r) => Object.fromEntries(r.entries.map((e) => [e.name, e.kind]));

  it("lists what the build contains, and only that", () => {
    const k = kinds(collect());
    expect(k.plain).toBe("bundled");
    expect(k["@scope/nolicence"]).toBe("bundled");
    expect(k["esm-lib"]).toBe("bundled");
    expect(k.unused).toBeUndefined(); // installed, never bundled
    expect(k["not-bundled"]).toBeUndefined(); // an ESM dist file imports its deps; they'd be in the maps
  });

  it("includes what a prebuilt file declares it embeds — and names what is not installed", () => {
    const r = collect();
    expect(kinds(r)["embedded-one"]).toBe("embedded");
    expect(r.entries.find((e) => e.name === "embedded-one").inside).toEqual(["host"]);
    expect(r.missing).toEqual([{ name: "ghost", hosts: ["host"] }]);
  });

  it("includes the dependency tree of a MINIFIED prebuilt bundle (how jszip carries pako)", () => {
    const k = kinds(collect());
    expect(k.inner).toBe("dependency");
    expect(k.deeper).toBe("dependency"); // browserify bundles the whole tree
    expect(k["@types/node"]).toBeUndefined(); // types are never runtime code
  });

  it("includes stylesheets and fonts imported from src (CSS is not in the JS maps)", () => {
    const r = collect();
    const font = r.entries.find((e) => e.name === "a-font");
    expect(font.kind).toBe("bundled");
    expect(font.importedBy).toEqual(["src/styles.css"]);
  });

  it("refuses to produce an empty notice from a build without source maps", () => {
    rmSync(join(root, "dist-app"), { recursive: true, force: true });
    mkdirSync(join(root, "dist-app"));
    expect(() => collect()).toThrow(/no source maps/);
  });

  it("renders every licence text, deterministically", () => {
    const text = renderNotices(collect());
    expect(text).toBe(renderNotices(collect()));
    expect(text).toMatch(/^plain 1\.0\.0$/m);
    expect(text).toMatch(/Copyright plain/);
    expect(text).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    expect(text).toMatch(/ships no licence file\. Its package\.json declares: ISC/);
    expect(text).toMatch(/PART 2 — DEPENDENCIES OF PREBUILT PACKAGES/);
    expect(text).toMatch(/ghost — inside host/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no build timestamps
  });
});

describe("the shipped notice file", () => {
  const notices = read("public/third-party-licenses.txt");
  const has = (name, version) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} ${version ?? "\\S+"}$`, "m").test(notices);

  it("covers everything the audit found missing", () => {
    for (const name of [
      "mammoth", "@zip.js/zip.js", "highlight.js", "d3-selection", "d3-shape", "d3-sankey",
      "dompurify", "jszip", "pako", "sax", "@fontsource-variable/geist", "@fontsource-variable/inter",
    ]) {
      expect(has(name), name).toBe(true);
    }
  });

  it("carries the SIL Open Font License text for the bundled fonts", () => {
    for (const font of ["@fontsource-variable/geist", "@fontsource-variable/inter"]) {
      const at = notices.search(new RegExp(`^${font.replace(/[/@-]/g, "\\$&")} `, "m"));
      const entry = notices.slice(at, notices.indexOf("\n" + "-".repeat(78), at + 1));
      expect(entry, font).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
      expect(entry, font).toMatch(/PERMISSION & CONDITIONS/);
    }
  });

  it("every credited runtime package ships at the version credited", () => {
    for (const group of CREDITS) {
      if (group.group === TOOLING_GROUP) continue;
      for (const item of group.items) expect(has(item.name, item.version), `${item.name}@${item.version}`).toBe(true);
    }
  });

  it("is linked from the About page", () => {
    expect(THIRD_PARTY_NOTICES_PATH).toBe("/third-party-licenses.txt");
    expect(read("src/ui/pages/AboutPage.tsx")).toMatch(/href=\{THIRD_PARTY_NOTICES_PATH\}/);
  });
});
