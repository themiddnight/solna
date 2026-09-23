import { describe, expect, test } from 'bun:test';
import { VIBES } from '@/data/vibes';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { PICK_PROMPT, vibeLoadedFeedback, vibeSummaryLine } from './useVibePicker';

const vibe = VIBES[0];
const key = formatKeyLabel(vibe.scaleRoot, vibe.scaleType);

describe('the picker footer and its Use toast', () => {
  test('before any preview the footer prompts', () => {
    expect(vibeSummaryLine(null)).toBe(PICK_PROMPT);
    expect(PICK_PROMPT).toBe('Pick a vibe to hear it on this loop.');
  });

  test('a preview reads name · key · BPM, from what is sounding', () => {
    const spec = { ...vibe, bpm: vibe.bpm + 7 };
    expect(vibeSummaryLine({ base: vibe, spec })).toBe(`${vibe.name} · ${key} · ${vibe.bpm + 7} BPM`);
  });

  test('Use confirms under the one vibe key; a dice variant adds its headline', () => {
    expect(vibeLoadedFeedback({ base: vibe, spec: vibe })).toEqual({
      key: 'vibe', message: `Loaded ${vibe.name} (${vibe.bpm} BPM · Key ${key})`, tone: 'success',
    });
    const rolled = vibeLoadedFeedback({ base: vibe, spec: vibe, reroll: { headline: 'H', detail: 'D' } });
    expect(rolled.detail).toBe('H');
  });
});
