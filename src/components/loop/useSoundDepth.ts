import { useState } from 'react';
import { Minimize2, Sliders, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isMelodicFocus, type MixLayerId } from '@/store/focusTrack';

/**
 * How deep the Sound tab shows whatever is focused.
 *
 * `minimal` is the DRUM scope's alone and hides the per-voice editor outright,
 * leaving the kit row's bus filter — see `SCOPE_DEPTHS`. It is a third value
 * rather than a flag beside the depth because it IS the same question the
 * switch already asks: how much of this instrument do I want on screen. A
 * boolean would be a second disclosure model rendered by the same control.
 */
export type SoundDepth = 'minimal' | 'simple' | 'pro';

/**
 * Which instrument's depth preference this is. Depth fluency is per
 * INSTRUMENT, not per person: someone can go deep on the synth and still want
 * Beat's editor to show only the essentials, so the melodic and drum values
 * are held and stored independently. A single shared value was tried first —
 * it forced a user to pick one preference for both editors, and switching
 * focus silently changed whichever editor they had not been looking at.
 */
export type DepthScope = 'melodic' | 'drum';

function scopeForFocus(focus: MixLayerId): DepthScope {
  return isMelodicFocus(focus) ? 'melodic' : 'drum';
}

/**
 * What each scope offers, in toggle order, with the words for it — ONE table,
 * because the order and the vocabulary have to agree and a scope that offers a
 * depth is exactly a scope that has a word for it.
 *
 * The scopes offer DIFFERENT LISTS, which is what makes `minimal` melodic-proof
 * structurally rather than by a lookup that can miss: a synth channel has no
 * "the bus and nothing else" state to show, because its filter is one stage of
 * the patch rather than a bus every voice feeds.
 *
 * The synth's Simple/Pro is a real depth split: two panel trees, a macro deck
 * against raw per-stage parameters. Beat's Essential/All is pure disclosure
 * over ONE parameter model, where every knob writes one stored field at either
 * depth and the deep state shows strictly more of the same knobs. Calling that
 * "Pro" would make one word mean two things in one app. Reusing the VALUE
 * carries none of that risk: a user who chose depth on the synth has expressed
 * a preference about detail, and honouring it on Beat is the point.
 *
 * "Simple" appearing in both scopes is deliberate and is NOT that same trap:
 * in both it names the LEAST of the instrument, which is true of the synth's
 * macro deck and true of Beat's bus-only state. What the rule forbids is a
 * word that lies about structure, not a word that means "fewest controls"
 * twice.
 */
const SCOPE_DEPTHS: Record<
  DepthScope,
  readonly { depth: SoundDepth; label: string; title: string }[]
> = {
  melodic: [
    { depth: 'simple', label: 'Simple', title: 'Simple Mode' },
    { depth: 'pro', label: 'Pro', title: 'Pro Mode' },
  ],
  drum: [
    { depth: 'minimal', label: 'Simple', title: 'Bus filter only' },
    { depth: 'simple', label: 'Essential', title: 'Essential controls' },
    { depth: 'pro', label: 'All', title: 'All controls' },
  ],
};

/** The key the melodic value has always been written to. */
export const SOUND_DEPTH_KEY = 'musibox_sound_depth';

/**
 * The drum value's own key. It adopts no legacy key, because the drum
 * scope did not exist before this split — there is no older build whose
 * preference it could be honouring.
 */
export const DRUM_SOUND_DEPTH_KEY = 'musibox_drum_sound_depth';

/**
 * Keys an older build wrote, newest first, read-only.
 *
 * This is NOT a migration chain in the sense ADR-0023 forbids: there is no
 * version gate and no read-time transform, only one more rung on the
 * legacy-key adoption ladder this read already climbed. It exists because the
 * value's MEANING widened — it is no longer the synth's view mode, it is the
 * Sound tab's depth — so keeping the old name would make the key a lie about
 * what it stores.
 */
export const LEGACY_SOUND_DEPTH_KEYS: readonly string[] = [
  'musibox_synth_view_mode',
  'murva_synth_view_mode',
];

/** The slice of `Storage` this module uses, so a test can pass its own. */
export interface DepthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The ambient storage, resolved INSIDE a caller's `try`.
 *
 * Reaching `window.localStorage` can itself throw (Safari private mode,
 * blocked cookies, embedded webviews), which is why this is never a
 * default-parameter expression — a default argument is evaluated before the
 * guard can catch it, the same rule `settings/useThemeChoice.ts`'s theme helpers follow.
 */
function ambientStorage(): DepthStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

/** The current key for a scope, and the legacy keys (if any) it may still adopt. */
const KEYS_FOR_SCOPE: Record<DepthScope, { current: string; legacy: readonly string[] }> = {
  melodic: { current: SOUND_DEPTH_KEY, legacy: LEGACY_SOUND_DEPTH_KEYS },
  drum: { current: DRUM_SOUND_DEPTH_KEY, legacy: [] },
};

export function readSoundDepth(scope: DepthScope, storage?: DepthStorage | null): SoundDepth {
  try {
    const store = storage ?? ambientStorage();
    if (store) {
      const { current, legacy } = KEYS_FOR_SCOPE[scope];
      const isOffered = (value: string | null): boolean =>
        SCOPE_DEPTHS[scope].some((option) => option.depth === value);

      // The CURRENT key decides on its own, present or absent. A legacy key is
      // adopted only when this scope has never been written — never to repair
      // a current key holding something unoffered.
      //
      // Validated against THIS SCOPE's own list, not the union: a melodic key
      // holding `minimal` — hand-edited, or written by a build where the
      // scopes shared a list — must read as NO PREFERENCE, which is the
      // default below. Falling through to the legacy keys instead resurrected
      // whatever synth view mode was last written there, possibly months
      // stale, which is a preference the user never expressed in this scope.
      const stored = store.getItem(current);
      if (stored !== null) return isOffered(stored) ? (stored as SoundDepth) : 'simple';

      for (const key of legacy) {
        const legacyValue = store.getItem(key);
        if (isOffered(legacyValue)) return legacyValue as SoundDepth;
      }
    }
  } catch {
    // A storage that throws is a storage holding no preference.
  }
  return 'simple';
}

export function writeSoundDepth(scope: DepthScope, depth: SoundDepth, storage?: DepthStorage | null): void {
  try {
    const store = storage ?? ambientStorage();
    store?.setItem(KEYS_FOR_SCOPE[scope].current, depth);
  } catch {
    // Best-effort: a depth we cannot remember is still a depth we can show.
  }
}

/** One rendered depth button: the value it selects and the words for it. */
export interface SoundDepthOption {
  depth: SoundDepth;
  label: string;
  icon: LucideIcon;
  title: string;
}

/**
 * The icons do NOT change with the vocabulary, deliberately: it is the same
 * stored value and the same switch, so the same icons say "same control,
 * different context" across a focus change, where a second icon pair would say
 * a different control had appeared.
 */
const DEPTH_ICONS: Record<SoundDepth, LucideIcon> = {
  minimal: Minimize2,
  simple: Sliders,
  pro: Zap,
};

export function soundDepthOptions(focus: MixLayerId): readonly SoundDepthOption[] {
  return SCOPE_DEPTHS[scopeForFocus(focus)].map((option) => ({
    ...option,
    icon: DEPTH_ICONS[option.depth],
  }));
}

/**
 * The depth for whichever instrument `focus` names, as LOCAL state of
 * whichever component owns the Sound tab.
 *
 * Two independent values, not one: depth fluency is per instrument (see
 * `DepthScope`), so this hook holds BOTH the melodic and drum preference
 * unconditionally and simply selects which one `focus` currently means. That
 * unconditional shape matters — a hook that only allocated the scope it
 * needed would violate the rules of hooks the moment `focus` changed scope
 * between renders.
 *
 * Not a slice: every tab view and every Pattern segment stays mounted at once,
 * so a slice write re-renders all of them. Nothing persists it into the
 * project either — its only durability is the storage keys above.
 */
export function useSoundDepth(focus: MixLayerId, storage?: DepthStorage | null) {
  const [melodicDepth, setMelodicDepth] = useState<SoundDepth>(() => readSoundDepth('melodic', storage));
  const [drumDepth, setDrumDepth] = useState<SoundDepth>(() => readSoundDepth('drum', storage));

  const scope = scopeForFocus(focus);
  const depth = scope === 'melodic' ? melodicDepth : drumDepth;

  const setDepth = (next: SoundDepth) => {
    if (scope === 'melodic') {
      setMelodicDepth(next);
    } else {
      setDrumDepth(next);
    }
    writeSoundDepth(scope, next, storage);
  };

  return { depth, setDepth };
}
