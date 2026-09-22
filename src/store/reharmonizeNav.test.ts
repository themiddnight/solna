import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { startReharmonizeNavClear } from './reharmonizeNav';

let stop: (() => void) | null = null;
let baseline: { activeLoopId: string; projectInstallCount: number; reharmonizedIndicator: boolean };

beforeEach(() => {
  const s = useAppStore.getState();
  baseline = {
    activeLoopId: s.activeLoopId,
    projectInstallCount: s.projectInstallCount,
    reharmonizedIndicator: s.reharmonizedIndicator,
  };
  stop = startReharmonizeNavClear();
});
afterEach(() => {
  stop?.();
  useAppStore.setState(baseline);
});

describe('reharmonizeNav', () => {
  test('an activeLoopId change clears the badge', () => {
    useAppStore.setState({ reharmonizedIndicator: true });
    useAppStore.setState({ activeLoopId: 'loop-elsewhere' });
    expect(useAppStore.getState().reharmonizedIndicator).toBe(false);
  });

  test('a project install clears the badge even when the loop id collides', () => {
    useAppStore.setState({ reharmonizedIndicator: true });
    useAppStore.setState({ projectInstallCount: useAppStore.getState().projectInstallCount + 1 });
    expect(useAppStore.getState().reharmonizedIndicator).toBe(false);
  });

  test('no write when the badge is already off', () => {
    useAppStore.setState({ reharmonizedIndicator: false });
    let writes = 0;
    const unsub = useAppStore.subscribe(() => { writes += 1; });
    useAppStore.setState({ activeLoopId: 'loop-elsewhere' });
    unsub();
    expect(writes).toBe(1); // the navigation itself, nothing more
  });
});
