import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { audioEngine } from '@/audio/engine';
import { defaultTrackSynth } from '@/store/initialState';
import type { ActiveSynth } from '@/types/synth';
import type { SubtractivePatch } from './proControls';
import { createSynthPatchDraftMachine, useSynthPatchDraft } from './useSynthPatchDraft';

/**
 * Unlike `beatPreview.ts`, `synthPatchPreview.ts` is NOT frame-coalesced —
 * see its own docblock — so every `onPatch` reaches `audioEngine.updateSynthPatch`
 * synchronously and there is no frame to wait out here, unlike
 * `useBeatParamDraft.test.tsx`'s `nextFrame()`.
 */
function patchWithCutoff(cutoffHz: number): SubtractivePatch {
  const synth = defaultTrackSynth('synth');
  return {
    ...synth.patch,
    synth: { ...synth.patch.synth, filter: { ...synth.patch.synth.filter, cutoffHz } },
  };
}

function synthWithCutoff(cutoffHz: number): ActiveSynth {
  const synth = defaultTrackSynth('synth');
  return { ...synth, patch: patchWithCutoff(cutoffHz) };
}

describe('createSynthPatchDraftMachine', () => {
  afterEach(() => {
    // No frame coalescer to drain here, unlike Beat's suite — the direct
    // engine push means nothing is left armed between tests.
  });

  test('onPatch previews to the engine but does not commit until commit() is called', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    try {
      const committed = synthWithCutoff(500);
      const commits: ActiveSynth[] = [];
      const machine = createSynthPatchDraftMachine(committed, 'synth');

      machine.onPatch(patchWithCutoff(1200));

      expect(updateSynthPatch).toHaveBeenCalledTimes(1);
      const [previous, next, source] = updateSynthPatch.mock.calls[0]!;
      expect((previous as ActiveSynth).patch.synth.filter.cutoffHz).toBe(500);
      expect((next as ActiveSynth).patch.synth.filter.cutoffHz).toBe(1200);
      expect(source).toBe('synth');
      expect(commits.length).toBe(0);
      expect(machine.getDraft().synth.filter.cutoffHz).toBe(1200);

      machine.commit((synth) => commits.push(synth));

      expect(commits.length).toBe(1);
      expect(commits[0]!.patch.synth.filter.cutoffHz).toBe(1200);
    } finally {
      updateSynthPatch.mockRestore();
    }
  });

  test('a second onPatch previews against the LAST PUSHED patch, not the whole-gesture start', () => {
    // This is the exact bug `lastPushed` exists to prevent: if `previous`
    // stayed pinned to the value from before the drag, dragging back through
    // the starting value would compare against that stale start, and a
    // sounding voice's `before.cutoffHz !== after.cutoffHz` guard
    // (subtractiveVoice.ts's `updateFilter`) would wrongly see "unchanged"
    // and skip the AudioParam write on the very step that should have
    // pulled it back.
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    try {
      const committed = synthWithCutoff(500);
      const machine = createSynthPatchDraftMachine(committed, 'synth');

      machine.onPatch(patchWithCutoff(1200));
      machine.onPatch(patchWithCutoff(500)); // dragged back to the starting value

      expect(updateSynthPatch).toHaveBeenCalledTimes(2);
      const secondCall = updateSynthPatch.mock.calls[1]!;
      const [previous, next] = secondCall;
      // previous is the FIRST push's result (1200), not the original 500 —
      // so the diff correctly reads as "changed" on this step too.
      expect((previous as ActiveSynth).patch.synth.filter.cutoffHz).toBe(1200);
      expect((next as ActiveSynth).patch.synth.filter.cutoffHz).toBe(500);
    } finally {
      updateSynthPatch.mockRestore();
    }
  });

  test('cancel discards the draft, restores the engine to committed, and never commits', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    try {
      const committed = synthWithCutoff(500);
      let commitCount = 0;
      const machine = createSynthPatchDraftMachine(committed, 'synth');

      machine.onPatch(patchWithCutoff(1200));
      machine.cancel();

      expect(updateSynthPatch).toHaveBeenCalledTimes(2);
      const restoreCall = updateSynthPatch.mock.calls[1]!;
      expect((restoreCall[0] as ActiveSynth).patch.synth.filter.cutoffHz).toBe(1200);
      expect((restoreCall[1] as ActiveSynth).patch.synth.filter.cutoffHz).toBe(500);
      expect(machine.getDraft().synth.filter.cutoffHz).toBe(500);

      machine.commit(() => { commitCount += 1; });
      // commit() after cancel() commits the (now-restored) draft — the
      // cancelled gesture itself never reached the commit callback.
      expect(commitCount).toBe(1);
    } finally {
      updateSynthPatch.mockRestore();
    }
  });

  test('a committed-prop change replaces the draft when no gesture is active', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    try {
      const first = synthWithCutoff(500);
      const second = synthWithCutoff(900);
      const machine = createSynthPatchDraftMachine(first, 'synth');

      machine.sync(second);

      expect(machine.getDraft().synth.filter.cutoffHz).toBe(900);
      expect(updateSynthPatch).not.toHaveBeenCalled();
    } finally {
      updateSynthPatch.mockRestore();
    }
  });

  test('a committed-prop change during an open gesture does NOT clobber the live draft', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    try {
      const first = synthWithCutoff(500);
      const second = synthWithCutoff(900);
      const machine = createSynthPatchDraftMachine(first, 'synth');

      machine.onPatch(patchWithCutoff(1200));
      machine.sync(second);

      expect(machine.getDraft().synth.filter.cutoffHz).toBe(1200);
    } finally {
      updateSynthPatch.mockRestore();
    }
  });

  test('previews the bus the machine was built for, not a hardcoded one', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    try {
      const committed = synthWithCutoff(500);
      const machine = createSynthPatchDraftMachine(committed, 'chord');

      machine.onPatch(patchWithCutoff(1200));

      expect(updateSynthPatch.mock.calls[0]![2]).toBe('chord');
    } finally {
      updateSynthPatch.mockRestore();
    }
  });
});

/**
 * Thin React-level smoke test, same reasoning as `useBeatParamDraft.test.tsx`:
 * one `renderToString` pass is all this repo's DOM-less suite can give a
 * hook, so anything needing a second render is covered by the machine tests
 * above, against the exact functions the hook calls.
 */
describe('useSynthPatchDraft (React wiring)', () => {
  test('returns the committed patch as the initial draft with no gesture open', () => {
    const committed = synthWithCutoff(500);
    const channel = {
      activeSynth: committed,
      arpSettings: { active: false, mode: 'up' as const, rate: '16n' as const, octaves: 1 },
      setActiveSynth: () => {},
      setArpSettings: () => {},
    };
    let captured: ReturnType<typeof useSynthPatchDraft> | null = null;
    function Probe() {
      captured = useSynthPatchDraft(channel, 'synth');
      return null;
    }
    renderToString(<Probe />);
    expect(captured!.patch).toEqual(committed.patch);
  });
});
