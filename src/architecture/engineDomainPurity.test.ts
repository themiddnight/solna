/**
 * The committed proof that DEV-399's engine dependency guard is armed.
 *
 * "The engine imports no Tonal adapter, scale catalog, chord catalog, spelling
 * or reharmonization module" is an argument that rests entirely on a config
 * file, and a config file is exactly what an ESLint upgrade loosens silently.
 * Same idiom as src/architecture/playbackPlannerPurity.test.ts and
 * src/data/dataLayerPurity.test.ts: severity is asserted too, because a block
 * that landed at 'warn' would enforce nothing.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

const ENGINE = 'src/audio/synth/__domainFixture__.ts';
/**
 * The engine facade itself. A real path, not a fixture name: the block names
 * `src/audio/engine.ts` explicitly rather than by glob, so a made-up sibling
 * filename would not be in its file set and this assertion would pass
 * vacuously. `lintText` lints the text it is given, never the file on disk.
 */
const ENGINE_ROOT = 'src/audio/engine.ts';
/** A file under src/audio/ that is NOT the engine, to prove the block is scoped. */
const CONTROLLER = 'src/audio/playback/chordPlayback.ts';
/**
 * The two DSP runtimes named in the block's `files` list beside the synth
 * folder and the engine facade, each a real on-disk path rather than a glob
 * match — proving the block's `files` array genuinely reaches both rather
 * than relying on `src/audio/synth/**` alone to cover them.
 */
const DRUM_SYNTH = 'src/audio/drumSynth.ts';
const MASTER_RACK = 'src/audio/masterRack.ts';

async function messagesFor(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null)
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const RESTRICTED = { ruleId: 'no-restricted-imports', severity: 2 };

const CASES: Array<[label: string, source: string]> = [
  ['the note-frequency conversion, aliased',
    "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency;\n"],
  ['the note-frequency conversion, relative',
    "import { noteFrequency } from '../../utils/musicTheory';\nexport const f = noteFrequency;\n"],
  ['Music Core, aliased',
    "import { noteMidi } from '@/musicCore';\nexport const m = noteMidi;\n"],
  ['Music Core, relative',
    "import { noteMidi } from '../musicCore';\nexport const m = noteMidi;\n"],
  ['the Tonal adapter by subpath',
    "import { octaveOfNote } from '@/musicCore/tonalAdapter';\nexport const o = octaveOfNote;\n"],
  ['the scale catalog',
    "import { SCALES } from '@/data/scales';\nexport const s = SCALES;\n"],
  ['the chord catalog',
    "import { CHORD_PROGRESSIONS } from '@/data/chordProgressions';\nexport const c = CHORD_PROGRESSIONS;\n"],
  ['note spelling',
    "import { spellNote } from '@/utils/noteSpelling';\nexport const s = spellNote;\n"],
  ['reharmonization',
    "import { snapProgressionToScale } from '@/utils/musicTheory';\nexport const s = snapProgressionToScale;\n"],
];

/**
 * The five audio-side theory modules banned by `ENGINE_MUSIC_DOMAIN_BAN`
 * (`arpeggiator.ts`, `bassPatterns.ts`, `chordProgressions.ts`,
 * `chordRhythms.ts`, `leadMelody.ts`) all live directly inside `src/audio/`,
 * siblings of `engine.ts`/`drumSynth.ts`/`masterRack.ts` — exactly like
 * `leadStepRecord.ts`. A round-2 review found the block's entries for these
 * five were still the prefixed `**` + `/audio/xyz` form, which matches the
 * `@/`-aliased import but NOT the relative form a sibling file actually
 * writes (`./arpeggiator`, `../bassPatterns`, etc. — none of those contain an
 * `audio/` path segment). Each module gets both forms tested here, the same
 * discipline that already caught and fixed the identical hole for
 * `leadStepRecord` one round earlier.
 */
const THEORY_SIBLING_CASES: Array<[label: string, source: string]> = [
  ['arpeggiator, aliased',
    "import { buildArpSequenceUncached } from '@/audio/arpeggiator';\nexport const a = buildArpSequenceUncached;\n"],
  ['arpeggiator, relative',
    "import { buildArpSequenceUncached } from '../arpeggiator';\nexport const a = buildArpSequenceUncached;\n"],
  ['bassPatterns (audio-side resolver), aliased',
    "import { resolveBassSteps } from '@/audio/bassPatterns';\nexport const b = resolveBassSteps;\n"],
  ['bassPatterns (audio-side resolver), relative',
    "import { resolveBassSteps } from '../bassPatterns';\nexport const b = resolveBassSteps;\n"],
  ['chordProgressions (audio-side resolver), aliased',
    "import { resolveProgression } from '@/audio/chordProgressions';\nexport const c = resolveProgression;\n"],
  ['chordProgressions (audio-side resolver), relative',
    "import { resolveProgression } from '../chordProgressions';\nexport const c = resolveProgression;\n"],
  ['chordRhythms, aliased',
    "import { feelToHoldScale } from '@/audio/chordRhythms';\nexport const c = feelToHoldScale;\n"],
  ['chordRhythms, relative',
    "import { feelToHoldScale } from '../chordRhythms';\nexport const c = feelToHoldScale;\n"],
  ['leadMelody, aliased',
    "import { DEFAULT_LEAD_GATE } from '@/audio/leadMelody';\nexport const l = DEFAULT_LEAD_GATE;\n"],
  ['leadMelody, relative',
    "import { DEFAULT_LEAD_GATE } from '../leadMelody';\nexport const l = DEFAULT_LEAD_GATE;\n"],
];

describe('engine music-domain guard (DEV-399)', () => {
  for (const [label, source] of CASES) {
    test(`${label} is an error inside the engine`, async () => {
      expect(await messagesFor(source, ENGINE)).toContainEqual(RESTRICTED);
    });
  }

  for (const [label, source] of THEORY_SIBLING_CASES) {
    test(`${label} is an error inside the engine`, async () => {
      expect(await messagesFor(source, ENGINE)).toContainEqual(RESTRICTED);
    });
  }

  test('the ban reaches src/audio/engine.ts itself, not just the synth folder', async () => {
    const source = "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency;\n";
    expect(await messagesFor(source, ENGINE_ROOT)).toContainEqual(RESTRICTED);
  });

  test('the ban reaches src/audio/drumSynth.ts, not just the synth folder and the engine facade', async () => {
    const source = "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency;\n";
    expect(await messagesFor(source, DRUM_SYNTH)).toContainEqual(RESTRICTED);
  });

  test('the ban reaches src/audio/masterRack.ts, not just the synth folder and the engine facade', async () => {
    const source = "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency;\n";
    expect(await messagesFor(source, MASTER_RACK)).toContainEqual(RESTRICTED);
  });

  test('the hand-rolled note-name parser in leadStepRecord is banned, aliased', async () => {
    const source = "import { noteOctave } from '@/audio/leadStepRecord';\nexport const o = noteOctave;\n";
    expect(await messagesFor(source, ENGINE)).toContainEqual(RESTRICTED);
  });

  test('the hand-rolled note-name parser in leadStepRecord is banned, relative', async () => {
    const source = "import { noteOctave } from '../leadStepRecord';\nexport const o = noteOctave;\n";
    expect(await messagesFor(source, ENGINE)).toContainEqual(RESTRICTED);
  });

  test('the TIMING half of musicTheory is still allowed — the ban is about the domain, not the module', async () => {
    const source = "import { STEPS_PER_BAR } from '../utils/musicTheory';\nexport const s = STEPS_PER_BAR;\n";
    expect(await messagesFor(source, ENGINE_ROOT)).not.toContainEqual(RESTRICTED);
  });

  test('the block is SCOPED: a controller may still resolve a pitch', async () => {
    const source = "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency;\n";
    expect(await messagesFor(source, CONTROLLER)).not.toContainEqual(RESTRICTED);
  });

  test('the wider audio bans still apply inside the engine', async () => {
    // The narrower block REPLACES the broader rule rather than merging with it,
    // so every list it overrides has to be spread back in. These four prove it:
    // tonal (DEV-394), the store (layering rule 1 — which is also what keeps
    // "the audio engine never writes persisted application state" true),
    // components, and the DEV-386 slider-position <-> dB taper ban.
    expect(await messagesFor("import { note } from 'tonal';\nexport const n = note;\n", ENGINE))
      .toContainEqual(RESTRICTED);
    expect(await messagesFor("import { useAppStore } from '@/store/store';\nexport const s = useAppStore;\n", ENGINE))
      .toContainEqual(RESTRICTED);
    expect(await messagesFor("import { Knob } from '@/components/ui/Knob';\nexport const k = Knob;\n", ENGINE))
      .toContainEqual(RESTRICTED);
    expect(await messagesFor("import { dbToSliderPos } from '@/utils/gainUnits';\nexport const d = dbToSliderPos;\n", ENGINE))
      .toContainEqual(RESTRICTED);
  });
});
