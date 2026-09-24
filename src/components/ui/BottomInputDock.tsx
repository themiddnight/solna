import React from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Link2, Unlink2 } from 'lucide-react';
// Store reads go through `useLiveStore` inside this hook, so a test's setState
// before renderToString shows up in the markup (R257).
import { useBottomInputDock } from './useBottomInputDock';
import { ChromaticKeyboard, ScaleLockedKeyboard, ChordKeyboard, type KeyboardVariant } from './Keyboard';
import { DrumPadGrid } from './DrumPadGrid';
import { SECTION_HEADER } from './fieldClasses';
import { IconButton } from './IconButton';
import { formatKeyLabel } from '@/utils/noteSpelling';
import type { InputDeckDrumProps, InputDeckKeyboardProps } from '../useInputDeck';
import { TOOLBAR_BUTTON_IDLE } from '@/components/ui/Toolbar';
import { MIX_LAYER_LABELS } from '../mixLayers';
import { MIX_LAYER_IDS, type MixLayerId } from '@/store/focusTrack';

const KEYBOARD_MODE_LABELS = {
  chromatic: 'Chromatic',
  'scale-locked': 'Scale',
  chord: 'Chord',
} as const;

const KEYBOARD_MODES = ['chromatic', 'scale-locked', 'chord'] as const;

const KEYBOARD_MODE_TITLES = {
  chromatic: 'Chromatic Mode: every semitone, ignores key/scale',
  'scale-locked': 'Scale Locked Mode: cuts notes outside the active scale',
  chord: 'Chord Mode: diatonic triads per scale degree, plus a melody zone',
} as const;

/** The bottom input deck: a purely visual/touch surface hosting the synth
 *  keyboard or the drum pads, whichever the input target plays. QWERTY input
 *  is owned by useInputDeck (mounted in App) and is NEVER gated by this dock's
 *  open state. */
interface BottomInputDockProps {
  keyboardProps: InputDeckKeyboardProps;
  drumProps: InputDeckDrumProps;
  /** The frame's choice of keyboard surface (R340); the mobile frame asks for `mobile`. */
  keyboardVariant?: KeyboardVariant;
}

/** Linked: both halves of the target group wear this tint; pinned, they drop to the idle toolbar style. */
const LINKED_STYLE = 'btn-soft btn-accent';

const LOCKED_TITLE = 'Recording — the keys stay on the armed track';

/*
 * DROPDOWN_TRIGGER_NOTE — daisyUI's dropdown opens only on :focus-within, and
 * Safari (iOS and macOS) never focuses a <button> on tap or click, so a
 * <button> trigger leaves the menu shut on an iPhone. The triggers are
 * therefore focusable `role="button"` elements, the same shape as the project
 * menu's Wordmark trigger.
 */

/**
 * The item list of a dock header dropdown (the target chip, the keyboard mode
 * chip): one button per option, the current one marked.
 */
function DockMenu<T extends string>({
  options,
  current,
  idPrefix,
  labels,
  titles,
  onPick,
}: {
  options: readonly T[];
  current: T;
  idPrefix: string;
  labels: Readonly<Record<T, string>>;
  titles?: Readonly<Record<T, string>>;
  onPick: (option: T) => void;
}) {
  return (
    <ul
      // Focusable so a tap inside keeps the dropdown's :focus-within: Safari
      // never focuses a tapped <button>, so without this the focus falls to
      // <body> on pointer-down and the menu closes before the item's click.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="dropdown-content menu menu-sm z-50 mb-1 w-36 rounded-box bg-base-100 border border-base-300 p-1 shadow-lg"
    >
      {options.map((option) => (
        <li key={option}>
          <button
            id={`${idPrefix}-${option}`}
            type="button"
            aria-current={current === option ? 'true' : undefined}
            onClick={() => {
              onPick(option);
              // daisyUI opens the dropdown on :focus-within, and picking an
              // item leaves DOM focus inside it — on the item, or on the list
              // in Safari, which never focuses a tapped <button> — so without
              // this the menu stays open over the dock after selection.
              (document.activeElement as HTMLElement | null)?.blur();
            }}
            className={current === option ? 'active font-bold' : ''}
            title={titles?.[option]}
          >
            {labels[option]}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The target chip and its link toggle, one joined group: which track the keys
 * play, and whether that follows the selection (R341).
 *
 * ALWAYS visible — open, collapsed, on every tab and every Pattern segment —
 * because the dock is the one surface all of them share, and "which track will
 * the keyboard play" has to be answerable without navigating. A daisyUI
 * dropdown rather than a cycling button: six values is too many to step
 * through, and a menu shows the whole roster at once.
 *
 * Linked, a pick selects the track (and the page follows); pinned, a pick
 * moves only the pin — see `pickInputTarget`.
 */
function InputTargetGroup({
  target,
  isPinned,
  isLocked,
  onPick,
  onToggleLink,
}: {
  target: MixLayerId;
  isPinned: boolean;
  isLocked: boolean;
  onPick: (id: MixLayerId) => void;
  onToggleLink: () => void;
}) {
  const style = isPinned ? TOOLBAR_BUTTON_IDLE : LINKED_STYLE;
  const linkTitle = isPinned ? 'Pinned — follow selection again' : 'Follow selection';
  // Armed, the keys must play the armed track (the recorder writes every
  // performed note there), so both halves lock to the selection. A locked
  // chip drops its tabIndex so it cannot take focus, which is what keeps
  // daisyUI's dropdown shut.
  return (
    <div id="input-target-group" className="join" title={isLocked ? LOCKED_TITLE : undefined}>
      <div className="dropdown dropdown-top flex">
        {/* A focusable <div>, not a <button>: see DROPDOWN_TRIGGER_NOTE. */}
        <div
          id="btn-focus-chip"
          role="button"
          tabIndex={isLocked ? undefined : 0}
          aria-disabled={isLocked ? 'true' : undefined}
          aria-label={`Keys play ${MIX_LAYER_LABELS[target]}`}
          className={`btn btn-xs join-item gap-1 text-[11px] font-semibold ${style}${isLocked ? ' btn-disabled' : ''}`}
          title={isLocked ? LOCKED_TITLE : 'Which track the keys play'}
        >
          <span className="text-base-content/50 uppercase tracking-wider text-[9px]">On</span>
          <span>{MIX_LAYER_LABELS[target]}</span>
          <ChevronDown aria-hidden="true" className="w-3 h-3 opacity-60" />
        </div>
        <DockMenu
          options={MIX_LAYER_IDS}
          current={target}
          idPrefix="btn-focus-chip"
          labels={MIX_LAYER_LABELS}
          onPick={onPick}
        />
      </div>
      {/* One constant name with aria-pressed, not a name that flips with the
          state: "Follow selection", pressed while linked. The title carries
          the spec's two wordings for the pointer. */}
      <button
        id="btn-input-target-link"
        type="button"
        aria-label="Follow selection"
        aria-pressed={!isPinned}
        disabled={isLocked}
        onClick={onToggleLink}
        className={`btn btn-xs btn-square join-item ${style}`}
        title={isLocked ? LOCKED_TITLE : linkTitle}
      >
        {isPinned ? <Unlink2 className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

/**
 * The keyboard mode picker (Chromatic / Scale / Chord), in the header open or
 * collapsed: the dock owns live QWERTY input even when closed, and each mode
 * binds those keys differently, so which mode they drive is answerable — and
 * changeable — without opening the deck. A dropdown like the target chip.
 * Not rendered for a drum target: the pads have no mode.
 */
function KeyboardModePicker({
  keyboardMode,
  onSelect,
}: {
  keyboardMode: InputDeckKeyboardProps['keyboardMode'];
  onSelect: InputDeckKeyboardProps['setKeyboardMode'];
}) {
  return (
    <div className="dropdown dropdown-top flex">
      {/* A focusable <div>, not a <button>: see DROPDOWN_TRIGGER_NOTE. */}
      <div
        id="btn-keyboard-mode-chip"
        role="button"
        tabIndex={0}
        aria-label={`Keyboard mode: ${KEYBOARD_MODE_LABELS[keyboardMode]}`}
        className={`btn btn-xs gap-1 text-[11px] font-semibold ${TOOLBAR_BUTTON_IDLE}`}
        title={KEYBOARD_MODE_TITLES[keyboardMode]}
      >
        <span>{KEYBOARD_MODE_LABELS[keyboardMode]}</span>
        <ChevronDown aria-hidden="true" className="w-3 h-3 opacity-60" />
      </div>
      <DockMenu
        options={KEYBOARD_MODES}
        current={keyboardMode}
        idPrefix="btn-keyboard-mode"
        labels={KEYBOARD_MODE_LABELS}
        titles={KEYBOARD_MODE_TITLES}
        onPick={onSelect}
      />
    </div>
  );
}

/** The keyboard panel's header row: key/scale badge and the octave stepper. */
function KeyboardToolbar({
  scaleRoot,
  scaleType,
  keyboardOctave,
  setKeyboardOctave,
}: {
  scaleRoot: string;
  scaleType: string;
  keyboardOctave: number;
  setKeyboardOctave: InputDeckKeyboardProps['setKeyboardOctave'];
}) {
  return (
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
      </div>
    </div>
  );
}

interface KeyboardSurfaceProps {
  keyboardMode: InputDeckKeyboardProps['keyboardMode'];
  keyboardOctave: number;
  chordKeyboardRows: InputDeckKeyboardProps['chordKeyboardRows'];
  scaleLockedRows: InputDeckKeyboardProps['scaleLockedRows'];
  activeNotes: InputDeckKeyboardProps['activeNotes'];
  onNoteOn: InputDeckKeyboardProps['handleNoteOn'];
  onNoteOff: InputDeckKeyboardProps['handleNoteOff'];
  variant: KeyboardVariant;
}

/** The playable surface under the toolbar, in whichever mode is active. */
function KeyboardSurface({
  keyboardMode,
  keyboardOctave,
  chordKeyboardRows,
  scaleLockedRows,
  activeNotes,
  onNoteOn,
  onNoteOff,
  variant,
}: KeyboardSurfaceProps) {
  return (
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
      // The mobile surface never scrolls: its keys share the width (R340).
      className={`flex justify-center-safe relative h-45 [@media(max-height:560px)]:h-36 select-none bg-base-300 p-2 rounded-box border border-base-300 ${
        variant === 'mobile' ? 'overflow-hidden' : 'overflow-x-auto'
      } ${
        keyboardMode === 'scale-locked' || keyboardMode === 'chord'
          ? 'flex-col gap-1.5'
          : ''
      }`}
    >
      {keyboardMode === 'chord' ? (
        <ChordKeyboard
          rows={chordKeyboardRows}
          activeNotes={activeNotes}
          onNoteOn={onNoteOn}
          onNoteOff={onNoteOff}
          variant={variant}
        />
      ) : keyboardMode === 'scale-locked' ? (
        <ScaleLockedKeyboard
          rows={scaleLockedRows}
          activeNotes={activeNotes}
          onNoteOn={onNoteOn}
          onNoteOff={onNoteOff}
          variant={variant}
        />
      ) : (
        <ChromaticKeyboard
          octaveOffset={keyboardOctave}
          activeNotes={activeNotes}
          onNoteOn={onNoteOn}
          onNoteOff={onNoteOff}
          variant={variant}
        />
      )}
    </div>
  );
}

export const BottomInputDock = React.memo(function BottomInputDock({
  keyboardProps,
  drumProps,
  keyboardVariant = 'desktop',
}: BottomInputDockProps) {
  const { isOpen, toggleOpen, target, isPinned, isLocked, panel, onPickTarget, onToggleLink } =
    useBottomInputDock();

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
      {/* Always-visible header, one row down to 375px: the toggle, the target
          chip with its link, and (for a keyboard target) the mode picker. The
          panel has no tabs: it is derived from the target (R341). */}
      <div className="absolute bottom-full left-0 flex items-center gap-1.5 p-1 bg-base-100 rounded-t-lg border border-base-300 pointer-events-auto">
        <button
          id="btn-toggle-input-deck"
          type="button"
          aria-expanded={isOpen}
          onClick={toggleOpen}
          className="btn btn-xs btn-ghost gap-1 text-xs font-bold"
          title={isOpen ? 'Hide input deck' : 'Show input deck'}
        >
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          {/* sr-only below md rather than hidden: the word is the button's
              accessible name, so it must stay in the tree on the phone. */}
          <span className="sr-only md:not-sr-only">Input</span>
        </button>

        <InputTargetGroup
          target={target}
          isPinned={isPinned}
          isLocked={isLocked}
          onPick={onPickTarget}
          onToggleLink={onToggleLink}
        />

        {panel === 'keyboard' && (
          <KeyboardModePicker keyboardMode={keyboardMode} onSelect={setKeyboardMode} />
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
          {isOpen && panel === 'keyboard' && (
            <div className="p-3 space-y-2">
              <KeyboardToolbar
                scaleRoot={scaleRoot}
                scaleType={scaleType}
                keyboardOctave={keyboardOctave}
                setKeyboardOctave={setKeyboardOctave}
              />

              <KeyboardSurface
                keyboardMode={keyboardMode}
                keyboardOctave={keyboardOctave}
                chordKeyboardRows={chordKeyboardRows}
                scaleLockedRows={scaleLockedRows}
                activeNotes={activeNotes}
                onNoteOn={handleNoteOn}
                onNoteOff={handleNoteOff}
                variant={keyboardVariant}
              />
            </div>
          )}

          {isOpen && panel === 'drums' && (
            <div className="px-3 pb-3">
              <DrumPadGrid {...drumProps} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
