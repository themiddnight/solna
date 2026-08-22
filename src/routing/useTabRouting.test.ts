import { describe, expect, test } from 'bun:test';
import { resolveInitialTab } from './useTabRouting';
import { TAB_VALUES } from './tabRouting';

describe('resolveInitialTab', () => {
  test('adopts all four valid tab values without normalizing', () => {
    for (const tab of TAB_VALUES) {
      expect(resolveInitialTab(`?tab=${tab}`)).toEqual({ tab, needsNormalize: false });
    }
  });

  test('accepts a search string without the leading question mark', () => {
    expect(resolveInitialTab('tab=sequencer')).toEqual({ tab: 'sequencer', needsNormalize: false });
  });

  test('keeps valid tabs while other params are present', () => {
    expect(resolveInitialTab('?foo=1&tab=chords')).toEqual({ tab: 'chords', needsNormalize: false });
  });

  test('falls back to synth and normalizes when the tab param is missing', () => {
    expect(resolveInitialTab('')).toEqual({ tab: 'synth', needsNormalize: true });
    expect(resolveInitialTab('?foo=1')).toEqual({ tab: 'synth', needsNormalize: true });
  });

  test('falls back to synth and normalizes for an invalid or empty tab value', () => {
    expect(resolveInitialTab('?tab=invalid')).toEqual({ tab: 'synth', needsNormalize: true });
    expect(resolveInitialTab('?tab=drums')).toEqual({ tab: 'synth', needsNormalize: true });
    expect(resolveInitialTab('?tab=')).toEqual({ tab: 'synth', needsNormalize: true });
    expect(resolveInitialTab('?tab=CHORDS')).toEqual({ tab: 'synth', needsNormalize: true }); // case-sensitive
  });
});
