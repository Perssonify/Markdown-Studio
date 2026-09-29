import { TerminalSquare, CornerDownLeft } from "lucide-react";
import { useRef, useState } from "react";
import {
  runConsoleCommand,
  type ConsoleContext,
  type ConsoleResult,
} from "../store/console-commands";

interface ConsoleEntry {
  input: string;
  result: ConsoleResult;
}

interface ConsolePanelProps {
  /** Read-only accessors the curated commands may touch. */
  ctx: ConsoleContext;
}

/**
 * Diagnostics console — a bottom-tray tab (admin-gated by `consoleEnabled`).
 * Runs a CURATED, read-only command registry (`console-commands.ts`) over the
 * editor's existing read APIs; it is NOT an eval REPL. Output is a plain-text
 * scrollback; `help` lists the commands.
 */
export function ConsolePanel({ ctx }: ConsolePanelProps) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<ConsoleEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const submit = () => {
    const line = input.trim();
    if (!line) return;
    const result = runConsoleCommand(line, ctx);
    setHistory((h) => [...h, { input: line, result }]);
    setInput("");
    // Scroll to the newest output after render.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-xs">
        {history.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <TerminalSquare className="size-7 opacity-20" />
            <p className="text-sm font-medium">Diagnostics console</p>
            <p className="text-xs opacity-70">
              Read-only. Type <span className="rounded bg-muted px-1">help</span> and press Enter.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {history.map((entry, i) => (
              <li key={i}>
                <div className="flex items-center gap-1.5 text-primary">
                  <span className="opacity-60">›</span>
                  <span className="font-semibold">{entry.input}</span>
                </div>
                <pre
                  className={`mt-0.5 whitespace-pre-wrap break-words pl-3 ${
                    entry.result.ok ? "text-muted-foreground" : "text-destructive"
                  }`}
                >
                  {entry.result.output}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border p-2">
        <span className="font-mono text-xs text-muted-foreground">›</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="help"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/50"
          aria-label="Console command input"
        />
        <button
          type="button"
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary"
          title="Run command"
        >
          <CornerDownLeft className="size-3" />
        </button>
      </div>
    </div>
  );
}
