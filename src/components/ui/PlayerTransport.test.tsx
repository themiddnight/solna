import { describe, expect, test } from 'bun:test';
import { resolveTransportButtons } from './PlayerTransport';

describe('resolveTransportButtons', () => {
  test('stopped offers play and disables hard stop', () => {
    const b = resolveTransportButtons('stopped');
    expect(b.main.icon).toBe('play');
    expect(b.main.label).toBe('Play');
    expect(b.main.disabled).toBe(false);
    expect(b.hard.disabled).toBe(true);
  });

  test('playing offers stop and enables hard stop', () => {
    const b = resolveTransportButtons('playing');
    expect(b.main.icon).toBe('stop');
    expect(b.main.label).toBe('Stop');
    expect(b.main.disabled).toBe(false);
    expect(b.hard.disabled).toBe(false);
  });

  test('stopping is a disabled pulsing stop indicator, but hard stop stays live', () => {
    const b = resolveTransportButtons('stopping');
    expect(b.main.label).toBe('Stopping…');
    expect(b.main.disabled).toBe(true);
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
