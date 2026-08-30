import type { SynthParams, ViewMode } from '../types';

export type SynthControlTarget = 'synth' | 'chord' | 'bass';

// Per-destination accent styling, shared by every surface that edits a target:
// the Target selector, the Pro/Simple panel cards and the preset drawer header.
// synth = neutral (no tint), chord = module-chord (olive), bass = module-bass
// (steel blue) — module identity colours, not daisyUI semantics. The tints are
// flat `@utility` image layers declared in index.css; see the note there for why
// they are not background-colours. `tint` is kept apart from `ring` because a
// full-height drawer panel wants the colour wash without an outline around it;
// `activeBtn`/`badge` are modifier fragments — the call site owns the base
// `btn`/`badge` classes.
export const SYNTH_TARGET_STYLES: Record<
  SynthControlTarget,
  { label: string; tint: string; ring: string; activeBtn: string; badge: string }
> = {
  synth: { label: 'Lead', tint: '', ring: '', activeBtn: 'btn-active', badge: '' },
  chord: {
    label: 'Chord',
    tint: 'tint-chord',
    ring: 'ring-1 ring-module-chord/40',
    activeBtn: '[--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]',
    badge: '[--badge-color:var(--color-module-chord)]',
  },
  bass: {
    label: 'Bass',
    tint: 'tint-bass',
    ring: 'ring-1 ring-module-bass/40',
    activeBtn: '[--btn-color:var(--color-module-bass)] [--btn-fg:var(--color-module-bass-content)]',
    badge: '[--badge-color:var(--color-module-bass)]',
  },
};

export interface SynthParamChannel {
  params: SynthParams;
  setParams: (params: SynthParams) => void;
}

export function resolveSynthControlChannel(
  target: SynthControlTarget,
  channels: { synth: SynthParamChannel; chord: SynthParamChannel; bass: SynthParamChannel }
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
  nav.setActiveTab('synth');
}
