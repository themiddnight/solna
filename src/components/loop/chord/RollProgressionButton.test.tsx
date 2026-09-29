import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { RollOptionsPanel, RollProgressionButton } from './RollProgressionButton';
import type { UseProgressionDice } from './useProgressionDice';

// Plain props, no store: the renderToString trap (R257) cannot reach these
// renders, because nothing here reads useAppStore.
function dice(overrides: Partial<UseProgressionDice> = {}): UseProgressionDice {
  return {
    chordCount: 'keep',
    setChordCount: () => {},
    barsPerChord: 1,
    setBarsPerChord: () => {},
    allowBorrowed: false,
    setAllowBorrowed: () => {},
    borrowedAvailable: true,
    optionsOpen: false,
    toggleOptions: () => {},
    closeOptions: () => {},
    roll: () => {},
    rollFromOptions: () => {},
    ...overrides,
  };
}

/** The opening tag of the element whose attributes contain `marker`. */
function openTag(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
}

describe('RollProgressionButton', () => {
  test('a join of the Random button and the options caret, panel closed', () => {
    const html = renderToString(<RollProgressionButton dice={dice()} />);
    expect(html.startsWith('<div class="join">')).toBe(true);
    const roll = openTag(html, 'id="btn-roll-progression"');
    expect(roll).toContain('aria-label="Random progression"');
    expect(roll).toContain('btn btn-xs btn-secondary btn-soft join-item gap-1');
    expect(html).toContain('<span class="hidden sm:inline">Random</span>');
    const caret = openTag(html, 'id="btn-roll-progression-options"');
    expect(caret).toContain('aria-haspopup="dialog"');
    expect(caret).toContain('aria-expanded="false"');
    expect(caret).toContain('join-item');
    expect(html).not.toContain('role="dialog"');
  });

  test('open: aria-expanded flips and the options panel mounts', () => {
    const html = renderToString(<RollProgressionButton dice={dice({ optionsOpen: true })} />);
    expect(openTag(html, 'id="btn-roll-progression-options"')).toContain('aria-expanded="true"');
    expect(html).toContain('<div role="dialog" aria-label="Random options"');
  });
});

describe('RollOptionsPanel', () => {
  test('Chords offers Keep, 2, 3, 4, 6, 8 with Keep pressed; Bars per chord is hidden while Keep', () => {
    const html = renderToString(<RollOptionsPanel dice={dice()} />);
    for (const id of ['keep', '2', '3', '4', '6', '8']) expect(html).toContain(`id="btn-roll-chords-${id}"`);
    expect(openTag(html, 'id="btn-roll-chords-keep"')).toContain('aria-pressed="true"');
    expect(openTag(html, 'id="btn-roll-chords-keep"')).toContain('btn btn-xs join-item btn-active btn-primary');
    expect(openTag(html, 'id="btn-roll-chords-4"')).toContain('aria-pressed="false"');
    expect(html).not.toContain('Bars per chord');
  });

  test('a chord count shows Bars per chord with the current choice pressed', () => {
    const html = renderToString(<RollOptionsPanel dice={dice({ chordCount: 4, barsPerChord: 2 })} />);
    expect(html).toContain('Bars per chord');
    expect(openTag(html, 'id="btn-roll-bars-2"')).toContain('aria-pressed="true"');
    expect(openTag(html, 'id="btn-roll-bars-1"')).toContain('aria-pressed="false"');
  });

  test('Borrowed is a toggle; with no borrowed chords it is disabled and says why', () => {
    const on = renderToString(<RollOptionsPanel dice={dice({ allowBorrowed: true })} />);
    expect(openTag(on, 'id="chk-roll-borrowed"')).toContain('toggle toggle-sm toggle-secondary');
    expect(openTag(on, 'id="chk-roll-borrowed"')).toContain('checked=""');
    const none = renderToString(<RollOptionsPanel dice={dice({ allowBorrowed: true, borrowedAvailable: false })} />);
    expect(openTag(none, 'id="chk-roll-borrowed"')).toContain('disabled=""');
    expect(openTag(none, 'id="chk-roll-borrowed"')).not.toContain('checked=""');
    expect(none).toContain('This scale has no borrowed chords.');
  });

  test('notes that 7ths follow Quick Add, and offers its own Random', () => {
    const html = renderToString(<RollOptionsPanel dice={dice()} />);
    expect(html).toContain('7ths follow Quick Add.');
    expect(html).toContain('id="btn-roll-progression-apply"');
  });
});
