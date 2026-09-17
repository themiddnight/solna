import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import {
  ChordPresetLibrary,
  isProgressionAvailable,
  resolveCustomChords,
  templateAuditionClassName,
  customAuditionClassName,
} from './ChordPresetLibrary';
import { CHORD_PROGRESSIONS } from '@/data/chordProgressions';
import { progressionById } from '@/audio/chordProgressions';
import { SCALES } from '@/data/scales';

const source = readFileSync(
  join(process.cwd(), 'src/components/loop/ChordPresetLibrary.tsx'),
  'utf8',
);

const noop = () => {};

const html = renderToString(
  <ChordPresetLibrary
    isOpen
    onClose={noop}
    currentChords={[
      { id: 'chord-1', root: 'A', quality: 'min7', bars: 1 },
    ]}
    scaleRoot="C"
    scaleType="Major"
    autoReharmonize
    onApplyChords={noop}
  />
);

describe('ChordPresetLibrary theming', () => {
  test('template and custom cards are daisyUI cards on base tokens', () => {
    expect(html).toContain('card bg-base-200 border border-base-300');
    expect(html).toContain('hover:border-module-chord/50');
    // The custom card's hover:border-secondary/50 cannot be asserted here:
    // under renderToString, zustand's useStore takes getInitialState() as the
    // React server snapshot, which is frozen at store creation, and the custom
    // card renders only from customChordProgressions, which starts empty in
    // tests. The guard's source-level scan still enforces its tokens.
  });

  test('tags are daisyUI badges with a valid padding step', () => {
    expect(html).toContain('badge badge-sm');
    expect(html).not.toContain('py-0.2');
  });

  test('card actions are daisyUI buttons', () => {
    expect(html).toContain('btn btn-square btn-xs btn-ghost');
    expect(html).toContain('[--btn-color:var(--color-module-chord)]');
    // hover:btn-error (the custom-card delete button) is unreachable under
    // renderToString for the same frozen-server-snapshot reason as above.
  });

  /**
   * Regression: IconButton always adds `btn-ghost`, which zeroes daisyUI's
   * `--btn-bg`. Both audition buttons default that prop, so their auditioning
   * (filled, pulsing) branch has to restore `--btn-bg` itself or the fill
   * silently disappears — the bug this pins. `auditioningName` is component
   * state set only by a click handler, so it is unreachable from
   * renderToString; these two exported pure functions are the only way to
   * pin the auditioning branch's class string without a DOM.
   */
  test('the auditioning fill is restored on both audition buttons', () => {
    expect(templateAuditionClassName(true)).toContain(
      '[--btn-bg:var(--color-module-chord)] [--btn-color:var(--color-module-chord)]',
    );
    expect(customAuditionClassName(true)).toContain('btn-secondary [--btn-bg:var(--color-secondary)]');
  });

  test('the footer sits on base tokens', () => {
    expect(html).toContain('border-t border-base-300 bg-base-200');
    expect(html).toContain('btn btn-sm btn-ghost');
  });

  test('no legacy hex or palette utilities survive', () => {
    for (const s of [
      '#0B0D19',
      '#252B48',
      '#2D355A',
      '#171B36',
      '#20264A',
      '#1C213E',
      '#0E1022',
      '#1A1F3B',
      'indigo-',
      'purple-',
      'red-',
      'slate-',
      'text-white',
    ]) {
      expect(html).not.toContain(s);
    }
  });
});

describe('isProgressionAvailable', () => {
  const sevenNote = progressionById('pop-i-v-vi-iv')!;
  const fiveNote = progressionById('zen-bamboo-vamp')!;

  test('a seven-degree progression is hidden in every short scale', () => {
    for (const scaleType of ['Hirajoshi', 'Major Pentatonic', 'Minor Pentatonic', 'Blues']) {
      expect(isProgressionAvailable(sevenNote, scaleType)).toBe(false);
    }
  });

  test('a seven-degree progression is available in every seven-degree scale', () => {
    for (const [scaleType, scale] of Object.entries(SCALES)) {
      if (scale.intervals.length !== 7) continue;
      expect(isProgressionAvailable(sevenNote, scaleType)).toBe(true);
    }
  });

  test('a five-degree progression is available everywhere', () => {
    for (const scaleType of Object.keys(SCALES)) {
      expect(isProgressionAvailable(fiveNote, scaleType)).toBe(true);
    }
  });

  test('an unknown scale type is treated as seven degrees, matching SCALES own fallback', () => {
    expect(isProgressionAvailable(sevenNote, 'Pentatonic Major')).toBe(true);
  });

  test('a five-note scale leaves exactly the four zen entries', () => {
    const visible = CHORD_PROGRESSIONS.filter((p) => isProgressionAvailable(p, 'Hirajoshi'));
    expect(visible.map((p) => p.id)).toEqual([
      'zen-bamboo-vamp',
      'zen-moonlit-koto',
      'zen-still-pond',
      'zen-temple-bell',
    ]);
  });
});

describe('resolveCustomChords', () => {
  const spellingKey = { scaleRoot: 'C', scaleType: 'Major' };

  test('installs id/root/quality/bars with no notes field, whether or not reharmonized', () => {
    const source = [{ id: '', root: 'D', quality: 'min7' as const, bars: 1 }];

    const plain = resolveCustomChords(source, spellingKey, false);
    expect(plain[0].root).toBe('D');
    expect(plain[0].quality).toBe('min7');
    expect(plain[0].id).not.toBe('');
    expect(plain[0]).not.toHaveProperty('notes');

    const reharmonized = resolveCustomChords(source, spellingKey, true);
    expect(reharmonized[0]).not.toHaveProperty('notes');
  });

  test('a preserved id survives reharmonization', () => {
    const source = [{ id: 'kept-id', root: 'D', quality: 'min7' as const, bars: 1 }];
    const reharmonized = resolveCustomChords(source, spellingKey, true);
    expect(reharmonized[0].id).toBe('kept-id');
  });
});

describe('ChordPresetLibrary closed', () => {
  test('renders nothing when isOpen is false', () => {
    const closedHtml = renderToString(
      <ChordPresetLibrary
        isOpen={false}
        onClose={noop}
        currentChords={[]}
        scaleRoot="C"
        scaleType="Major"
        autoReharmonize
        onApplyChords={noop}
      />,
    );
    expect(closedHtml).toBe('');
  });
});

/**
 * Perf fix (DEV react-perf-fixes task 6): `ChordPresetLibrary` no longer
 * takes Lead's whole synth patch as a prop, so the always-mounted `ChordView`
 * that renders it (behind a closed `<Suspense>`-gated drawer, almost always)
 * no longer needs to subscribe to `s.synthParams` just to forward it here. A
 * runtime render-count is not testable in this no-DOM harness (same caveat
 * `CustomPatternTimeline.test.tsx` records for its own React.memo claim), so
 * this proves the code-shape property that implies it instead: the prop type
 * has no `synthParams` field at all (a type-level guard — this file would
 * stop compiling under `bun run lint` if the field were re-added and any
 * call site above still omitted it), and the one remaining read is a fresh
 * `useAppStore.getState()` snapshot taken inside the `audition` click
 * handler, not a prop threaded down from a subscription.
 */
describe('ChordPresetLibrary no longer subscribes to synthParams', () => {
  test('the component\'s props carry no synthParams field', () => {
    // A type-level guard: if `synthParams` were ever re-added to
    // ChordPresetLibraryProps, this assignment would stop compiling because
    // `Props` would then require the field.
    type Props = Parameters<typeof ChordPresetLibrary>[0];
    type AssertNoSynthParams = 'synthParams' extends keyof Props
      ? 'FAIL: synthParams re-added to ChordPresetLibraryProps'
      : true;
    const guard: AssertNoSynthParams = true;
    expect(guard).toBe(true);
  });

  test('audition reads a fresh synthParams snapshot at click time, not from a prop', () => {
    expect(source).toContain(
      'previewChordProgression(chordsToPlay, useAppStore.getState().synthParams)',
    );
    // Neither the props interface nor the internal command-hook's parameter
    // object may still type or destructure a `synthParams` field — a stray
    // comment mentioning the word (the ChordLibraryFooter render-cost note)
    // is the only other legitimate hit, so this checks the specific
    // declaration shapes rather than a raw occurrence count.
    expect(source).not.toContain('synthParams: ActiveSynth');
    expect(source).not.toMatch(/^\s*synthParams,$/m);
    expect(source).not.toContain("import type { ActiveSynth }");
  });
});
