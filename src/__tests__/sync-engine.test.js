import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { normalizeMarkdown } from '../engine/preprocessor.ts';
import { useSyncEngine } from '../engine/useSyncEngine.ts';

describe('normalizeMarkdown wiki links', () => {
  it('restores [[…]] that turndown escaped', () => {
    expect(normalizeMarkdown('See \\[\\[Research Notes\\]\\] today\n'))
      .toBe('See [[Research Notes]] today\n');
  });

  it('tolerates a half-escaped closing pair', () => {
    expect(normalizeMarkdown('\\[\\[Doc Title]]\n')).toBe('[[Doc Title]]\n');
  });

  it('leaves ordinary escaped brackets alone', () => {
    expect(normalizeMarkdown('a \\[note\\] here\n')).toBe('a \\[note\\] here\n');
  });
});

/**
 * Mock factory for editor refs and engine.
 *
 * These mocks simulate the imperative handle interfaces of
 * CodeMirrorPane (cmRef) and TiptapPane (tiptapRef).
 */
function createMocks(initialMd = '# Hello', initialHtml = '<h1>Hello</h1>') {
  let mdContent = initialMd;
  let htmlContent = initialHtml;

  const cmRef = {
    current: {
      getValue: vi.fn(() => mdContent),
      setValue: vi.fn((md) => { mdContent = md; return md; }),
      getView: vi.fn(() => null),
      // Both panes expose these on their imperative handles; without them the
      // engine's optional calls (`isComposing?.()` / `resetHistory?.()`) are dead
      // in tests and the composition + undo-history invariants go uncovered.
      resetHistory: vi.fn(),
      isComposing: vi.fn(() => false),
    },
  };

  const tiptapRef = {
    current: {
      getHTML: vi.fn(() => htmlContent),
      setHTML: vi.fn((html) => { htmlContent = html; }),
      getEditor: vi.fn(() => ({
        getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
        commands: { setContent: vi.fn() },
      })),
      resetHistory: vi.fn(),
      isComposing: vi.fn(() => false),
    },
  };

  const engine = {
    mdToHtml: vi.fn((md) => `<p>${md}</p>`),
    htmlToMd: vi.fn((html) => html.replace(/<[^>]+>/g, '')),
    htmlToCleanMd: vi.fn((html) => html.replace(/<[^>]+>/g, '')),
  };

  const onCanonicalChange = vi.fn();

  return { cmRef, tiptapRef, engine, onCanonicalChange, getMd: () => mdContent, getHtml: () => htmlContent };
}

// --- Tests ---

describe('useSyncEngine', () => {

  describe('syncMdToHtml', () => {
    it('converts MD to HTML and pushes to Tiptap when content changes', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('# New', '<h1>Old</h1>');

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.syncMdToHtml(); });

      expect(engine.mdToHtml).toHaveBeenCalledWith('# New');
      expect(tiptapRef.current.setHTML).toHaveBeenCalled();
    });

    it('skips when MD content hash matches (no change)', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      // First call: processes
      act(() => { result.current.syncMdToHtml(); });
      const callCount = tiptapRef.current.setHTML.mock.calls.length;

      // Second call with same content: skips
      act(() => { result.current.syncMdToHtml(); });
      expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(callCount);
    });

    it('calls onCanonicalChange after sync', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.syncMdToHtml(); });
      expect(onCanonicalChange).toHaveBeenCalled();
    });

    it('skips when engine is null', () => {
      const { cmRef, tiptapRef } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine: null, syncMode: 'clean', onCanonicalChange: null,
      }));

      act(() => { result.current.syncMdToHtml(); });
      expect(tiptapRef.current.setHTML).not.toHaveBeenCalled();
    });
  });

  describe('syncHtmlToMd', () => {
    it('converts HTML to MD and pushes to CM6 when content changes', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('old md', '<p>new html</p>');

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.syncHtmlToMd(); });

      expect(engine.htmlToCleanMd).toHaveBeenCalledWith('<p>new html</p>');
      expect(cmRef.current.setValue).toHaveBeenCalled();
    });

    it('uses htmlToMd in styled mode', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('old', '<p>html</p>');

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'styled', onCanonicalChange,
      }));

      act(() => { result.current.syncHtmlToMd(); });
      expect(engine.htmlToMd).toHaveBeenCalled();
      expect(engine.htmlToCleanMd).not.toHaveBeenCalled();
    });

    it('skips when HTML content hash matches', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.syncHtmlToMd(); });
      const callCount = cmRef.current.setValue.mock.calls.length;

      act(() => { result.current.syncHtmlToMd(); });
      expect(cmRef.current.setValue).toHaveBeenCalledTimes(callCount);
    });
  });

  describe('forceSyncMdToHtml', () => {
    it('bypasses hash check and syncs', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      // First regular sync sets hash
      act(() => { result.current.syncMdToHtml(); });
      const firstCount = tiptapRef.current.setHTML.mock.calls.length;

      // Regular sync: skips (hash matches)
      act(() => { result.current.syncMdToHtml(); });
      expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(firstCount);

      // Force sync: runs despite same content
      act(() => { result.current.forceSyncMdToHtml(); });
      expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(firstCount + 1);
    });
  });

  describe('forceSyncHtmlToMd', () => {
    it('bypasses hash check and syncs', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.syncHtmlToMd(); });
      const firstCount = cmRef.current.setValue.mock.calls.length;

      // Force: runs again
      act(() => { result.current.forceSyncHtmlToMd(); });
      expect(cmRef.current.setValue).toHaveBeenCalledTimes(firstCount + 1);
    });
  });

  describe('loop prevention (critical — polish 28-34 regression test)', () => {
    it('forceSyncHtmlToMd called twice with same content: setValue called only once per force', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      // First force: runs (hash reset to 0, content hashed after)
      act(() => { result.current.forceSyncHtmlToMd(); });
      expect(cmRef.current.setValue).toHaveBeenCalledTimes(1);

      // Second force: ALSO runs (hash reset to 0 again)
      // But the KEY insight: after the sync runs, hash is set to actual content hash.
      // So the sync function itself sees hash !== 0 (reset) but then does the work
      // and sets hash to real value. Next regular call would skip.
      act(() => { result.current.forceSyncHtmlToMd(); });
      // Force always resets hash to 0, so it always runs
      expect(cmRef.current.setValue).toHaveBeenCalledTimes(2);

      // But REGULAR syncHtmlToMd should skip (hash matches from last force)
      act(() => { result.current.syncHtmlToMd(); });
      expect(cmRef.current.setValue).toHaveBeenCalledTimes(2); // no additional call
    });

    it('after force sync, regular sync is no-op (hash matches)', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.forceSyncMdToHtml(); });
      const count = tiptapRef.current.setHTML.mock.calls.length;

      // Regular sync: content hasn't changed, hash matches → skip
      act(() => { result.current.syncMdToHtml(); });
      expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(count);
    });

    it('syncMdToHtml then syncHtmlToMd does not create echo loop', () => {
      let mdContent = '# Hello';
      let htmlContent = '<h1>Hello</h1>';

      const cmRef = {
        current: {
          getValue: vi.fn(() => mdContent),
          setValue: vi.fn((md) => { mdContent = md; return md; }),
        },
      };
      const tiptapRef = {
        current: {
          // After setHTML, getHTML returns the normalized version
          getHTML: vi.fn(() => htmlContent),
          setHTML: vi.fn((html) => { htmlContent = html; }),
          getEditor: vi.fn(() => ({ getJSON: () => ({ type: 'doc' }) })),
        },
      };
      const engine = {
        mdToHtml: vi.fn(() => '<h1>Hello</h1>'),
        htmlToCleanMd: vi.fn(() => '# Hello'),
        htmlToMd: vi.fn(() => '# Hello'),
      };

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange: vi.fn(),
      }));

      // MD changed → sync to HTML
      act(() => { result.current.syncMdToHtml(); });
      expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(1);

      // Now HTML "changed" (Tiptap normalized) — but hash was set to actual getHTML()
      // So syncHtmlToMd should see hash match → skip
      act(() => { result.current.syncHtmlToMd(); });
      expect(cmRef.current.setValue).toHaveBeenCalledTimes(0); // skipped!
    });
  });

  describe('re-entrancy guard (syncing.current)', () => {
    it('skips sync when already syncing', () => {
      let mdContent = '# A';
      let htmlContent = '<h1>A</h1>';
      let reentered = 0;
      let setValueCallsDuringNestedPass = -1;
      let hook = null;

      const cmRef = {
        current: {
          getValue: vi.fn(() => mdContent),
          setValue: vi.fn((md) => md),
          isComposing: vi.fn(() => false),
          resetHistory: vi.fn(),
        },
      };
      const tiptapRef = {
        current: {
          getHTML: vi.fn(() => htmlContent),
          setHTML: vi.fn(() => {
            // GENUINE re-entry: pushing HTML into Tiptap fires its onUpdate, which
            // in the real app calls back into the OPPOSITE sync while the outer
            // MD→HTML pass is still mid-flight. lastHtmlHash is still null here, so
            // this nested pass WOULD do a full HTML→MD conversion (and clobber the
            // MD pane) if syncing.current did not suppress it.
            reentered += 1;
            hook.current.syncHtmlToMd();
            setValueCallsDuringNestedPass = cmRef.current.setValue.mock.calls.length;
          }),
          getEditor: vi.fn(() => ({ getJSON: () => ({ type: 'doc' }) })),
          isComposing: vi.fn(() => false),
          resetHistory: vi.fn(),
        },
      };
      const engine = {
        mdToHtml: vi.fn(() => '<h1>A</h1>'),
        htmlToCleanMd: vi.fn(() => '# A'),
        htmlToMd: vi.fn(() => '# A'),
      };

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange: vi.fn(),
      }));
      hook = result;

      // Start MD→HTML sync
      act(() => { result.current.syncMdToHtml(); });

      // The nested pass really did run, and the guard suppressed its work.
      expect(reentered).toBe(1);
      expect(setValueCallsDuringNestedPass).toBe(0);
      expect(engine.htmlToCleanMd).not.toHaveBeenCalled();

      // Change HTML content to make hash different
      htmlContent = '<h1>B</h1>';

      // Reset MD hash so syncMdToHtml would run if not for syncing guard
      mdContent = '# B';

      // Both syncs should work independently (syncing.current is false after first completes)
      act(() => { result.current.syncHtmlToMd(); });
      expect(cmRef.current.setValue).toHaveBeenCalled();
    });
  });

  describe('setFromHtml', () => {
    it('pushes HTML to Tiptap and derived MD to CM6', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('', '');

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.setFromHtml('<h1>New Content</h1>'); });

      expect(tiptapRef.current.setHTML).toHaveBeenCalledWith('<h1>New Content</h1>');
      expect(engine.htmlToCleanMd).toHaveBeenCalled();
      expect(cmRef.current.setValue).toHaveBeenCalled();
    });

    it('sets both hashes so subsequent syncs are no-ops', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('', '');

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.setFromHtml('<h1>Content</h1>'); });
      cmRef.current.setValue.mockClear();
      tiptapRef.current.setHTML.mockClear();

      // Both directions should be no-ops now
      act(() => { result.current.syncMdToHtml(); });
      act(() => { result.current.syncHtmlToMd(); });
      expect(tiptapRef.current.setHTML).not.toHaveBeenCalled();
      expect(cmRef.current.setValue).not.toHaveBeenCalled();
    });

    it('calls onCanonicalChange', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.setFromHtml('<p>test</p>'); });
      expect(onCanonicalChange).toHaveBeenCalled();
    });
  });

  describe('setCanonical', () => {
    it('pushes PM JSON to Tiptap and derives MD for CM6', () => {
      const { cmRef, tiptapRef, engine } = createMocks();
      const mockEditor = {
        getJSON: vi.fn(() => ({ type: 'doc' })),
        commands: { setContent: vi.fn() },
      };
      tiptapRef.current.getEditor = vi.fn(() => mockEditor);

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange: null,
      }));

      const pmJson = { type: 'doc', content: [{ type: 'paragraph' }] };
      act(() => { result.current.setCanonical(pmJson); });

      expect(mockEditor.commands.setContent).toHaveBeenCalledWith(pmJson, { emitUpdate: false });
      expect(cmRef.current.setValue).toHaveBeenCalled();
    });

    it('sets both hashes so subsequent syncs are no-ops', () => {
      const { cmRef, tiptapRef, engine } = createMocks();
      const mockEditor = {
        getJSON: vi.fn(() => ({ type: 'doc' })),
        commands: { setContent: vi.fn() },
      };
      tiptapRef.current.getEditor = vi.fn(() => mockEditor);

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange: null,
      }));

      act(() => { result.current.setCanonical({ type: 'doc' }); });
      cmRef.current.setValue.mockClear();
      tiptapRef.current.setHTML.mockClear();

      act(() => { result.current.syncMdToHtml(); });
      act(() => { result.current.syncHtmlToMd(); });
      expect(tiptapRef.current.setHTML).not.toHaveBeenCalled();
      expect(cmRef.current.setValue).not.toHaveBeenCalled();
    });
  });

  describe('resetHashes', () => {
    it('allows next sync to run regardless of content', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      // First sync sets hash
      act(() => { result.current.syncMdToHtml(); });
      const count = tiptapRef.current.setHTML.mock.calls.length;

      // Regular sync: skips
      act(() => { result.current.syncMdToHtml(); });
      expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(count);

      // Reset then sync: runs
      act(() => { result.current.resetHashes(); });
      act(() => { result.current.syncMdToHtml(); });
      expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(count + 1);
    });
  });

  /**
   * IME / voice-dictation guard (CLAUDE.md invariant).
   *
   * Dispatching content into either pane mid-composition ABORTS the composition
   * and drops the streamed text. Both sync directions must early-return while
   * EITHER pane reports isComposing(), and — critically — must do so BEFORE
   * touching the hash, so the very same content still syncs on the retry that
   * follows compositionend (otherwise the dictated text is silently lost).
   */
  describe('composition guard (IME / voice dictation)', () => {
    // THE RULE: a projection defers for a composition in the pane it WRITES,
    // and only that pane. It used to check both, which froze the mirror for a
    // whole dictated utterance and let one stuck flag wedge the sync forever.

    it('syncMdToHtml PROCEEDS while only the MD pane is composing', () => {
      // Each projection writes exactly ONE pane, and only that pane's
      // composition can be aborted. This one writes the rich pane
      // (tiptap.setHTML) and merely READS the markdown pane, which is an
      // uncontrolled CodeMirror — so a markdown-pane composition is not its
      // business. Guarding on it froze the rich pane for a whole dictated
      // utterance, and (measured in a browser) a CodeMirror `composing` flag
      // left stuck on by an undo dispatched mid-composition wedged this
      // projection for the rest of the session.
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('# New', '<h1>Old</h1>');
      cmRef.current.isComposing.mockReturnValue(true);

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.syncMdToHtml(); });
      expect(engine.mdToHtml).toHaveBeenCalledWith('# New');
      expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(1);
    });

    it('syncMdToHtml defers while the RICH pane is composing, then syncs the same content afterwards', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('# New', '<h1>Old</h1>');
      tiptapRef.current.isComposing.mockReturnValue(true);

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.syncMdToHtml(); });
      expect(tiptapRef.current.setHTML).not.toHaveBeenCalled();

      tiptapRef.current.isComposing.mockReturnValue(false);
      act(() => { result.current.syncMdToHtml(); });

      expect(engine.mdToHtml).toHaveBeenCalledWith('# New');
      expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(1);
    });

    it('syncHtmlToMd PROCEEDS while only the RICH pane is composing', () => {
      // Mirror image of the case above: this projection writes the markdown
      // pane, so only a markdown-pane composition can be aborted by it.
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('old md', '<p>new html</p>');
      tiptapRef.current.isComposing.mockReturnValue(true);

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.syncHtmlToMd(); });
      expect(engine.htmlToCleanMd).toHaveBeenCalledWith('<p>new html</p>');
      expect(cmRef.current.setValue).toHaveBeenCalledTimes(1);
    });

    it('syncHtmlToMd defers while the MD pane is composing, then syncs the same content afterwards', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('old md', '<p>new html</p>');
      cmRef.current.isComposing.mockReturnValue(true);

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.syncHtmlToMd(); });
      expect(cmRef.current.setValue).not.toHaveBeenCalled();

      cmRef.current.isComposing.mockReturnValue(false);
      act(() => { result.current.syncHtmlToMd(); });

      expect(engine.htmlToCleanMd).toHaveBeenCalledWith('<p>new html</p>');
      expect(cmRef.current.setValue).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Undo-history reset on hydration (CLAUDE.md invariant).
   *
   * Hydrating a DIFFERENT document must drop both panes' undo stacks, or ⌘Z
   * after a doc switch resurrects the previous document's content under the new
   * document's id. Same-document content replacement opts out via
   * { resetHistory: false } so the host append API keeps undo.
   */
  describe('undo history on hydration', () => {
    it('setCanonical resets undo history on BOTH panes', () => {
      const { cmRef, tiptapRef, engine } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange: null,
      }));

      act(() => { result.current.setCanonical({ type: 'doc', content: [{ type: 'paragraph' }] }); });

      expect(tiptapRef.current.resetHistory).toHaveBeenCalledTimes(1);
      expect(cmRef.current.resetHistory).toHaveBeenCalledTimes(1);
    });

    it('setCanonical with { resetHistory: false } KEEPS undo history (same-document update)', () => {
      const { cmRef, tiptapRef, engine } = createMocks();

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange: null,
      }));

      act(() => {
        result.current.setCanonical({ type: 'doc', content: [{ type: 'paragraph' }] }, { resetHistory: false });
      });

      expect(tiptapRef.current.resetHistory).not.toHaveBeenCalled();
      expect(cmRef.current.resetHistory).not.toHaveBeenCalled();
      // …but the content still landed in both panes.
      expect(cmRef.current.setValue).toHaveBeenCalled();
    });

    it('setFromHtml always resets undo history on BOTH panes', () => {
      const { cmRef, tiptapRef, engine, onCanonicalChange } = createMocks('', '');

      const { result } = renderHook(() => useSyncEngine({
        cmRef, tiptapRef, engine, syncMode: 'clean', onCanonicalChange,
      }));

      act(() => { result.current.setFromHtml('<h1>New Content</h1>'); });

      expect(tiptapRef.current.resetHistory).toHaveBeenCalledTimes(1);
      expect(cmRef.current.resetHistory).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Identity stability (CLAUDE.md invariant — React #185 crash).
   *
   * forceSyncMdToHtml / forceSyncHtmlToMd / resetHashes MUST keep empty
   * dependency arrays and reach the current sync closure through refs. Giving
   * them real deps churns their identity, which cascades through consumers'
   * effect dep arrays into an infinite sync loop.
   */
  describe('force*/resetHashes callback identity', () => {
    it('keeps referential identity across re-renders with changed props, while still calling the LATEST sync closure', () => {
      const { cmRef, tiptapRef, engine } = createMocks('# Hi', '<h1>Hi</h1>');
      const engine2 = {
        mdToHtml: vi.fn((md) => `<p>${md}</p>`),
        htmlToMd: vi.fn(() => '# from engine2'),
        htmlToCleanMd: vi.fn(() => '# from engine2'),
      };

      const { result, rerender } = renderHook(
        (props) => useSyncEngine({ cmRef, tiptapRef, ...props }),
        { initialProps: { engine, syncMode: 'clean', onCanonicalChange: vi.fn() } },
      );

      const before = {
        forceMd: result.current.forceSyncMdToHtml,
        forceHtml: result.current.forceSyncHtmlToMd,
        resetHashes: result.current.resetHashes,
        syncMdToHtml: result.current.syncMdToHtml,
      };

      rerender({ engine: engine2, syncMode: 'styled', onCanonicalChange: vi.fn() });

      // Sanity: the props really did change (the dependent callbacks re-created),
      // so identity below is a genuine result of the empty dep arrays.
      expect(result.current.syncMdToHtml).not.toBe(before.syncMdToHtml);

      expect(result.current.forceSyncMdToHtml).toBe(before.forceMd);
      expect(result.current.forceSyncHtmlToMd).toBe(before.forceHtml);
      expect(result.current.resetHashes).toBe(before.resetHashes);

      // The stable identity must not mean a STALE closure: calling the original
      // reference routes through the ref to the post-rerender sync function.
      act(() => { before.forceHtml(); });
      expect(engine2.htmlToMd).toHaveBeenCalled();
      expect(engine.htmlToMd).not.toHaveBeenCalled();
      expect(engine.htmlToCleanMd).not.toHaveBeenCalled();
    });
  });
});

/**
 * A conversion that throws must not leave the echo gate claiming the panes
 * agree. Both directions recorded "I have projected this content" BEFORE
 * running marked/turndown, so a throw froze the mirror: the debounced path
 * can never retry the same content, and only an explicit force-sync (a doc
 * switch, a sync-mode change, a toolbar command) recovers.
 */
describe('a failed conversion leaves the content unsynced, not "already synced"', () => {
  it("syncMdToHtml retries the same markdown after mdToHtml throws", () => {
    const { cmRef, tiptapRef, engine } = createMocks("# New", "<h1>Old</h1>");
    engine.mdToHtml = vi.fn(() => { throw new Error("marked blew up"); });

    const { result } = renderHook(() => useSyncEngine({
      cmRef, tiptapRef, engine, syncMode: "clean",
    }));

    expect(() => act(() => { result.current.syncMdToHtml(); })).toThrow();
    expect(tiptapRef.current.setHTML).not.toHaveBeenCalled();

    // The engine recovers (a transient failure, or the user fixes the input).
    engine.mdToHtml = vi.fn((md) => `<p>${md}</p>`);
    act(() => { result.current.syncMdToHtml(); });
    expect(engine.mdToHtml).toHaveBeenCalledWith("# New");
    expect(tiptapRef.current.setHTML).toHaveBeenCalledTimes(1);
  });

  it("syncHtmlToMd retries the same html after the conversion throws", () => {
    const { cmRef, tiptapRef, engine } = createMocks("old md", "<p>new html</p>");
    engine.htmlToCleanMd = vi.fn(() => { throw new Error("turndown blew up"); });

    const { result } = renderHook(() => useSyncEngine({
      cmRef, tiptapRef, engine, syncMode: "clean",
    }));

    expect(() => act(() => { result.current.syncHtmlToMd(); })).toThrow();
    expect(cmRef.current.setValue).not.toHaveBeenCalled();

    engine.htmlToCleanMd = vi.fn((html) => html.replace(/<[^>]+>/g, ""));
    act(() => { result.current.syncHtmlToMd(); });
    expect(engine.htmlToCleanMd).toHaveBeenCalledWith("<p>new html</p>");
    expect(cmRef.current.setValue).toHaveBeenCalledTimes(1);
  });
});
