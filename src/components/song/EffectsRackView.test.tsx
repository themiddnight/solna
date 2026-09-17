import { describe, expect, test } from 'bun:test';
import { isValidElement } from 'react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Knob } from '../ui/Knob';
import { INITIAL_EFFECTS } from '@/store/initialState';
import type { MasterEffects } from '@/types';
import { createEffectsDraftMachine } from './useEffectsDraft';
import { EffectsRackView, FxChain, MasterDynamicsSection } from './EffectsRackView';

/**
 * Same "call the pure component, walk the element tree" tool
 * `synthPanels.test.tsx` uses for `VoicePanel`/`ArpeggiatorPanel`: `FxChain`
 * and `MasterDynamicsSection` are pure `props -> JSX` functions with no hooks
 * of their own, so a test can call one directly and reach the real `onCancel`
 * a knob's `pointercancel`/`lostpointercapture` handler would fire — proving
 * the wiring, not a mock of it. `Knob` itself holds a `useRef` and is the one
 * stop, same as there.
 */
function* elementsIn(node: unknown): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elementsIn(child);
    return;
  }
  if (!isValidElement(node)) return;
  yield node;
  if (typeof node.type === 'function' && node.type !== Knob) {
    const render = node.type as (props: unknown) => unknown;
    yield* elementsIn(render(node.props));
    return;
  }
  for (const value of Object.values(node.props as Record<string, unknown>)) {
    yield* elementsIn(value);
  }
}

function byId(tree: unknown, id: string): ReactElement {
  const found = [...elementsIn(tree)].filter((el) => (el.props as { id?: string }).id === id);
  // `EqBandKnob` is itself a stop-free wrapper that forwards `id` straight
  // onto the `Knob` it renders, so both nodes carry the same id and the SAME
  // onChange/onCancel references — the Knob node is the one to prefer when
  // both are present.
  const knobs = found.filter((el) => el.type === Knob);
  const chosen = knobs.length > 0 ? knobs : found;
  if (chosen.length !== 1) {
    throw new Error(`expected exactly one element with id "${id}", found ${chosen.length}`);
  }
  return chosen[0];
}

describe('EffectsRackView theming', () => {
  const html = renderToString(<EffectsRackView />);

  /** The rack's dimmed-unit class, shared by all six cards. */
  const DIMMED = 'border-base-300 opacity-60';

  /**
   * One rack unit's markup. Every card opens with `card bg-panel` and they are siblings, never
   * nested, so splitting on that marker cuts the html into per-card chunks; the chunk holding a
   * card's own control is that card's markup, class attribute included.
   */
  function cardMarkup(testId: string): string {
    const card = html.split('card bg-panel').find((chunk) => chunk.includes(testId));
    if (!card) throw new Error(`no rack card contains ${testId}`);
    return card;
  }

  test('rack units are daisyUI cards on semantic tokens', () => {
    expect(html).toContain('card bg-panel');
    expect(html).toContain('card-body');
    expect(html).toContain('text-primary');
    expect(html).toContain('text-accent');
    expect(html).toContain('text-secondary');
  });

  test('bypass switches are daisyUI buttons', () => {
    expect(html).toContain('btn btn-xs');
    expect(html).toContain('btn-active');
    expect(html).toContain('btn-bypass-reverb');
    expect(html).toContain('btn-bypass-delay');
    expect(html).toContain('btn-bypass-distortion');
    expect(html).toContain('btn-bypass-eq');
  });

  test('no dark: variants and no raw palette colours survive', () => {
    expect(html).not.toContain('dark:');
    for (const legacy of ['purple-', 'cyan-', 'indigo-', 'amber-', 'emerald-']) {
      expect(html).not.toContain(legacy);
    }
  });

  test('the master dynamics modules render, with a power toggle each', () => {
    expect(html).toContain('Master Dynamics');
    expect(html).toContain('Master Compressor');
    expect(html).toContain('Brickwall Limiter');
    expect(html).toContain('btn-enable-compressor');
    expect(html).toContain('btn-enable-limiter');
  });

  test('the compressor defaults OFF and renders dimmed; the limiter defaults ON and does not', () => {
    // The rack's own idiom for a disengaged unit — but all six cards share the class, so a
    // bare count says only HOW MANY are dimmed, never WHICH. Name the two dynamics cards by
    // their own markup, then pin the total so a dimmed reverb could not stand in for one.
    // DEV-383: the limiter now defaults ON, so only the compressor card is dimmed.
    expect(cardMarkup('btn-enable-compressor')).toContain(DIMMED);
    expect(cardMarkup('btn-enable-limiter')).not.toContain(DIMMED);
    expect(html.split(DIMMED).length - 1).toBe(1);
  });

  test('every dynamics parameter has a knob', () => {
    for (const id of [
      'slider-comp-threshold',
      'slider-comp-ratio',
      'slider-comp-attack',
      'slider-comp-release',
      'slider-limiter-threshold',
      'slider-limiter-ratio',
      'slider-limiter-attack',
      'slider-limiter-release',
    ]) {
      expect(html).toContain(id);
    }
  });

  test('each stage carries a gain-reduction readout', () => {
    expect(html.split('Gain Reduction').length - 1).toBe(2);
    expect(html).toContain('0.0 dB');
  });
});

/**
 * Finding 1 (final review): EffectsRackView wired `onKnobChange`/`onKnobCommit`
 * to every Knob but never `onCancel`, so an aborted drag (`pointercancel`,
 * `lostpointercapture` — see `finishKnobGesture` in Knob.tsx) left
 * `createEffectsDraftMachine`'s `dragging` flag stuck true forever: `sync()`
 * then refuses every future committed value (a vibe swap or preset apply goes
 * invisible here) and the next real `onCommit` writes the stale draft back
 * over whatever changed in between.
 *
 * These tests build the REAL draft machine (`createEffectsDraftMachine`, the
 * same function `useEffectsDraft` wraps) and route `FxChain`/
 * `MasterDynamicsSection`'s props straight to it — no mock of `onCancel`, so a
 * wiring regression (the prop never reaching the Knob) fails here exactly the
 * way it failed in production. The proof that `dragging` actually reset is
 * behavioral: after the captured `onCancel` runs, `sync()` with a NEW
 * committed value must overwrite the draft — that only happens once
 * `dragging` is back to false (mirrors `useEffectsDraft.test.tsx`'s "a
 * committed-prop change replaces the draft when no gesture is active").
 */
describe('EffectsRackView wires onCancel to every knob (Finding 1)', () => {
  function effectsWith(overrides: Partial<MasterEffects>): MasterEffects {
    return { ...INITIAL_EFFECTS, ...overrides };
  }

  test('an aborted FX Chain knob drag (reverb wet) discards the draft and un-sticks sync()', () => {
    const committed = effectsWith({ reverbWet: 0.2 });
    const machine = createEffectsDraftMachine(committed);
    const tree = FxChain({
      effects: machine.getDraft(),
      updateFx: () => {},
      onKnobChange: machine.onPatch,
      onKnobCommit: () => machine.commit(() => {}),
      onKnobCancel: machine.cancel,
    });

    const knob = byId(tree, 'slider-reverb-wet');
    const { onChange, onCancel } = knob.props as {
      onChange: (v: number) => void;
      onCancel: () => void;
    };

    onChange(0.9);
    expect(machine.getDraft().reverbWet).toBe(0.9);

    onCancel();
    expect(machine.getDraft().reverbWet).toBe(0.2);

    // The behavioral proof: dragging is back to false, so a later commit
    // (a vibe swap, a preset apply) is no longer refused by sync().
    const laterCommitted = effectsWith({ reverbWet: 0.6 });
    machine.sync(laterCommitted);
    expect(machine.getDraft().reverbWet).toBe(0.6);
  });

  test('an aborted 3-Band EQ knob drag (EqBandKnob) discards the draft and un-sticks sync()', () => {
    const committed = effectsWith({ eqLow: 0 });
    const machine = createEffectsDraftMachine(committed);
    const tree = FxChain({
      effects: machine.getDraft(),
      updateFx: () => {},
      onKnobChange: machine.onPatch,
      onKnobCommit: () => machine.commit(() => {}),
      onKnobCancel: machine.cancel,
    });

    const knob = byId(tree, 'slider-eq-low');
    const { onChange, onCancel } = knob.props as {
      onChange: (v: number) => void;
      onCancel: () => void;
    };

    onChange(9);
    expect(machine.getDraft().eqLow).toBe(9);

    onCancel();
    expect(machine.getDraft().eqLow).toBe(0);

    const laterCommitted = effectsWith({ eqLow: -4 });
    machine.sync(laterCommitted);
    expect(machine.getDraft().eqLow).toBe(-4);
  });

  test('an aborted Master Dynamics knob drag (compressor threshold) discards the draft and un-sticks sync()', () => {
    const committed = effectsWith({ compressorThreshold: -18 });
    const machine = createEffectsDraftMachine(committed);
    const tree = MasterDynamicsSection({
      effects: machine.getDraft(),
      updateFx: () => {},
      onKnobChange: machine.onPatch,
      onKnobCommit: () => machine.commit(() => {}),
      onKnobCancel: machine.cancel,
    });

    const knob = byId(tree, 'slider-comp-threshold');
    const { onChange, onCancel } = knob.props as {
      onChange: (v: number) => void;
      onCancel: () => void;
    };

    onChange(-6);
    expect(machine.getDraft().compressorThreshold).toBe(-6);

    onCancel();
    expect(machine.getDraft().compressorThreshold).toBe(-18);

    const laterCommitted = effectsWith({ compressorThreshold: -30 });
    machine.sync(laterCommitted);
    expect(machine.getDraft().compressorThreshold).toBe(-30);
  });
});
