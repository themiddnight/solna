import { describe, expect, test } from 'bun:test';
import { resolveTransportButtons, transportLabelClass } from './PlayerTransport';

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
    expect(b.hard.disabled).toBe(false);
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
