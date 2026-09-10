import React from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
// The shared hook, not a private copy: its docstring names THIS file as the
// reference implementation, so a fix to the snapshot contract that skipped the
// dock would skip the component the rule was written for.
import { useLiveStore } from './useLiveStore';
import { ChromaticKeyboard, ScaleLockedKeyboard, ChordKeyboard } from './Keyboard';
import { DrumPadGrid } from './DrumPadGrid';
import { SECTION_HEADER } from './fieldClasses';
import { IconButton } from './IconButton';
import { formatKeyLabel } from '@/utils/noteSpelling';
import type { InputDeckDrumProps, InputDeckKeyboardProps } from '../useInputDeck';
import { TOOLBAR_BUTTON_IDLE } from '@/components/ui/Toolbar';
import { MIX_LAYERS } from '../mixLayers';
import { MIX_LAYER_IDS, type MixLayerId } from '@/store/focusTrack';

const PANEL_LABELS = { keyboard: 'Keyboard', drums: 'Drums' } as const;

/**
 * The focused track's name, keyed by focus id. Read off MIX_LAYERS rather than
 * spelled again, so the chip and the mixer row for the same track can never
 * disagree — `'synth'` is "Lead" and `'drum'` is "Beat" in both.
 */
export const FOCUS_CHIP_LABELS: Record<MixLayerId, string> = Object.fromEntries(
  MIX_LAYERS.map((layer) => [layer.idPrefix, layer.label]),
) as Record<MixLayerId, string>;

const KEYBOARD_MODE_LABELS = {
  chromatic: 'Chromatic',
  'scale-locked': 'Scale',
  chord: 'Chord',
} as const;

const KEYBOARD_MODE_TITLES = {
  chromatic: 'Chromatic Mode: every semitone, ignores key/scale',
  'scale-locked': 'Scale Locked Mode: cuts notes outside the active scale',
  chord: 'Chord Mode: diatonic triads per scale degree, plus a melody zone',
} as const;

/** The bottom input deck: a purely visual/touch surface hosting the synth
 *  keyboard and the drum pads in one panel. QWERTY input is owned by
 *  useInputDeck (mounted in App) and is NEVER gated by this dock's open state
 *  or mode toggle. */
interface BottomInputDockProps {
  keyboardProps: InputDeckKeyboardProps;
  drumProps: InputDeckDrumProps;
}

export const BottomInputDock = React.memo(function BottomInputDock({ keyboardProps, drumProps }: BottomInputDockProps) {
  const isOpen = useLiveStore((s) => s.isInputPanelOpen);
  const setIsOpen = useLiveStore((s) => s.setIsInputPanelOpen);
  const mode = useLiveStore((s) => s.inputPanelMode);
  const setMode = useLiveStore((s) => s.setInputPanelMode);
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useLiveStore((s) => s.setFocusTrack);

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

  const collapsedSummary =
    mode === 'keyboard'
      ? `${PANEL_LABELS.keyboard} · ${KEYBOARD_MODE_LABELS[keyboardMode]}`
      : PANEL_LABELS.drums;

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
          title={isOpen ? 'Hide input deck' : `Show input deck (${collapsedSummary})`}
        >
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          <span>Input</span>
        </button>

        {/* The focus chip. ALWAYS visible — open, collapsed, on every tab and
            every Pattern segment — because the dock is the one surface all of
            them share, and "which track will the keyboard play" has to be
            answerable without navigating. A daisyUI dropdown rather than a
            cycling button: six values is too many to step through, and a menu
            shows the whole roster at once. */}
        <div className="dropdown dropdown-top">
          <button
            id="btn-focus-chip"
            type="button"
            aria-label={`Working on ${FOCUS_CHIP_LABELS[focusTrack]}`}
            className={`btn btn-xs gap-1 text-[11px] font-semibold ${TOOLBAR_BUTTON_IDLE}`}
            title="Which track you are working on"
          >
            <span className="text-base-content/50 uppercase tracking-wider text-[9px]">On</span>
            <span>{FOCUS_CHIP_LABELS[focusTrack]}</span>
          </button>
          <ul
            className="dropdown-content menu menu-sm z-40 mb-1 w-36 rounded-box bg-base-100 border border-base-300 p-1 shadow-lg"
          >
            {MIX_LAYER_IDS.map((id) => (
              <li key={id}>
                <button
                  id={`btn-focus-chip-${id}`}
                  type="button"
                  aria-current={focusTrack === id ? 'true' : undefined}
                  onClick={(e) => {
                    setFocusTrack(id);
                    // daisyUI opens this dropdown on :focus-within, and picking
                    // an item leaves DOM focus on the item itself, so without
                    // this the menu stays open over the dock after selection.
                    (e.currentTarget as HTMLElement).blur();
                  }}
                  className={focusTrack === id ? 'active font-bold' : ''}
                >
                  {FOCUS_CHIP_LABELS[id]}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Collapsed, the dock still owns live QWERTY input, and each keyboard
            mode binds those keys differently — so the closed header states
            which surface and which mode the typing keys are currently driving
            rather than making the user open the deck to find out. */}
        {!isOpen && (
          <div id="input-deck-collapsed-summary" className="flex items-center gap-1 pr-1">
            {/* A real text node, not an `aria-label` on this div: ARIA does not
                expose aria-label on a generic element with no role, so the
                framing was announced to nobody and the badges read as two bare
                words. `sr-only` keeps it out of the visual row, where the
                badges already say it. */}
            <span className="sr-only">{`Current input: ${collapsedSummary}`}</span>
            <span className="badge badge-sm badge-outline badge-primary text-[10px] font-semibold">
              {PANEL_LABELS[mode]}
            </span>
            {mode === 'keyboard' && (
              <span
                className="badge badge-sm badge-outline text-[10px] font-semibold text-base-content/60"
                title={KEYBOARD_MODE_TITLES[keyboardMode]}
              >
                {KEYBOARD_MODE_LABELS[keyboardMode]}
              </span>
            )}
          </div>
        )}

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
                {PANEL_LABELS[m]}
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
                    {formatKeyLabel(scaleRoot, scaleType)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-base-content/50 mr-1">KB OCT</span>
                  <IconButton
                    id="btn-keyboard-octave-down"
                    label="Keyboard Octave Down"
                    icon={<ChevronLeft className="w-4 h-4" />}
                    size="xs"
                    onClick={() => setKeyboardOctave((o) => Math.max(-2, o - 1))}
                    disabled={keyboardOctave <= -2}
                    className="w-7 h-7 min-h-0 border border-base-300 text-base-content/60 hover:text-base-content hover:border-primary hover:bg-primary/20 disabled:opacity-30"
                  />
                  <div className="badge badge-primary badge-outline min-w-13 h-7 px-2">
                    <span className="text-xs tabular-nums font-bold">
                      {keyboardOctave >= 0 ? `+${keyboardOctave}` : keyboardOctave} Oct
                    </span>
                  </div>
                  <IconButton
                    id="btn-keyboard-octave-up"
                    label="Keyboard Octave Up"
                    icon={<ChevronRight className="w-4 h-4" />}
                    size="xs"
                    onClick={() => setKeyboardOctave((o) => Math.min(2, o + 1))}
                    disabled={keyboardOctave >= 2}
                    className="w-7 h-7 min-h-0 border border-base-300 text-base-content/60 hover:text-base-content hover:border-primary hover:bg-primary/20 disabled:opacity-30"
                  />

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
                            : TOOLBAR_BUTTON_IDLE
                        }`}
                        title={KEYBOARD_MODE_TITLES[m]}
                      >
                        {KEYBOARD_MODE_LABELS[m]}
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
