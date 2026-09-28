import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
  HARD_STOP_ARM_MS,
  isPressArmed,
  PlayerTransport,
  resolveTransportButtons,
  transportLabelClass,
} from './PlayerTransport';

describe('resolveTransportButtons', () => {
  test('stopped offers play and disables hard stop', () => {
    const b = resolveTransportButtons('stopped');
    expect(b.main.icon).toBe('play');
    expect(b.main.label).toBe('Play');
    expect(b.main.disabled).toBe(false);
    expect(b.main.action).toBe('play');
    expect(b.hard.disabled).toBe(true);
  });

  test('playing offers stop and enables hard stop', () => {
    const b = resolveTransportButtons('playing');
    expect(b.main.icon).toBe('stop');
    expect(b.main.label).toBe('Stop');
    expect(b.main.disabled).toBe(false);
    expect(b.main.action).toBe('softStop');
    expect(b.hard.disabled).toBe(false);
  });

  // UX F-06: a second tap on the main button while the tail rings out stops
  // NOW, rather than being swallowed by a disabled button.
  test('stopping is a pulsing stop button whose tap hard-stops, and hard stop stays live', () => {
    const b = resolveTransportButtons('stopping');
    expect(b.main.label).toBe('Stopping…');
    expect(b.main.title).toBe('Stopping… — press again to stop immediately');
    expect(b.main.disabled).toBe(false);
    expect(b.main.action).toBe('hardStop');
    expect(b.main.className).toContain('animate-pulse');
    expect(b.main.hint).toBe('Press again to stop immediately');
    expect(b.hard.disabled).toBe(false);
  });

  test('only stopping carries a hint', () => {
    expect(resolveTransportButtons('playing').main.hint).toBeNull();
    expect(resolveTransportButtons('stopped').main.hint).toBeNull();
  });

  test('every class is a daisyUI role, never a palette colour', () => {
    // themeTokenGuard bans raw palettes; this keeps the guard honest here too.
    for (const state of ['stopped', 'playing', 'stopping'] as const) {
      const { className } = resolveTransportButtons(state).main;
      expect(className).not.toMatch(/(indigo|slate|purple|emerald|pink|cyan|rose)-/);
    }
  });
});

describe('transportLabelClass (UX F-06)', () => {
  test('stopping shows its label at every width, so the phone sees it', () => {
    expect(transportLabelClass('stopping', false)).toBe('inline');
    expect(transportLabelClass('stopping', true)).toBe('inline');
  });

  test('other states keep the label hidden below the breakpoint', () => {
    for (const state of ['stopped', 'playing'] as const) {
      expect(transportLabelClass(state, false)).toBe('hidden sm:inline');
      expect(transportLabelClass(state, true)).toBe('hidden lg:inline');
    }
  });
});

// Review 4123990022: the stopping button is live, so the second click of a
// double-click (or a double-tap) landed on it and hard-stopped at once, losing
// the bar-line soft stop. The hard stop arms only after HARD_STOP_ARM_MS.
describe('isPressArmed', () => {
  test('a hard-stop press inside the window after this button soft-stopped is ignored', () => {
    expect(HARD_STOP_ARM_MS).toBe(300);
    expect(isPressArmed('hardStop', 1_000, 1_000)).toBe(false);
    expect(isPressArmed('hardStop', 1_000, 1_000 + HARD_STOP_ARM_MS - 1)).toBe(false);
  });

  test('from the window on, a press hard-stops', () => {
    expect(isPressArmed('hardStop', 1_000, 1_000 + HARD_STOP_ARM_MS)).toBe(true);
  });

  test('stopping entered some other way hard-stops on the first press', () => {
    expect(isPressArmed('hardStop', null, 5)).toBe(true);
  });

  test('play and soft stop are never delayed', () => {
    expect(isPressArmed('play', 1_000, 1_000)).toBe(true);
    expect(isPressArmed('softStop', 1_000, 1_000)).toBe(true);
  });
});

// Review 4123990796: the caller's aria-describedby outranks `title`, so the
// "press again" hint lived only where neither a screen reader nor a touch
// user could reach it. While stopping it joins the description.
describe('the stopping hint reaches assistive tech', () => {
  const render = (state: 'playing' | 'stopping') =>
    renderToString(
      <PlayerTransport
        state={state}
        onPlay={() => {}}
        onSoftStop={() => {}}
        onHardStop={() => {}}
        id="t"
        describedBy="label-target"
      />,
    );

  test('stopping: the description names the play target AND the hint', () => {
    const html = render('stopping');
    const hintId = /<span id="([^"]+)" hidden="">Press again to stop immediately<\/span>/.exec(html)?.[1];
    if (hintId === undefined) throw new Error('hint span not found');
    expect(html).toContain(`aria-describedby="label-target ${hintId}"`);
  });

  test('playing: the description is the play target alone', () => {
    const html = render('playing');
    expect(html).toContain('aria-describedby="label-target"');
    expect(html).not.toContain('Press again');
  });
});
