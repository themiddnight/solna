import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import type React from 'react';
import { renderToString } from 'react-dom/server';
import { createDefaultLoop } from '@/store/loopSlice';
import { getActiveChordIndex, renameFromDraft, SortableLoopCard } from './SortableLoopCard';

describe('getActiveChordIndex', () => {
  test('returns -1 for empty or invalid inputs', () => {
    expect(getActiveChordIndex([], 0, 16)).toBe(-1);
    expect(getActiveChordIndex([{ bars: 1 }], 0, 0)).toBe(-1);
    expect(getActiveChordIndex([{ bars: 1 }], 0, -1)).toBe(-1);
  });

  test('calculates correct chord index for 1-bar chords in 4/4 meter (16 steps/bar)', () => {
    const chords = [
      { root: 'C', quality: 'maj7', bars: 1 },
      { root: 'A', quality: 'min7', bars: 1 },
      { root: 'D', quality: 'min7', bars: 1 },
      { root: 'G', quality: '7', bars: 1 },
    ];
    // Bar 0: steps 0..15 -> chord 0 (Cmaj7)
    expect(getActiveChordIndex(chords, 0, 16)).toBe(0);
    expect(getActiveChordIndex(chords, 15, 16)).toBe(0);

    // Bar 1: steps 16..31 -> chord 1 (Amin7)
    expect(getActiveChordIndex(chords, 16, 16)).toBe(1);
    expect(getActiveChordIndex(chords, 31, 16)).toBe(1);

    // Bar 2: steps 32..47 -> chord 2 (Dmin7)
    expect(getActiveChordIndex(chords, 32, 16)).toBe(2);
    expect(getActiveChordIndex(chords, 47, 16)).toBe(2);

    // Bar 3: steps 48..63 -> chord 3 (G7)
    expect(getActiveChordIndex(chords, 48, 16)).toBe(3);
    expect(getActiveChordIndex(chords, 63, 16)).toBe(3);
  });

  test('handles multi-bar chords with varying bar lengths', () => {
    const chords = [
      { root: 'E', quality: 'min', bars: 2 }, // Bars 0..1 (steps 0..31)
      { root: 'A', quality: 'maj', bars: 1 }, // Bar 2 (steps 32..47)
      { root: 'B', quality: '7', bars: 1 },   // Bar 3 (steps 48..63)
    ];
    expect(getActiveChordIndex(chords, 0, 16)).toBe(0);
    expect(getActiveChordIndex(chords, 20, 16)).toBe(0);
    expect(getActiveChordIndex(chords, 31, 16)).toBe(0);
    expect(getActiveChordIndex(chords, 32, 16)).toBe(1);
    expect(getActiveChordIndex(chords, 47, 16)).toBe(1);
    expect(getActiveChordIndex(chords, 48, 16)).toBe(2);
    expect(getActiveChordIndex(chords, 63, 16)).toBe(2);
  });

  test('wraps seamlessly across loop repetitions / cycles', () => {
    const chords = [
      { root: 'C', quality: 'maj', bars: 1 }, // Steps 0..15
      { root: 'G', quality: 'maj', bars: 1 }, // Steps 16..31
    ];
    // Total cycle is 32 steps. Step 32 is bar 0 of the 2nd repetition -> chord 0
    expect(getActiveChordIndex(chords, 32, 16)).toBe(0);
    expect(getActiveChordIndex(chords, 48, 16)).toBe(1);
    expect(getActiveChordIndex(chords, 64, 16)).toBe(0);
  });

  test('works with different meter steps per bar (e.g. 12 steps for 3/4 or 6/8)', () => {
    const chords = [
      { root: 'F', quality: 'maj', bars: 1 },
      { root: 'C', quality: 'maj', bars: 1 },
    ];
    expect(getActiveChordIndex(chords, 0, 12)).toBe(0);
    expect(getActiveChordIndex(chords, 11, 12)).toBe(0);
    expect(getActiveChordIndex(chords, 12, 12)).toBe(1);
    expect(getActiveChordIndex(chords, 23, 12)).toBe(1);
    expect(getActiveChordIndex(chords, 24, 12)).toBe(0);
  });
});

// Every callback below is a no-op: these suites assert markup, never interaction.
const noopCallbacks = {
  onSelect: () => {},
  onEdit: () => {},
  onDuplicate: () => {},
  onCopyInto: () => {},
  onDelete: () => {},
  onReorder: () => {},
  onRename: () => {},
  onSetRepeat: () => {},
  onTogglePlayLoop: () => {},
  onSetMix: () => {},
};

type CardProps = React.ComponentProps<typeof SortableLoopCard>;

/** The card's full prop set: a fresh default loop, and every callback stubbed. */
const cardProps = (overrides: Partial<CardProps> = {}): CardProps => ({
  loop: createDefaultLoop(),
  index: 0,
  totalLoops: 2,
  label: 'untitled-1',
  isPlaying: false,
  isActive: false,
  ...noopCallbacks,
  ...overrides,
});

/** Renders one card; `overrides` moves a single axis off that baseline. */
const renderCard = (overrides: Partial<CardProps> = {}) =>
  renderToString(<SortableLoopCard {...cardProps(overrides)} />);

/** The Copy-into suite's baseline: a named, active card. */
const renderVerseCard = (overrides: Partial<CardProps> = {}) =>
  renderCard({ label: 'Verse', isActive: true, ...overrides });

describe('SortableLoopCard content', () => {
  test('renders card container with id and cursor-pointer for full-card click selection', () => {
    const html = renderCard({ isActive: true });

    // Card outer element ID and clickability
    expect(html).toContain('id="card-loop-loop-default-1"');
    expect(html).toContain('cursor-pointer');
  });

  test('renders loop name, key/scale, and chord progression', () => {
    const html = renderCard({ loop: { ...createDefaultLoop(), name: 'Chorus' }, label: 'Chorus', isActive: true });

    // Name and index
    expect(html).toContain('Chorus');
    expect(html).toContain('#1');

    // Key / scale info
    expect(html).toContain('Key:');
    expect(html).toContain('Natural Minor');

    // Progression info
    expect(html).toContain('Progression:');

    // Rename button
    expect(html).toContain('btn-loop-rename-loop-default-1');

    // Select button
    expect(html).toContain('btn-loop-select-loop-default-1');

    // Reorder drag handle
    expect(html).toContain('Drag to reorder');
  });

  test('renders isolated Play button and repeat count selector', () => {
    const html = renderCard({ loop: { ...createDefaultLoop(), repeatCount: 4 } });

    // Isolated Play button
    expect(html).toContain('id="btn-loop-play-loop-default-1"');
    expect(html).toContain('Play');

    // Repeat selector
    expect(html).toContain('id="select-repeat-loop-default-1"');
    expect(html).toContain('Repeat:');
    expect(html).toContain('<option value="4" selected=""');
  });

  test('renders progress bar, playing status, and active chord highlighting when isPlaying is true', () => {
    const html = renderCard({
      loop: {
        ...createDefaultLoop(),
        repeatCount: 2,
        chords: [
          { id: 'c1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
          { id: 'c2', root: 'F', quality: 'maj7', bars: 1, notes: ['F3', 'A3', 'C4', 'E4'] },
        ],
      },
      isPlaying: true,
      isActive: true,
      progressPercent: 50,
      currentStepInLoop: 8,
      totalStepsInLoop: 64,
      singleCycleSteps: 32,
      currentRep: 1,
      repeatCount: 2,
      stepsPerBar: 16,
    });

    // Shows rep counter
    expect(html).toContain('Playing 9/64 (Rep 1/2)');
    expect(html).toContain('width:50%');

    // Chord highlighting badge-primary on active chord (Am7 at step 8)
    expect(html).toContain('badge-primary font-bold ring-2');
    expect(html).toContain('Am7');
  });

  test('renders the audition state with Stop button when isAuditioning is true', () => {
    const html = renderCard({
      isPlaying: true,
      isAuditioning: true,
      isActive: true,
      progressPercent: 25,
      currentStepInLoop: 4,
      totalStepsInLoop: 16,
      singleCycleSteps: 16,
    });

    expect(html).toContain('id="btn-loop-play-loop-default-1"');
    expect(html).toContain('Stop');
    expect(html).toContain('Audition 5/16');
    expect(html).toContain('border-accent');
  });

  test('renders 4-channel mixer strips with correct volume and mute buttons', () => {
    const html = renderCard({ totalLoops: 1, isActive: true });

    expect(html).toContain('id="btn-mute-synth-loop-default-1"');
    expect(html).toContain('id="slider-synth-loop-default-1"');
    expect(html).toContain('id="btn-mute-drum-loop-default-1"');
    expect(html).toContain('id="slider-drum-loop-default-1"');
    expect(html).toContain('id="btn-mute-chord-loop-default-1"');
    expect(html).toContain('id="slider-chord-loop-default-1"');
    expect(html).toContain('id="btn-mute-bass-loop-default-1"');
    expect(html).toContain('id="slider-bass-loop-default-1"');
  });

  test('a loop card renders a pad mix channel', () => {
    const html = renderCard();
    expect(html).toContain('id="btn-mute-pad-loop-default-1"');
    expect(html).toContain('id="slider-pad-loop-default-1"');
    expect(html).toContain('Pad');
  });

  test('renders the label prop, not the raw name, for an unnamed loop', () => {
    // The card is handed a resolved label; it must never fall back to
    // loop.name, which is '' on every loop nobody has renamed.
    const html = renderCard({
      loop: { ...createDefaultLoop(), name: '', tempName: 'Synthwave 80s' },
      label: 'Synthwave 80s',
    });
    expect(html).toContain('Synthwave 80s');
    // Every aria-label goes through the same string — a missed one is a screen
    // reader announcing "Delete " and nothing visible in review.
    expect(html).toContain('aria-label="Drag to reorder Synthwave 80s"');
    expect(html).toContain('aria-label="Rename Synthwave 80s"');
    expect(html).toContain('aria-label="Edit Synthwave 80s"');
    expect(html).toContain('aria-label="Move Synthwave 80s up"');
    expect(html).toContain('aria-label="Move Synthwave 80s down"');
    expect(html).toContain('aria-label="Duplicate Synthwave 80s"');
    expect(html).toContain('aria-label="Delete Synthwave 80s"');
    expect(html).toContain('aria-label="Repeat count for Synthwave 80s"');
    expect(html).toContain('aria-label="Play only Synthwave 80s"');
  });
});

describe('SortableLoopCard play scope and theming', () => {
  test('the play button is disabled when the scope forbids it', () => {
    const html = renderCard({ playDisabled: true });
    const button = html.match(/<button id="btn-loop-play-loop-default-1"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button).toContain('disabled:opacity-30');
    // `disabled:opacity-30` itself contains the substring "disabled", and the
    // card's other buttons (e.g. "Move up" at index 0) render their own
    // disabled="" independently of this prop — scope to this button and pin
    // the actual HTML boolean attribute, not a class-name substring.
    expect(button).toContain('disabled=""');
  });

  test('the play button is not disabled when the scope allows it', () => {
    const html = renderCard({ playDisabled: false });
    const button = html.match(/<button id="btn-loop-play-loop-default-1"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain('disabled=""');
  });

  test('the auditioning card shows Stop and the AUDITION badge, and is not disabled', () => {
    const html = renderCard({ isPlaying: true, isAuditioning: true });
    expect(html).toContain('badge badge-sm badge-accent');
    expect(html).toContain('Audition ');
    expect(html).toContain('btn btn-xs gap-1 font-bold shadow-xs transition-all btn-error');
  });

  test('a card that is not auditioning shows no AUDITION badge', () => {
    const html = renderCard({ isPlaying: true });
    expect(html).not.toContain('badge-accent');
  });

  test('does not leak raw color literals or dark classes', () => {
    const html = renderCard({ totalLoops: 1, isPlaying: true, isActive: true });

    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('dark:');
    expect(html).not.toContain('rgba(');
  });

  test('the rename input uses the label as placeholder, not the current name', () => {
    // The trap: prefilling with loop.name is safe (an untouched blur no-ops
    // because trimmed name equals current). Prefilling with the LABEL is the
    // trap — the app's current tempName snapshot gets silently promoted into
    // a permanent stored name on an untouched blur, breaking vibe tracking.
    // This test pins the placeholder against the label, not a hardcoded string.
    const src = readFileSync(new URL('./SortableLoopCard.tsx', import.meta.url), 'utf8');
    expect(src).toContain('placeholder={label}');
    expect(src).toContain('value={draftName}');
    expect(src).toContain('setDraftName(loop.name)');
    expect(src).not.toContain('placeholder="Loop name..."');
  });
});

describe('renameFromDraft', () => {
  // The old guard was `if (trimmed && trimmed !== loop.name)`, so "clear the
  // name to go back to the temporary label" was silently treated as a cancel.
  test('an emptied field is a real value, not a cancel', () => {
    expect(renameFromDraft('', 'Drop')).toBe('');
    expect(renameFromDraft('   ', 'Drop')).toBe('');
  });

  test('an unchanged field writes nothing', () => {
    expect(renameFromDraft('Drop', 'Drop')).toBe(null);
    expect(renameFromDraft('  Drop  ', 'Drop')).toBe(null);
    // The blank-to-blank case is the one an untouched, placeholder-only input
    // produces on blur: nothing changed, so nothing is written.
    expect(renameFromDraft('', '')).toBe(null);
  });

  test('a changed field writes the trimmed value', () => {
    expect(renameFromDraft('  Chorus ', 'Drop')).toBe('Chorus');
  });
});


describe('the Copy into… button', () => {
  const renderCard = (totalLoops: number) => renderVerseCard({ totalLoops });


  test('renders beside Duplicate, labelled through the resolved loop label', () => {
    const html = renderCard(3);
    expect(html).toContain('id="btn-loop-copy-into-loop-default-1"');
    expect(html).toContain('aria-label="Copy parts into Verse"');
    // Duplicate stays exactly where it is: the two gestures must read as
    // different at a glance — one makes a new loop, the other changes this one.
    expect(html).toContain('id="btn-loop-duplicate-loop-default-1"');
  });

  test('is disabled when the project holds one loop — there is no source', () => {
    expect(renderCard(1)).toMatch(/id="btn-loop-copy-into-loop-default-1"[^>]*disabled=""/);
  });

  test('is enabled once a second loop exists', () => {
    expect(renderCard(2)).not.toMatch(/id="btn-loop-copy-into-loop-default-1"[^>]*disabled=""/);
  });

  test('the card itself never mounts a dialog', () => {
    expect(renderCard(3)).not.toContain('btn-loop-copy-apply');
  });
});
