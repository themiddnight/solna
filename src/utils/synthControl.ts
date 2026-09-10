import type { SynthParams, ViewMode } from '../types';

export type SynthControlTarget = 'synth' | 'chord' | 'bass' | 'pad' | 'fx';

// Per-destination accent styling, shared by every surface that edits a target:
// the Target selector, the Pro/Simple panel cards and the preset drawer header.
// synth = neutral (no tint), chord = module-chord (olive), bass = module-bass
// (steel blue) — module identity colours, not daisyUI semantics. The tints are
// flat `@utility` image layers declared in index.css; see the note there for why
// they are not background-colours. `tint` is kept apart from `ring` because a
// full-height drawer panel wants the colour wash without an outline around it;
// `activeBtn`/`badge`/`border` are modifier fragments — the call site owns the
// base `btn`/`badge`/`border` classes, while `slider` is a COMPLETE daisyUI
// range class list because ChannelStrip takes the whole thing.
//
// Every string here is a literal and must stay one: Tailwind v4 scans source
// statically, so a class assembled from `--color-module-${target}` at runtime
// would never be emitted (see the same note on Knob's BADGE_COLOR).
export const SYNTH_TARGET_STYLES: Record<
  SynthControlTarget,
  {
    label: string;
    tint: string;
    ring: string;
    activeBtn: string;
    /** Inactive-state modifier fragment: `btn-soft` tinted to the target's own
     * colour, so an unselected chip still reads as "this one is chord" rather
     * than falling back to a neutral `btn-ghost`. */
    softBtn: string;
    badge: string;
    /** Border tint for a container that frames the target's controls. */
    border: string;
    /** Full fader class list for `ChannelStrip`'s `sliderClassName`. */
    slider: string;
    /**
     * Icon/label tint. Kept to the literals `ui/Knob`'s `KnobColor` allows,
     * so `ChannelStrip`'s `accentClass` accepts it without a cast — spelled
     * out rather than imported because `utils/` does not reach into
     * `components/`.
     */
    accent:
      | 'text-primary'
      | 'text-module-chord'
      | 'text-module-bass'
      | 'text-module-pad'
      | 'text-module-fx';
  }
> = {
  synth: {
    label: 'Lead',
    tint: '',
    ring: '',
    // Solid primary when selected, soft primary when not — the same
    // "selected is the more filled of the two" pairing chord/bass/pad get from
    // their `--btn-color`. A bare `btn-active` here carried no hue at all,
    // which made the unselected Lead chip (soft primary) read as LOUDER than
    // the selected one, inverting the only cue this row exists to give.
    activeBtn: 'btn-primary',
    softBtn: 'btn-soft btn-primary',
    badge: '',
    border: 'border-primary',
    slider: 'range range-xs range-primary',
    accent: 'text-primary',
  },
  chord: {
    label: 'Chord',
    tint: 'tint-chord',
    ring: 'ring-1 ring-module-chord/40',
    activeBtn: '[--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]',
    softBtn: 'btn-soft [--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]',
    badge: '[--badge-color:var(--color-module-chord)]',
    border: 'border-module-chord',
    slider: 'range range-xs text-module-chord [--range-thumb:var(--color-module-chord-content)]',
    accent: 'text-module-chord',
  },
  bass: {
    label: 'Bass',
    tint: 'tint-bass',
    ring: 'ring-1 ring-module-bass/40',
    activeBtn: '[--btn-color:var(--color-module-bass)] [--btn-fg:var(--color-module-bass-content)]',
    softBtn: 'btn-soft [--btn-color:var(--color-module-bass)] [--btn-fg:var(--color-module-bass-content)]',
    badge: '[--badge-color:var(--color-module-bass)]',
    border: 'border-module-bass',
    slider: 'range range-xs text-module-bass [--range-thumb:var(--color-module-bass-content)]',
    accent: 'text-module-bass',
  },
  pad: {
    label: 'Pad',
    tint: 'tint-pad',
    ring: 'ring-1 ring-module-pad/40',
    activeBtn: '[--btn-color:var(--color-module-pad)] [--btn-fg:var(--color-module-pad-content)]',
    softBtn: 'btn-soft [--btn-color:var(--color-module-pad)] [--btn-fg:var(--color-module-pad-content)]',
    badge: '[--badge-color:var(--color-module-pad)]',
    border: 'border-module-pad',
    slider: 'range range-xs text-module-pad [--range-thumb:var(--color-module-pad-content)]',
    accent: 'text-module-pad',
  },
  fx: {
    label: 'FX',
    tint: 'tint-fx',
    ring: 'ring-1 ring-module-fx/40',
    activeBtn: '[--btn-color:var(--color-module-fx)] [--btn-fg:var(--color-module-fx-content)]',
    softBtn: 'btn-soft [--btn-color:var(--color-module-fx)] [--btn-fg:var(--color-module-fx-content)]',
    badge: '[--badge-color:var(--color-module-fx)]',
    border: 'border-module-fx',
    slider: 'range range-xs text-module-fx [--range-thumb:var(--color-module-fx-content)]',
    accent: 'text-module-fx',
  },
};

export interface SynthParamChannel {
  params: SynthParams;
  setParams: (params: SynthParams) => void;
}

export function resolveSynthControlChannel(
  target: SynthControlTarget,
  channels: {
    synth: SynthParamChannel;
    chord: SynthParamChannel;
    bass: SynthParamChannel;
    pad: SynthParamChannel;
    fx: SynthParamChannel;
  }
): SynthParamChannel {
  // Unknown runtime values (e.g. a persisted target predating this union) fall back to synth
  return channels[target] ?? channels.synth;
}

export interface SynthTargetNavigation {
  setControlTarget: (target: SynthControlTarget) => void;
  setActiveTab: (tab: ViewMode) => void;
}

export function focusSynthTarget(
  target: SynthControlTarget,
  nav: SynthTargetNavigation
): void {
  // Target first: the synth view is always mounted, so switching the tab last
  // means it never renders a frame pointed at the previous channel.
  nav.setControlTarget(target);
  nav.setActiveTab('sound');
}
