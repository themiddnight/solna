import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
  arePropsEqual,
  BEAT_VOICE_CARD_PROP_KEYS,
  BeatVoiceCard,
  type BeatVoiceCardProps,
} from './BeatVoiceCard';
import { BEAT_VOICE_ROWS } from './beatVoices';
import { DEFAULT_BEAT_VOICES } from '@/data/beatPresets';
import type { BeatVoices } from '@/types';

/**
 * Simulates one knob drag frame on a SINGLE voice, the way
 * `BeatSoundSection`'s `draftVoiceParam` -> `withVoiceParam` actually builds
 * the next `voices` record: a fresh top-level object every frame, but only
 * the dragged voice's own nested object gets a new reference — the other ten
 * keep theirs. This is the exact shape `BeatVoiceCard`'s custom comparator
 * has to see through for `React.memo` to bail on the untouched cards.
 */
function draggedVoices(voices: BeatVoices, draggedVoice: keyof BeatVoices): BeatVoices {
  return {
    ...voices,
    [draggedVoice]: { ...(voices[draggedVoice] as unknown as Record<string, number>), gain: 0.99 },
  } as BeatVoices;
}

function baseProps(overrides: Partial<BeatVoiceCardProps> = {}): BeatVoiceCardProps {
  return {
    voice: 'kick',
    meta: BEAT_VOICE_ROWS[0],
    ordinal: 1,
    voices: DEFAULT_BEAT_VOICES,
    depth: 'simple',
    onPreview: () => {},
    onDraft: () => {},
    onCommit: () => {},
    onCancel: () => {},
    onReset: () => {},
    resetDisabled: false,
    muted: false,
    ...overrides,
  };
}

describe('arePropsEqual (BeatVoiceCard React.memo comparator)', () => {
  test('a knob drag on ANOTHER voice leaves the other ten voices at equal props', () => {
    // Every BeatVoiceCard is handed the SAME onPreview/onDraft/onCommit/onCancel/
    // onReset references and the SAME top-level `voices` object identity churn
    // (see `draggedVoices` above) on every render of the grid — what must
    // differ, for a card whose own voice was not dragged, is nothing at all.
    const stableCallbacks = {
      onPreview: () => {},
      onDraft: () => {},
      onCommit: () => {},
      onCancel: () => {},
      onReset: () => {},
    };
    const before = baseProps({ voice: 'snare', meta: BEAT_VOICE_ROWS[1], ...stableCallbacks });
    const nextVoices = draggedVoices(DEFAULT_BEAT_VOICES, 'kick');
    const after = { ...before, voices: nextVoices };

    // The top-level `voices` reference DID change (proving this isn't a
    // vacuous pass because nothing changed at all)...
    expect(before.voices).not.toBe(after.voices);
    // ...but snare's own slice of it did not, and the comparator must see
    // that and report the props as equal — this is what stops all ten
    // untouched cards from re-rendering on a single knob's drag frame.
    expect(arePropsEqual(before, after)).toBe(true);
  });

  test('a knob drag on THIS card\'s own voice reports props as unequal', () => {
    const before = baseProps({ voice: 'kick', meta: BEAT_VOICE_ROWS[0] });
    const after = { ...before, voices: draggedVoices(DEFAULT_BEAT_VOICES, 'kick') };

    expect(arePropsEqual(before, after)).toBe(false);
  });

  test('a non-stable callback reference reports props as unequal', () => {
    // Guards the OTHER half of the fix: if a future caller regresses back to
    // building a per-row closure (see `BeatVoiceGrid`'s pre-fix `.map()`),
    // this must still catch it and force a re-render rather than silently
    // keeping a stale handler.
    const before = baseProps();
    const after = { ...before, onDraft: () => {} };

    expect(arePropsEqual(before, after)).toBe(false);
  });

  test('all eleven voices compare equal across a single-voice drag except the dragged one', () => {
    const nextVoices = draggedVoices(DEFAULT_BEAT_VOICES, 'hihat');
    const stableCallbacks = {
      onPreview: () => {},
      onDraft: () => {},
      onCommit: () => {},
      onCancel: () => {},
      onReset: () => {},
    };

    const results = BEAT_VOICE_ROWS.map((row) => {
      const before = baseProps({ voice: row.id, meta: row, ...stableCallbacks });
      const after = { ...before, voices: nextVoices };
      return { voice: row.id, equal: arePropsEqual(before, after) };
    });

    const changed = results.filter((r) => !r.equal).map((r) => r.voice);
    expect(changed).toEqual(['hihat']);
  });

  /**
   * Minor #1 (final review): a future 13th prop on `BeatVoiceCardProps` that
   * `arePropsEqual`'s hand-written `&&` chain forgets to compare would
   * otherwise be silently ignored by the comparator — the memo would then
   * bail on a real prop change with no failing test anywhere.
   * `BEAT_VOICE_CARD_PROP_KEYS` (BeatVoiceCard.tsx) closes the compile-time
   * half: TypeScript refuses to build a `Record<keyof BeatVoiceCardProps,
   * true>` missing an entry. This suite closes the runtime half: every key
   * in that table must actually flip `arePropsEqual`'s verdict when changed
   * alone, so a key present in the table but never wired into the
   * comparator's own chain still fails here.
   */
  describe('arePropsEqual is exhaustive over BeatVoiceCardProps', () => {
    const distinctValue: {
      [K in keyof BeatVoiceCardProps]: (p: BeatVoiceCardProps) => BeatVoiceCardProps[K];
    } = {
      voice: () => 'snare',
      meta: () => BEAT_VOICE_ROWS[1]!,
      ordinal: (p) => p.ordinal + 1,
      // Changing the CARD'S OWN voice's slice, not just the top-level
      // reference — a top-level-only change is exactly what the comparator
      // must see THROUGH (see the "single-voice drag" test above), so it
      // would not prove this key is wired in at all.
      voices: (p) => draggedVoices(p.voices, p.voice),
      depth: () => 'pro',
      onPreview: () => () => {},
      muted: (p) => !p.muted,
      onDraft: () => () => {},
      onCommit: () => () => {},
      onCancel: () => () => {},
      onReset: () => () => {},
      resetDisabled: (p) => !p.resetDisabled,
    };

    for (const key of Object.keys(BEAT_VOICE_CARD_PROP_KEYS) as (keyof BeatVoiceCardProps)[]) {
      test(`changing "${key}" alone makes arePropsEqual report unequal`, () => {
        const before = baseProps();
        const after = { ...before, [key]: distinctValue[key](before) } as BeatVoiceCardProps;

        expect(arePropsEqual(before, after)).toBe(false);
      });
    }
  });
});

describe('BeatVoiceCard', () => {
  test('renders its own voice label', () => {
    // renderToString cannot exercise a click/change handler (no DOM) — this
    // pins markup only. That each handler is called with the card's own
    // `voice` (rather than pre-bound by the caller) is the type-level change
    // `BeatVoiceCardProps` above enforces and `BeatVoiceGrid.tsx` relies on;
    // the `arePropsEqual` suite above is what proves the render-count payoff.
    const html = renderToString(<BeatVoiceCard {...baseProps({ voice: 'kick', meta: BEAT_VOICE_ROWS[0] })} />);
    expect(html).toContain('Kick');
  });
});
