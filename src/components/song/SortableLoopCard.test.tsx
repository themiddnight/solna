import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createDefaultLoop } from '../../store/loopSlice';
import { getActiveChordIndex, SortableLoopCard } from './SortableLoopCard';

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

describe('SortableLoopCard', () => {
  const defaultLoop = createDefaultLoop();

  test('renders card container with id and cursor-pointer for full-card click selection', () => {
    const html = renderToString(
      <SortableLoopCard
        loop={defaultLoop}
        index={0}
        totalLoops={2}
        isPlaying={false}
        isActive={true}
        onSelect={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        onRename={() => {}}
        onSetRepeat={() => {}}
        onTogglePlayLoop={() => {}}
        onSetMix={() => {}}
      />
    );

    // Card outer element ID and clickability
    expect(html).toContain('id="card-loop-loop-default-1"');
    expect(html).toContain('cursor-pointer');
  });

  test('renders loop name, key/scale, and chord progression', () => {
    const html = renderToString(
      <SortableLoopCard
        loop={defaultLoop}
        index={0}
        totalLoops={2}
        isPlaying={false}
        isActive={true}
        onSelect={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        onRename={() => {}}
        onSetRepeat={() => {}}
        onTogglePlayLoop={() => {}}
        onSetMix={() => {}}
      />
    );

    // Name and index
    expect(html).toContain('Loop 1');
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
    const customLoop = { ...defaultLoop, repeatCount: 4 };
    const html = renderToString(
      <SortableLoopCard
        loop={customLoop}
        index={0}
        totalLoops={2}
        isPlaying={false}
        isActive={false}
        onSelect={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        onRename={() => {}}
        onSetRepeat={() => {}}
        onTogglePlayLoop={() => {}}
        onSetMix={() => {}}
      />
    );

    // Isolated Play button
    expect(html).toContain('id="btn-loop-play-loop-default-1"');
    expect(html).toContain('Play');

    // Repeat selector
    expect(html).toContain('id="select-repeat-loop-default-1"');
    expect(html).toContain('Repeat:');
    expect(html).toContain('<option value="4" selected=""');
  });

  test('renders progress bar, playing status, and active chord highlighting when isPlaying is true', () => {
    const loopWithChords = {
      ...defaultLoop,
      repeatCount: 2,
      chords: [
        { id: 'c1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
        { id: 'c2', root: 'F', quality: 'maj7', bars: 1, notes: ['F3', 'A3', 'C4', 'E4'] },
      ],
    };

    const html = renderToString(
      <SortableLoopCard
        loop={loopWithChords}
        index={0}
        totalLoops={2}
        isPlaying={true}
        isActive={true}
        progressPercent={50}
        currentStepInLoop={8}
        totalStepsInLoop={64}
        singleCycleSteps={32}
        currentRep={1}
        repeatCount={2}
        stepsPerBar={16}
        onSelect={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        onRename={() => {}}
        onSetRepeat={() => {}}
        onTogglePlayLoop={() => {}}
        onSetMix={() => {}}
      />
    );

    // Shows rep counter
    expect(html).toContain('Playing 9/64 (Rep 1/2)');
    expect(html).toContain('width:50%');

    // Chord highlighting badge-primary on active chord (Am7 at step 8)
    expect(html).toContain('badge-primary font-bold ring-2');
    expect(html).toContain('Am7');
  });

  test('renders solo audition state with Stop button when isAuditioning is true', () => {
    const html = renderToString(
      <SortableLoopCard
        loop={defaultLoop}
        index={0}
        totalLoops={2}
        isPlaying={true}
        isAuditioning={true}
        isActive={true}
        progressPercent={25}
        currentStepInLoop={4}
        totalStepsInLoop={16}
        singleCycleSteps={16}
        onSelect={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        onRename={() => {}}
        onSetRepeat={() => {}}
        onTogglePlayLoop={() => {}}
        onSetMix={() => {}}
      />
    );

    expect(html).toContain('id="btn-loop-play-loop-default-1"');
    expect(html).toContain('Stop');
    expect(html).toContain('Solo 5/16');
    expect(html).toContain('border-accent');
  });

  test('renders 4-channel mixer strips with correct volume and mute buttons', () => {
    const html = renderToString(
      <SortableLoopCard
        loop={defaultLoop}
        index={0}
        totalLoops={1}
        isPlaying={false}
        isActive={true}
        onSelect={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        onRename={() => {}}
        onSetRepeat={() => {}}
        onTogglePlayLoop={() => {}}
        onSetMix={() => {}}
      />
    );

    expect(html).toContain('id="btn-mute-synth-loop-default-1"');
    expect(html).toContain('id="slider-synth-loop-default-1"');
    expect(html).toContain('id="btn-mute-drum-loop-default-1"');
    expect(html).toContain('id="slider-drum-loop-default-1"');
    expect(html).toContain('id="btn-mute-chord-loop-default-1"');
    expect(html).toContain('id="slider-chord-loop-default-1"');
    expect(html).toContain('id="btn-mute-bass-loop-default-1"');
    expect(html).toContain('id="slider-bass-loop-default-1"');
  });

  test('does not leak raw color literals or dark classes', () => {
    const html = renderToString(
      <SortableLoopCard
        loop={defaultLoop}
        index={0}
        totalLoops={1}
        isPlaying={true}
        isActive={true}
        onSelect={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        onRename={() => {}}
        onSetRepeat={() => {}}
        onTogglePlayLoop={() => {}}
        onSetMix={() => {}}
      />
    );

    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('dark:');
    expect(html).not.toContain('rgba(');
  });
});

