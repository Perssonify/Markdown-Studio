/**
 * Console / diagnostics command registry.
 *
 * A CURATED, READ-ONLY set of commands over the editor's existing read APIs —
 * lifecycle flags, storage metrics, the document list, the active document's
 * outline/links, and the link graph. It is deliberately NOT an `eval` REPL and
 * exposes no arbitrary property access: every command is an explicit entry in
 * `CONSOLE_COMMANDS` that receives a typed `ConsoleContext` of getters. Adding a
 * capability means adding a vetted entry here, never widening a general escape
 * hatch. Mutations are intentionally out of scope for this diagnostics surface
 * (there is no write path in the context) — if that ever changes, a mutating
 * command MUST route through the store's sanctioned writers (`dispatch` /
 * `patchDocById`) and honor read-only, never a raw storage write.
 *
 * The module is PURE: the panel injects the real context; tests inject a fake.
 */

export interface ConsoleLifecycle {
  activeDocId: string | null;
  hydratedDocId: string | null;
  hydrated: boolean;
  saveStatus: string;
  hasActiveDoc: boolean;
  unsavedDraftCount: number;
  docCount: number;
}

export interface ConsoleStorageMetrics {
  usedBytes: number;
  maxBytes: number;
  pct: number;
  docCount: number;
  available: number;
}

export interface ConsoleDocSummary {
  id: string;
  title: string;
  updated?: string;
  tags?: string[];
}

export interface ConsoleHeading {
  level: number;
  text: string;
}

export interface ConsoleGraph {
  nodes: unknown[];
  edges: unknown[];
}

/** Read-only accessors the commands are allowed to touch. */
export interface ConsoleContext {
  getLifecycleState: () => ConsoleLifecycle;
  getStorageMetrics: () => ConsoleStorageMetrics | null;
  listDocuments: () => ConsoleDocSummary[];
  getActiveDocId: () => string | null;
  /** Headings of the active document, in document order. */
  getActiveOutline: () => ConsoleHeading[];
  /** Backlinks + forward links for a document id. */
  getLinks: (docId: string) => { backlinks: ConsoleDocSummary[]; forwardLinks: ConsoleDocSummary[] };
  /** The whole link graph (node/edge collections). */
  getGraph: () => ConsoleGraph;
}

export interface ConsoleResult {
  ok: boolean;
  /** Formatted, plain-text output for the console pane. */
  output: string;
}

interface ConsoleCommand {
  description: string;
  run: (ctx: ConsoleContext, args: string[]) => ConsoleResult;
}

function ok(output: string): ConsoleResult {
  return { ok: true, output };
}
function err(output: string): ConsoleResult {
  return { ok: false, output };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export const CONSOLE_COMMANDS: Record<string, ConsoleCommand> = {
  help: {
    description: "List available commands",
    run: () => {
      const lines = Object.entries(CONSOLE_COMMANDS)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, cmd]) => `  ${name.padEnd(16)} ${cmd.description}`);
      return ok(["Available commands:", ...lines].join("\n"));
    },
  },

  "diag.lifecycle": {
    description: "Document-lifecycle flags (active/hydrated/save status)",
    run: (ctx) => ok(json(ctx.getLifecycleState())),
  },

  "diag.storage": {
    description: "Local storage metrics (used / available / doc count)",
    run: (ctx) => {
      const m = ctx.getStorageMetrics();
      if (!m) return err("Storage metrics are not available for this adapter.");
      return ok(
        [
          `used:      ${fmtBytes(m.usedBytes)} (${m.pct}%)`,
          `available: ${fmtBytes(m.available)}`,
          `max:       ${fmtBytes(m.maxBytes)}`,
          `documents: ${m.docCount}`,
        ].join("\n")
      );
    },
  },

  "docs.list": {
    description: "List all documents (id · title)",
    run: (ctx) => {
      const docs = ctx.listDocuments();
      if (!docs.length) return ok("(no documents)");
      const lines = docs.map((d) => `  ${d.id}  ${d.title}`);
      return ok([`${docs.length} document(s):`, ...lines].join("\n"));
    },
  },

  "doc.outline": {
    description: "Active document heading outline",
    run: (ctx) => {
      if (!ctx.getActiveDocId()) return err("No active document.");
      const headings = ctx.getActiveOutline();
      if (!headings.length) return ok("(no headings)");
      const lines = headings.map((h) => `  ${"  ".repeat(Math.max(0, h.level - 1))}H${h.level} ${h.text || "(untitled)"}`);
      return ok(lines.join("\n"));
    },
  },

  "doc.links": {
    description: "Active document backlinks + forward links",
    run: (ctx) => {
      const id = ctx.getActiveDocId();
      if (!id) return err("No active document.");
      const { backlinks, forwardLinks } = ctx.getLinks(id);
      const fmt = (list: ConsoleDocSummary[]) =>
        list.length ? list.map((d) => `    ${d.title}`).join("\n") : "    (none)";
      return ok(
        [
          `Backlinks (${backlinks.length}):`,
          fmt(backlinks),
          `Forward links (${forwardLinks.length}):`,
          fmt(forwardLinks),
        ].join("\n")
      );
    },
  },

  "graph.stats": {
    description: "Link-graph node/edge counts",
    run: (ctx) => {
      const g = ctx.getGraph();
      return ok(`nodes: ${g.nodes.length}\nedges: ${g.edges.length}`);
    },
  },
};

/**
 * Parse and run a single console input line against the curated registry.
 * Unknown commands are rejected with a helpful message — there is no fallback
 * to arbitrary evaluation. Whitespace-separated tokens after the command name
 * become positional args (none of the built-in commands use them today).
 */
export function runConsoleCommand(input: string, ctx: ConsoleContext): ConsoleResult {
  const trimmed = input.trim();
  if (!trimmed) return err("");
  const [name, ...args] = trimmed.split(/\s+/);
  if (!name) return err("");
  const cmd = CONSOLE_COMMANDS[name];
  if (!cmd) {
    return err(`Unknown command: ${name}. Type "help" to list commands.`);
  }
  try {
    return cmd.run(ctx, args);
  } catch (e) {
    return err(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
