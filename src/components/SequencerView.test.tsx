import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SequencerView } from './SequencerView';
import { useAppStore } from '../store/store';

describe('SequencerView theming', () => {
  const html = renderToString(<SequencerView />);

  test('panels are daisyUI cards on base tokens', () => {
    expect(html).toContain('card bg-panel border border-base-300');
    expect(html).not.toContain('#12152A');
    expect(html).not.toContain('#252B48');
    expect(html).not.toContain('#0B0D19');
  });

  test('toolbar controls use daisyUI btn and select classes', () => {
    expect(html).toContain('btn btn-xs btn-ghost');
    expect(html).toContain('select select-xs select-ghost');
  });

  test('the drum filter type switch is a daisyUI join', () => {
    expect(html).toContain('join');
    expect(html).toContain('btn btn-xs join-item');
  });

  test('step numbers keep tabular-nums and the downbeat uses accent', () => {
    expect(html).toContain('tabular-nums');
    expect(html).toContain('text-accent');
  });

  test('track dots render semantic token backgrounds', () => {
    expect(html).toContain('bg-error');
    expect(html).toContain('bg-warning');
    expect(html).toContain('bg-success');
    expect(html).toContain('bg-accent');
    expect(html).toContain('bg-secondary');
  });

  test('the active-step shadow that used to read shadow-indigo-500/20 is now shadow-primary/20', () => {
    expect(html).toContain('shadow-primary/20');
  });

  test('no legacy palette utilities survive', () => {
    for (const cls of [
      'amber-',
      'cyan-',
      'emerald-',
      'indigo-',
      'pink-',
      'purple-',
      'rose-',
      // Bare 'slate' false-positives on 'translate' (as in -translate-y-1/2),
      // so we check for the palette-color form 'slate-' specifically.
      'slate-',
      'text-white',
      'bg-white/20',
    ]) {
      expect(html).not.toContain(cls);
    }
  });
});

describe('SequencerView genre options carry their meter', () => {
  test('in 4/4 every genre is labelled with its own meter', () => {
    useAppStore.setState({ meterId: '4/4' });
    const html = renderToString(<SequencerView />);
    expect(html).toContain('Synthwave · 4/4');
    expect(html).toContain('Boom Bap · 4/4');
    // The value is still the bare genre key, so applyGenrePreset is unaffected.
    expect(html).toContain('value="Synthwave"');
  });

  // There is no companion test here rendering a non-default active meter
  // (e.g. '3/4') through `<SequencerView />` and asserting the "what it
  // becomes" wording. A real `<SequencerView />` cannot be rendered in a
  // non-default active meter through this harness: zustand v5's `useStore`
  // wires `getServerSnapshot` to `selector(api.getInitialState())`
  // (node_modules/zustand/react.js), and `getInitialState()` always returns
  // the object captured once at store creation — `useAppStore.setState(...)`
  // never touches it, and `react-dom/server`'s `useSyncExternalStore` shim
  // calls only `getServerSnapshot()`. This is already confirmed and documented
  // in this repo at `TransportBar.test.tsx:51-66` and `InstantVibesBar.test.tsx`
  // ("renderToString reads that initial snapshot"). Verified empirically here
  // too: `useAppStore.setState({ meterId: '3/4' })` followed by
  // `renderToString(<SequencerView />)` still renders the 4/4 default.
  //
  // A test that calls `patternOptionLabel`/`patternMeterTitle` directly with a
  // '3/4' argument instead of going through the component would not exercise
  // `SequencerView.tsx` at all — it cannot fail for a wiring bug in the
  // component (e.g. a swapped `preset.meter`/`meter.id` argument order, or a
  // dropped `title` prop), and `meterSelect.test.ts` already pins that
  // composition at the helper level. So no such substitute test is added
  // here; a future task that needs the mismatch case rendered end-to-end will
  // need either a production-code change to how `SequencerView` reads
  // `meterId` (e.g. a prop/context seam a test can drive) or new
  // module-mocking test infrastructure this repo does not otherwise use.
});
