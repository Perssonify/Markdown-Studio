import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Compass, Keyboard, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { APP_NAME } from "../../constants";
import {
  displayKeysFor,
  IS_MAC,
  type ShortcutPlatform,
} from "../../data/shortcuts";
import { LinkBuilder } from "../LinkBuilder";
import { HELP_SECTIONS, type HelpBlock, SHORTCUT_GROUPS } from "./help-content";
import { PageChrome } from "./PageChrome";

interface HelpPageProps {
  onClose: () => void;
  /** Start the guided spotlight tour (returns to the editor first). */
  onStartTour?: () => void;
}

/** All searchable text in a block / section, lowercased. */
const blockText = (b: HelpBlock) =>
  [b.p, b.tip, ...(b.list ?? [])].filter(Boolean).join(" ");
const sectionMatches = (s: (typeof HELP_SECTIONS)[number], q: string) =>
  (s.title + " " + s.blocks.map(blockText).join(" ")).toLowerCase().includes(q);

export function HelpPage({ onClose, onStartTour }: HelpPageProps) {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<ShortcutPlatform>(IS_MAC ? "mac" : "other");

  const q = query.trim().toLowerCase();

  const sections = useMemo(
    () => (q ? HELP_SECTIONS.filter((s) => sectionMatches(s, q)) : HELP_SECTIONS),
    [q]
  );

  const shortcutGroups = useMemo(() => {
    if (!q) return SHORTCUT_GROUPS;
    return SHORTCUT_GROUPS.map((g) => ({
      ...g,
      rows: g.group.toLowerCase().includes(q)
        ? g.rows
        : g.rows.filter((r) => (r.action + " " + r.keys).toLowerCase().includes(q)),
    })).filter((g) => g.rows.length > 0);
  }, [q]);

  const showShortcuts = !q || shortcutGroups.length > 0;

  const toc = [
    ...sections.map((s) => ({ id: s.id, title: s.title })),
    ...(showShortcuts ? [{ id: "shortcuts", title: "Keyboard shortcuts" }] : []),
  ];

  const [active, setActive] = useState<string>(HELP_SECTIONS[0]!.id);
  const go = (id: string) => {
    setActive(id);
    document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const noResults = q && sections.length === 0 && !showShortcuts;

  return (
    <PageChrome
      title={`${APP_NAME} Help`}
      onClose={onClose}
      actions={
        onStartTour && (
          <Button size="sm" variant="default" className="gap-1.5" onClick={onStartTour}>
            <Compass className="size-4" />
            <span className="hidden sm:inline">Take a tour</span>
          </Button>
        )
      }
    >
      <div className="mx-auto flex max-w-5xl gap-8 px-4 py-6 sm:px-8 sm:py-8">
        {/* Sticky table of contents (desktop) */}
        <nav className="sticky top-6 hidden h-fit w-52 shrink-0 lg:block" aria-label="Help contents">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            On this page
          </p>
          <ul className="space-y-0.5 text-sm">
            {toc.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => go(t.id)}
                  className={`block w-full rounded px-2 py-1 text-left transition-colors hover:bg-accent ${
                    active === t.id ? "bg-accent font-medium text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <header className="mb-6 sm:mb-8">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">How to use {APP_NAME}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Everything you can do, where to find it, and the shortcuts that make it fast.
            </p>
            {/* Search */}
            <div className="relative mt-4 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help…"
                className="h-9 pl-9"
                aria-label="Search help"
              />
            </div>
          </header>

          {/* Collapsible table of contents (mobile / tablet) */}
          {toc.length > 0 && (
            <details className="mb-6 rounded-lg border border-border bg-card/40 lg:hidden">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">On this page</summary>
              <ul className="border-t border-border/60 px-2 py-2 text-sm">
                {toc.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => go(t.id)}
                      className="block w-full rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-accent"
                    >
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {noResults && (
            <p className="rounded-md border border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
              No help topics match “{query}”. Try a different word.
            </p>
          )}

          {sections.map((section) => (
            <section
              key={section.id}
              id={`help-${section.id}`}
              className="mb-10 scroll-mt-6 border-b border-border/60 pb-8 last:border-0"
            >
              <h2 className="mb-3 text-lg font-semibold tracking-tight">{section.title}</h2>
              <div className="space-y-3">
                {section.blocks.map((b, i) => {
                  if (b.p) return <p key={i} className="text-sm leading-relaxed text-muted-foreground">{b.p}</p>;
                  if (b.list)
                    return (
                      <ul key={i} className="ml-1 space-y-1.5">
                        {b.list.map((li, j) => (
                          <li key={j} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                            <span>{li}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  if (b.tip)
                    return (
                      <p key={i} className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-relaxed text-foreground">
                        <span className="font-semibold text-primary">Tip · </span>
                        {b.tip}
                      </p>
                    );
                  return null;
                })}
                {section.id === "sharing-embedding" && (
                  /* The reference list above describes every parameter; this
                     builds a real link with them. Help used to carry a cut-down
                     builder that could only produce ?import_url= links, so the
                     documentation described far more than the widget beside it
                     could construct. */
                  <div className="mt-4 rounded-lg border border-border bg-card/40 p-3">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Build a share / embed link
                    </p>
                    <LinkBuilder variant="page" />
                  </div>
                )}
              </div>
            </section>
          ))}

          {/* Shortcuts */}
          {showShortcuts && (
            <section id="help-shortcuts" className="scroll-mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <Keyboard className="size-5 text-primary" /> Keyboard shortcuts
                </h2>
                {/* Platform toggle — Mac ⌘ glyphs vs Windows/Linux Ctrl+ text. */}
                <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
                  {(["mac", "other"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatform(p)}
                      aria-pressed={platform === p}
                      className={`px-2.5 py-1 transition-colors ${
                        platform === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {p === "mac" ? "macOS" : "Windows / Linux"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                {shortcutGroups.map((g) => (
                  <div key={g.group}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {g.group}
                    </h3>
                    {/* A binding documented without its scope reads as a promise
                        the editor cannot keep — see ShortcutGroup.note. */}
                    {g.note && (
                      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{g.note}</p>
                    )}
                    <dl className="overflow-hidden rounded-lg border border-border">
                      {g.rows.map((r, i) => (
                        <div
                          key={r.action}
                          className={`flex items-center justify-between gap-3 px-3 py-1.5 text-sm ${
                            i % 2 ? "bg-card/30" : ""
                          }`}
                        >
                          <dt className="text-muted-foreground">{r.action}</dt>
                          <dd>
                            <kbd className="font-mono text-[11px] text-foreground">
                              {displayKeysFor(r.keys, platform)}
                            </kbd>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </PageChrome>
  );
}
