import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { INITIAL_EFFECTS } from '@/store/initialState';
import type { MasterEffects } from '@/types';
import { createEffectsDraftMachine, useEffectsDraft } from './useEffectsDraft';

function effectsWithReverbWet(reverbWet: number): MasterEffects {
  return { ...INITIAL_EFFECTS, reverbWet };
}

describe('createEffectsDraftMachine', () => {
  test('onPatch merges into the draft but does not call setEffects until commit()', () => {
    const committed = effectsWithReverbWet(0.2);
    const commits: MasterEffects[] = [];
    const machine = createEffectsDraftMachine(committed);

    machine.onPatch({ reverbWet: 0.8 });

    expect(machine.getDraft().reverbWet).toBe(0.8);
    // Untouched fields pass through from committed, unmerged.
    expect(machine.getDraft().delayWet).toBe(committed.delayWet);
    expect(commits.length).toBe(0);

    machine.commit((effects) => commits.push(effects));

    expect(commits.length).toBe(1);
    expect(commits[0]!.reverbWet).toBe(0.8);
  });

  test('commit writes setEffects exactly once with the last drafted value', () => {
    const committed = effectsWithReverbWet(0.2);
    const commits: MasterEffects[] = [];
    const machine = createEffectsDraftMachine(committed);

    machine.onPatch({ reverbWet: 0.5 });
    machine.onPatch({ reverbWet: 0.8 });
    machine.commit((effects) => commits.push(effects));

    expect(commits.length).toBe(1);
    expect(commits[0]!.reverbWet).toBe(0.8);
  });

  test('cancel discards the draft, restores committed, and never commits', () => {
    const committed = effectsWithReverbWet(0.2);
    let commitCount = 0;
    const machine = createEffectsDraftMachine(committed);

    machine.onPatch({ reverbWet: 0.8 });
    machine.cancel();

    expect(machine.getDraft().reverbWet).toBe(0.2);

    machine.commit(() => { commitCount += 1; });
    // commit() after cancel() commits the (now-restored) draft — the
    // cancelled gesture itself never reached the commit callback.
    expect(commitCount).toBe(1);
  });

  test('a committed-prop change replaces the draft when no gesture is active', () => {
    const first = effectsWithReverbWet(0.2);
    const second = effectsWithReverbWet(0.6);
    const machine = createEffectsDraftMachine(first);

    machine.sync(second);

    expect(machine.getDraft().reverbWet).toBe(0.6);
  });

  test('a committed-prop change during an open gesture does NOT clobber the live draft', () => {
    const first = effectsWithReverbWet(0.2);
    const second = effectsWithReverbWet(0.6);
    const machine = createEffectsDraftMachine(first);

    machine.onPatch({ reverbWet: 0.8 });
    machine.sync(second);

    expect(machine.getDraft().reverbWet).toBe(0.8);
  });
});

/**
 * Thin React-level smoke test, same reasoning as `useBeatParamDraft.test.tsx`
 * and `useSynthPatchDraft.test.tsx`: one `renderToString` pass is all this
 * repo's DOM-less suite can give a hook, so anything needing a second render
 * is covered by the machine tests above, against the exact functions the
 * hook calls.
 */
describe('useEffectsDraft (React wiring)', () => {
  test('returns the committed effects as the initial draft with no gesture open', () => {
    const committed = effectsWithReverbWet(0.2);
    let captured: ReturnType<typeof useEffectsDraft> | null = null;
    function Probe() {
      captured = useEffectsDraft(committed, () => {});
      return null;
    }
    renderToString(<Probe />);
    expect(captured!.effects).toEqual(committed);
  });
});
