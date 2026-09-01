import React, { useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../store/store';
import { ChromaticKeyboard, ScaleLockedKeyboard, ChordKeyboard } from './Keyboard';
import { DrumPadGrid } from './DrumPadGrid';
import { SECTION_HEADER } from './fieldClasses';
import type { InputDeckDrumProps, InputDeckKeyboardProps } from '../useInputDeck';

/** Reads one slice of the store with the LIVE state as the server snapshot too.
 *
 *  zustand v5 wires `useStore`'s `getServerSnapshot` to
 *  `selector(api.getInitialState())`, so a plain `useAppStore((s) => ...)`
 *  always renders the store's creation-time values under `renderToString` — a
 *  dock that reads it would render permanently closed in tests no matter what
 *  `useAppStore.setState(...)` did beforehand (see the note in
 *  TransportBar.test.tsx). Serving `getState()` for BOTH snapshots keeps the
 *  dock reactive in the browser AND makes its server output reflect the current
 *  state. The dock selects only primitives (booleans, strings, stable setters),
 *  so a fresh value from `getSnapshot` on every render is safe under
 *  `useSyncExternalStore`'s `Object.is` cache check.
 */
function useLiveStore<T>(
  selector: (state: ReturnType<typeof useAppStore.getState>) => T,
): T {
  return useSyncExternalStore(
    useAppStore.subscribe,
    () => selector(useAppStore.getState()),
    () => selector(useAppStore.getState()),
  );
}

/** The bottom input deck: a purely visual/touch surface hosting the synth
 *  keyboard and the drum pads in one panel. QWERTY input is owned by
 *  useInputDeck (mounted in App) and is NEVER gated by this dock's open state
 *  or mode toggle. */
interface BottomInputDockProps {
  keyboardProps: InputDeckKeyboardProps;
  drumProps: InputDeckDrumProps;
}

export const BottomInputDock: React.FC<BottomInputDockProps> = React.memo(({ keyboardProps, drumProps }: BottomInputDockProps) => {
  const isOpen = useLiveStore((s) => s.isInputPanelOpen);
  const setIsOpen = useLiveStore((s) => s.setIsInputPanelOpen);
  const mode = useLiveStore((s) => s.inputPanelMode);
  const setMode = useLiveStore((s) => s.setInputPanelMode);

  const {
    keyboardMode,
    setKeyboardMode,
    keyboardOctave,
    setKeyboardOctave,
    activeNotes,
    scaleRoot,
    scaleType,
    scaleLockedRows,
    chordKeyboardRows,
    handleNoteOn,
    handleNoteOff,
  } = keyboardProps;

  return (
    <div className="relative z-30 pointer-events-none">
      {/* Always-visible header: the toggle, plus (when open) the Keyboard | Drums tabs. */}
      <div className="absolute bottom-full left-0 flex items-center gap-1.5 p-1 bg-base-100 rounded-t-lg border border-base-300 pointer-events-auto">
        <button
          id="btn-toggle-input-deck"
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
          className="btn btn-xs btn-ghost gap-1 text-xs font-bold"
          title={isOpen ? 'Hide input deck' : 'Show input deck'}
        >
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          <span>Input</span>
        </button>

        {isOpen && (
          <div className="join" role="radiogroup" aria-label="Input deck panel">
            {(['keyboard', 'drums'] as const).map((m) => (
              <button
                key={m}
                id={`input-tab-${m}`}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`btn btn-xs join-item text-[11px] font-semibold ${
                  mode === m ? 'btn-primary' : 'btn-ghost text-base-content/60'
                }`}
              >
                {m === 'keyboard' ? 'Keyboard' : 'Drums'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Collapsible body: grid-template-rows 0fr -> 1fr animates the intrinsic
          height without fighting auto-sized content. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out pointer-events-auto ${
          isOpen ? 'bg-base-100 grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          {isOpen && mode === 'keyboard' && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={SECTION_HEADER}>Keyboard</span>
                  <span
                    className="badge badge-sm badge-outline text-[10px] font-semibold badge-base-content/60"
                    title="Active key and scale"
                  >
                    {`${scaleRoot} ${scaleType}`}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-base-content/50 mr-1">KB OCT</span>
                  <button
                    id="btn-keyboard-octave-down"
                    type="button"
                    onClick={() => setKeyboardOctave((o) => Math.max(-2, o - 1))}
                    disabled={keyboardOctave <= -2}
                    className="btn btn-xs btn-square btn-ghost w-7 h-7 min-h-0 border border-base-300 text-base-content/60 hover:text-base-content hover:border-primary hover:bg-primary/20 disabled:opacity-30"
                    title="Keyboard Octave Down"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="badge badge-primary badge-outline min-w-13 h-7 px-2">
                    <span className="text-xs font-mono font-bold">
                      {keyboardOctave >= 0 ? `+${keyboardOctave}` : keyboardOctave} Oct
                    </span>
                  </div>
                  <button
                    id="btn-keyboard-octave-up"
                    type="button"
                    onClick={() => setKeyboardOctave((o) => Math.min(2, o + 1))}
                    disabled={keyboardOctave >= 2}
                    className="btn btn-xs btn-square btn-ghost w-7 h-7 min-h-0 border border-base-300 text-base-content/60 hover:text-base-content hover:border-primary hover:bg-primary/20 disabled:opacity-30"
                    title="Keyboard Octave Up"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  <div className="join" role="radiogroup" aria-label="Keyboard input mode">
                    {(['chromatic', 'scale-locked', 'chord'] as const).map((m) => (
                      <button
                        key={m}
                        id={`btn-keyboard-mode-${m}`}
                        type="button"
                        role="radio"
                        aria-checked={keyboardMode === m}
                        onClick={() => setKeyboardMode(m)}
                        className={`btn btn-xs join-item text-[11px] font-semibold ${
                          keyboardMode === m
                            ? 'btn-primary'
                            : 'btn-ghost border border-base-300 text-base-content/60'
                        }`}
                        title={
                          m === 'chromatic'
                            ? 'Chromatic Mode: every semitone, ignores key/scale'
                            : m === 'scale-locked'
                              ? 'Scale Locked Mode: cuts notes outside the active scale'
                              : 'Chord Mode: diatonic triads per scale degree, plus a melody zone'
                        }
                      >
                        {m === 'chromatic'
                          ? 'Chromatic'
                          : m === 'scale-locked'
                            ? 'Scale'
                            : 'Chord'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div
                // `justify-center-safe`, not `justify-center`: a keyboard wider
                // than this box is centred by the plain keyword, which pushes
                // its first keys off the LEFT edge — past scroll position 0, so
                // they cannot be reached at all. The -safe variant falls back to
                // flex-start exactly when the content overflows.
                // The short-viewport height is what keeps a landscape phone
                // whole: the navbar, vibes bar and transport bar are all
                // `shrink-0`, so at 180px this box plus its toolbar overran
                // 390px of screen and the overflow was clipped off the top of
                // the app. See KeyCap for the matching row height.
                className={`flex justify-center-safe relative h-45 [@media(max-height:560px)]:h-36 select-none bg-base-300 p-2 rounded-box border border-base-300 overflow-x-auto ${
                  keyboardMode === 'scale-locked' || keyboardMode === 'chord'
                    ? 'flex-col gap-1.5'
                    : ''
                }`}
              >
                {keyboardMode === 'chord' ? (
                  <ChordKeyboard
                    rows={chordKeyboardRows}
                    activeNotes={activeNotes}
                    onNoteOn={handleNoteOn}
                    onNoteOff={handleNoteOff}
                  />
                ) : keyboardMode === 'scale-locked' ? (
                  <ScaleLockedKeyboard
                    rows={scaleLockedRows}
                    activeNotes={activeNotes}
                    onNoteOn={handleNoteOn}
                    onNoteOff={handleNoteOff}
                  />
                ) : (
                  <ChromaticKeyboard
                    octaveOffset={keyboardOctave}
                    activeNotes={activeNotes}
                    onNoteOn={handleNoteOn}
                    onNoteOff={handleNoteOff}
                  />
                )}
              </div>
            </div>
          )}

          {isOpen && mode === 'drums' && (
            <div className="px-3 pb-3">
              <DrumPadGrid {...drumProps} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
