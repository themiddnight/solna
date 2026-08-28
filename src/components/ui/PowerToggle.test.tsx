import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { POWER_TOGGLE_TONES, PowerToggle, resolvePowerToggle } from './PowerToggle';

describe('resolvePowerToggle', () => {
  test('on wears the module tone, off is a plain ghost', () => {
    const on = resolvePowerToggle(true, 'module-chord', false);
    expect(on.className).toContain('[--btn-color:var(--color-module-chord)]');
    expect(on.label).toBe('On');

    const off = resolvePowerToggle(false, 'module-chord', false);
    expect(off.className).toContain('btn-ghost');
    expect(off.label).toBe('Off');
  });

  // design.md 6.5: `error` means destructive. ChordView used to paint the
  // off state btn-error, which reads as "broken" rather than "muted".
  test('the off state is never an error colour, for any tone', () => {
    for (const tone of POWER_TOGGLE_TONES) {
      expect(resolvePowerToggle(false, tone, false).className).not.toContain('error');
      expect(resolvePowerToggle(true, tone, false).className).not.toContain('error');
    }
  });

  test('every tone resolves to a token class, never a raw palette', () => {
    for (const tone of POWER_TOGGLE_TONES) {
      const { className } = resolvePowerToggle(true, tone, false);
      expect(className).not.toMatch(/indigo|slate|purple|emerald|pink|cyan|rose/);
      expect(className).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  test('iconOnly drops the text but keeps the square button shape', () => {
    const square = resolvePowerToggle(true, 'primary', true);
    expect(square.className).toContain('btn-square');
    expect(resolvePowerToggle(true, 'primary', false).className).not.toContain('btn-square');
  });

  // Negative assertions above pass even if two tones' classes are swapped or
  // one is blanked — pin each tone to its actual expected class.
  test('each tone maps to its own specific class, not just "not an error"', () => {
    expect(resolvePowerToggle(true, 'primary', false).className).toContain('btn-primary');
    expect(resolvePowerToggle(true, 'accent', false).className).toContain('btn-accent');
    expect(resolvePowerToggle(true, 'module-chord', false).className).toContain(
      '[--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]',
    );
    expect(resolvePowerToggle(true, 'module-bass', false).className).toContain(
      '[--btn-color:var(--color-module-bass)] [--btn-fg:var(--color-module-bass-content)]',
    );
  });
});

describe('PowerToggle title/aria-label', () => {
  test('title describes the click action, not the current state', () => {
    const on = renderToString(
      <PowerToggle on={true} onToggle={() => {}} name="Reverb" tone="accent" />,
    );
    expect(on).toContain('title="Turn off Reverb"');
    expect(on).toContain('aria-label="Reverb On"');

    const off = renderToString(
      <PowerToggle on={false} onToggle={() => {}} name="Reverb" tone="accent" />,
    );
    expect(off).toContain('title="Turn on Reverb"');
    expect(off).toContain('aria-label="Reverb Off"');
  });

  test('a custom verb pair (e.g. mute) overrides the generic power wording', () => {
    const unmuted = renderToString(
      <PowerToggle
        on={true}
        onToggle={() => {}}
        name="Kick"
        tone="primary"
        iconOnly
        verb={{ on: 'Unmute', off: 'Mute' }}
      />,
    );
    expect(unmuted).toContain('title="Mute Kick"');
    expect(unmuted).toContain('aria-label="Kick On"');
  });
});
