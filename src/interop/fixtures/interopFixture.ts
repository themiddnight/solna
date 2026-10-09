/**
 * The project body the interop tests read: two loops in 4/4 at 120 bpm.
 *
 * Loop 1 — C maj (1 bar) + A min7 (1 bar), played twice, bass muted.
 * Loop 2 — no chords (one silent bar of dwell), played once.
 * Both carry one lead note (E5, four ticks, at tick 0) and a Beat with a kick
 * on steps 0 and 8 and a hi-hat on every beat whose VOICE is muted.
 *
 * Test support only: named `*Fixture` so the production Knip graph skips it.
 */
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { factoryProjectContent, makeEnvelope, type ProjectBody } from '@/store/projectFormat';
import type { Loop } from '@/store/types';
import type { BeatVoiceId } from '@/types';
import { MAX_STEPS_PER_BAR } from '@/utils/timeSignature';

function beatRows(steps: Partial<Record<BeatVoiceId, number[]>>): Record<BeatVoiceId, boolean[]> {
  const rows = {} as Record<BeatVoiceId, boolean[]>;
  for (const voice of BEAT_VOICE_IDS) {
    const row = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
    for (const step of steps[voice] ?? []) row[step] = true;
    rows[voice] = row;
  }
  return rows;
}

function fixtureLoop(base: Loop, over: Partial<Loop>): Loop {
  const leadMelodySteps = base.leadMelodySteps.map(() => [] as Loop['leadMelodySteps'][number]);
  leadMelodySteps[0] = [{ note: 'E5', len: 4 }];
  return {
    ...base,
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    leadMelodySteps,
    leadLoopLength: 1,
    beatPattern: { rows: beatRows({ kick: [0, 8], hihat: [0, 4, 8, 12] }) },
    beatMix: {
      ...base.beatMix,
      muted: false,
      voices: { ...base.beatMix.voices, hihat: { ...base.beatMix.voices.hihat, muted: true } },
    },
    ...over,
  };
}

export function interopFixtureBody(): ProjectBody {
  const content = factoryProjectContent();
  const base = content.loops[0];
  return {
    ...makeEnvelope('Interop Fixture', 1_700_000_000_000),
    content: {
      ...content,
      bpm: 120,
      meterId: '4/4',
      loops: [
        fixtureLoop(base, {
          id: 'loop-a',
          name: 'Verse',
          repeatCount: 2,
          bassMuted: true,
          chords: [
            { id: 'c1', root: 'C', quality: 'maj', bars: 1 },
            { id: 'c2', root: 'A', quality: 'min7', bars: 1 },
          ],
        }),
        fixtureLoop(base, { id: 'loop-b', name: '', tempName: 'untitled-2', repeatCount: 1, chords: [] }),
      ],
    },
  };
}
