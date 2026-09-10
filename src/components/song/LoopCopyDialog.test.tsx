import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createDefaultLoop } from '@/store/loopSlice';
import { LOOP_COPY_GROUPS } from '@/store/loopCopy';
import type { Loop } from '@/store/types';
import {
  LoopCopyDialog,
  loopBarsNotice,
  loopCopySourceOption,
  loopCopySummary,
  loopKeyNotice,
  quickChipSelection,
  withImpliedKey,
} from './LoopCopyDialog';

const inAMinor = (): Loop => ({ ...createDefaultLoop(), id: 'loop-target', name: 'Verse' });
const inCMajor = (): Loop => ({
  ...createDefaultLoop(),
  id: 'loop-source',
  name: 'Chorus',
  scaleRoot: 'C',
  scaleType: 'Major',
});

describe('quickChipSelection', () => {
  test('All sounds ticks the six Sound cells and nothing else', () => {
    expect(new Set(quickChipSelection('sounds'))).toEqual(
      new Set(['lead-sound', 'fx-sound', 'chord-sound', 'bass-sound', 'pad-sound', 'drums-sound']),
    );
  });

  test('All patterns ticks the six Pattern cells and nothing else', () => {
    expect(new Set(quickChipSelection('patterns'))).toEqual(
      new Set([
        'lead-pattern',
        'fx-pattern',
        'chord-pattern',
        'bass-pattern',
        'pad-pattern',
        'drums-pattern',
      ]),
    );
  });

  test('Everything ticks all fourteen groups', () => {
    expect(new Set(quickChipSelection('everything'))).toEqual(
      new Set(LOOP_COPY_GROUPS.map((group) => group.id)),
    );
  });

  test('the two loop-wide groups are in neither column chip', () => {
    expect(quickChipSelection('sounds')).not.toContain('key');
    expect(quickChipSelection('sounds')).not.toContain('mix');
    expect(quickChipSelection('patterns')).not.toContain('key');
    expect(quickChipSelection('patterns')).not.toContain('mix');
  });
});

describe('withImpliedKey', () => {
  test('adds key when the chord pattern crosses a key boundary', () => {
    expect(withImpliedKey(inCMajor(), inAMinor(), ['chord-pattern'])).toEqual([
      'chord-pattern',
      'key',
    ]);
  });

  test('adds nothing when the two loops are already in the same key', () => {
    const source = { ...inCMajor(), id: 'loop-source' };
    const target = { ...inCMajor(), id: 'loop-target' };
    expect(withImpliedKey(source, target, ['chord-pattern'])).toEqual(['chord-pattern']);
  });

  test('never adds key twice', () => {
    expect(withImpliedKey(inCMajor(), inAMinor(), ['chord-pattern', 'key'])).toEqual([
      'chord-pattern',
      'key',
    ]);
  });

  test('a quick chip runs through the same rule', () => {
    const next = withImpliedKey(inCMajor(), inAMinor(), quickChipSelection('patterns'));
    expect(next).toContain('key');
  });

  test('re-run against a NEW source that differs in key still implies key', () => {
    // I1 regression guard: changing the From select must re-derive the rule
    // against the new source, not just the source active when chord-pattern
    // was first ticked. This proves withImpliedKey itself is correct/idempotent
    // for that re-derivation — the wiring fix is pinned below.
    const firstSource = {
      ...inCMajor(),
      id: 'loop-source-same',
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
    };
    const target = inAMinor();
    const afterTick = withImpliedKey(firstSource, target, ['chord-pattern']);
    expect(afterTick).not.toContain('key');

    const differentSource = inCMajor();
    const afterSourceChange = withImpliedKey(differentSource, target, afterTick);
    expect(afterSourceChange).toContain('key');
  });
});

describe('LoopCopyDialog wiring (source-text pin)', () => {
  test('the From select re-applies withImpliedKey on source change (I1)', () => {
    // withImpliedKey being correct in isolation (above) does not guard I1 —
    // the bug was the component never calling it when the source changed.
    // Pin the wiring itself, following this repo's convention of pinning an
    // event-handler's source text (see SortableLoopCard.test.tsx).
    const src = readFileSync(new URL('./LoopCopyDialog.tsx', import.meta.url), 'utf8');
    const onChangeMatch = src.match(
      /id="select-loop-copy-source"[\s\S]*?onChange=\{([\s\S]*?)\}\n\s*className/,
    );
    expect(onChangeMatch).not.toBeNull();
    const onChangeBody = onChangeMatch?.[1] ?? '';
    expect(onChangeBody).toContain('setSourceId(id)');
    expect(onChangeBody).toContain('withImpliedKey(nextSource, target, prev)');
  });

  // The two tests above (and their equivalent for the toggle handler) only
  // proved the two substrings are somewhere in the handler body — an
  // inverted guard (`keyTouchedRef.current` instead of
  // `!keyTouchedRef.current`, or the predicate extracted into a helper that
  // gets its polarity flipped) leaves both substrings byte-for-byte intact
  // while silently breaking I1 (source change stops re-deriving 'key') or I2
  // (an unticked 'key' gets re-added on the next source/chord-pattern
  // change). Pin the guard's own polarity, not just its ingredients.
  test('the From-select guard requires a source AND an UNTOUCHED key checkbox, in that polarity', () => {
    const src = readFileSync(new URL('./LoopCopyDialog.tsx', import.meta.url), 'utf8');
    const onChangeMatch = src.match(
      /id="select-loop-copy-source"[\s\S]*?onChange=\{([\s\S]*?)\}\n\s*className/,
    );
    const onChangeBody = onChangeMatch?.[1] ?? '';
    expect(onChangeBody).toMatch(
      /if \(nextSource && !keyTouchedRef\.current\) \{\s*setSelected\(\(prev\) => withImpliedKey\(nextSource, target, prev\)\);/,
    );
  });

  test('the chord-pattern toggle guard requires an UNTOUCHED key checkbox, in that polarity (I1/I2)', () => {
    const src = readFileSync(new URL('./LoopCopyDialog.tsx', import.meta.url), 'utf8');
    const toggleMatch = src.match(/const toggle = \(id: LoopCopyGroupId\) => \{([\s\S]*?\n {2}\};)/);
    expect(toggleMatch).not.toBeNull();
    const toggleBody = toggleMatch?.[1] ?? '';
    expect(toggleBody).toMatch(
      /id === 'chord-pattern' && !keyTouchedRef\.current\s*\?\s*withImpliedKey\(source, target, next\)\s*:\s*next/,
    );
  });
});

describe('the two notices are conditional', () => {
  test('the key notice names both keys when they differ', () => {
    expect(loopKeyNotice(inCMajor(), inAMinor(), ['chord-pattern', 'key'])).toBe(
      'Key / Scale added: the source is in C Major, this loop is in A Natural Minor.',
    );
  });

  test('the key notice is silent when the keys match', () => {
    const source = { ...inCMajor(), id: 'loop-source' };
    const target = { ...inCMajor(), id: 'loop-target' };
    expect(loopKeyNotice(source, target, ['chord-pattern', 'key'])).toBeNull();
  });

  test('the key notice is silent when the user has unticked key, even though the keys differ', () => {
    // I2 regression guard: key is a default, not a lock (per the spec). If the
    // user unticks it after the auto-tick, the notice must not keep claiming
    // "added" — Apply will not add it.
    expect(loopKeyNotice(inCMajor(), inAMinor(), ['chord-pattern'])).toBeNull();
  });

  test('the bar notice states the concrete consequence', () => {
    const source = inCMajor();
    source.chords = [...source.chords, ...source.chords];
    expect(loopBarsNotice(source, inAMinor(), ['chord-pattern'])).toBe(
      'This loop becomes 8 bars, was 4.',
    );
  });

  test('the bar notice is silent when the lengths match', () => {
    expect(loopBarsNotice(inCMajor(), inAMinor(), ['chord-pattern'])).toBeNull();
  });

  test('the bar notice is silent when the chord pattern is not ticked', () => {
    const source = inCMajor();
    source.chords = [...source.chords, ...source.chords];
    expect(loopBarsNotice(source, inAMinor(), ['lead-sound', 'mix'])).toBeNull();
  });
});

describe('the source option and the details summary', () => {
  test('an option states the label, the key and the bar count', () => {
    expect(loopCopySourceOption(inCMajor(), 'Chorus')).toBe('Chorus — C Major · 4 bars');
  });

  test('the summary always states what is currently ticked', () => {
    expect(loopCopySummary(['lead-sound', 'chord-pattern', 'key'])).toBe(
      'Lead sound, Chords pattern, Key / Scale',
    );
  });

  test('the summary says so when nothing is ticked', () => {
    expect(loopCopySummary([])).toBe('nothing selected');
  });
});

const noop = () => {};

function renderDialog() {
  const target = inAMinor();
  const source = inCMajor();
  return renderToString(
    <LoopCopyDialog
      targetId="loop-target"
      loops={[target, source]}
      labels={{ 'loop-target': 'Verse', 'loop-source': 'Chorus' }}
      onApply={noop}
      onClose={noop}
    />,
  );
}

describe('LoopCopyDialog markup', () => {
  test('Apply is disabled while nothing is ticked', () => {
    expect(renderDialog()).toMatch(/id="btn-loop-copy-apply"[^>]*disabled=""/);
  });

  test('the title names the target through the resolved label', () => {
    expect(renderDialog()).toContain('Copy into &quot;Verse&quot;');
  });

  test('the From list excludes the target loop', () => {
    const html = renderDialog();
    // The first source is pre-selected, so React's SSR puts `selected=""`
    // on it — asserted as one literal so the value and the text are proven
    // to sit on the same element.
    expect(html).toContain(
      '<option value="loop-source" selected="">Chorus — C Major · 4 bars</option>',
    );
    expect(html).not.toContain('value="loop-target"');
  });

  test('all fourteen group checkboxes are rendered, unchecked', () => {
    const html = renderDialog();
    for (const group of LOOP_COPY_GROUPS) {
      expect(html).toContain(`id="chk-loop-copy-${group.id}"`);
    }
    expect(html).not.toContain('checked=""');
  });

  test('the three quick chips are rendered', () => {
    const html = renderDialog();
    expect(html).toContain('id="btn-loop-copy-chip-sounds"');
    expect(html).toContain('id="btn-loop-copy-chip-patterns"');
    expect(html).toContain('id="btn-loop-copy-chip-everything"');
  });

  test('the summary line reports the empty selection, and neither notice renders', () => {
    const html = renderDialog();
    expect(html).toContain('Details — nothing selected');
    // Nothing is ticked at first render, so neither notice applies. Their
    // conditionality is asserted on loopKeyNotice/loopBarsNotice above:
    // there is no DOM here, so a tick cannot be simulated.
    expect(html).not.toContain('Key / Scale added');
    expect(html).not.toContain('This loop becomes');
  });

  test('names roles, never colours', () => {
    const html = renderDialog();
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('rgba(');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('dark:');
  });

  test('renders nothing when the project holds only the target loop', () => {
    const html = renderToString(
      <LoopCopyDialog
        targetId="loop-target"
        loops={[inAMinor()]}
        labels={{ 'loop-target': 'Verse' }}
        onApply={noop}
        onClose={noop}
      />,
    );
    expect(html).toBe('');
  });
});
