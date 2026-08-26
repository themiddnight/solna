/**
 * What is already available for a genre, in one call.
 *
 * Run from the repo root:
 *   bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts <genre>
 *   bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts            # all genres, summary only
 *
 * Exists so authoring a vibe starts from what the libraries actually hold
 * rather than from an archaeology dig through five source files.
 */
import { CHORD_PROGRESSIONS, VIBE_GENRE_SCALES } from '../../../../src/audio/data/chordProgressions';
import { ALL_FACTORY_PRESETS } from '../../../../src/audio/synthPresets';
import { RHYTHM_PATTERNS } from '../../../../src/audio/rhythmPatterns';
import { BASS_PATTERNS } from '../../../../src/audio/bassPatterns';
import { INSTANT_VIBES } from '../../../../src/store/instantVibes';
import { SCALES } from '../../../../src/utils/musicTheory';
import type { VibeGenre } from '../../../../src/types';

const GENRES = Object.keys(VIBE_GENRE_SCALES) as VibeGenre[];
const arg = process.argv[2] as VibeGenre | undefined;

function scaleLength(scaleType: string): number {
  return (SCALES[scaleType] ?? SCALES.Major).intervals.length;
}

if (!arg) {
  console.log('GENRES (scale is fixed per genre — a vibe cannot choose its own)\n');
  for (const g of GENRES) {
    const tagged = CHORD_PROGRESSIONS.filter((p) => p.genres.includes(g));
    const vibes = INSTANT_VIBES.filter((v) => v.variation?.genre === g).map((v) => v.id);
    console.log(
      `${g.padEnd(10)} ${VIBE_GENRE_SCALES[g].padEnd(15)} ${String(tagged.length).padStart(2)} progressions` +
        `   used by: ${vibes.join(', ') || '(none)'}`,
    );
  }
  console.log('\nA genre needs >= 4 progressions. Pass a genre name for its full inventory.');
  process.exit(0);
}

if (!GENRES.includes(arg)) {
  console.error(`Unknown genre "${arg}". Known: ${GENRES.join(', ')}`);
  console.error('A new genre is a four-step change — see the skill.');
  process.exit(1);
}

const scaleType = VIBE_GENRE_SCALES[arg];
const len = scaleLength(scaleType);
console.log(`GENRE ${arg} — scaleType is always "${scaleType}" (${len} degrees)\n`);

const pool = CHORD_PROGRESSIONS.filter((p) => p.genres.includes(arg) && p.minScaleLength <= len);
console.log(`PROGRESSIONS — this is exactly the dice pool. Copy it verbatim into variation.progressionIds:`);
console.log(JSON.stringify(pool.map((p) => p.id)));
console.log();
for (const p of pool) {
  const bars = p.steps.map((s) => s.bars);
  const uniform = new Set(bars).size === 1 ? `${bars[0]} bars each` : `bars ${bars.join('/')}`;
  console.log(`  ${p.id.padEnd(28)} ${String(p.steps.length)} steps, ${uniform.padEnd(14)} ${p.roman}`);
}
const fourStep = pool.filter((p) => p.steps.length === 4);
console.log(`\n  ${fourStep.length}/${pool.length} have exactly 4 steps — a vibe's own progressionId must be one of those:`);
console.log(`  ${JSON.stringify(fourStep.map((p) => p.id))}`);

console.log('\nPRESETS — no genre tags exist by design; pick by ear, by category.');
const byCat = new Map<string, typeof ALL_FACTORY_PRESETS>();
for (const p of ALL_FACTORY_PRESETS) {
  if (!byCat.has(p.category)) byCat.set(p.category, []);
  byCat.get(p.category)!.push(p);
}
for (const [cat, list] of [...byCat].sort()) {
  console.log(`\n  ${cat}${cat === 'Bass' ? '   <- bassPresetId must resolve here' : ''}`);
  for (const p of list) {
    const q = p.params;
    console.log(
      `    ${p.id.padEnd(26)} ${String(q.oscType ?? '?').padEnd(9)} cut ${String(q.filterCutoff ?? '?').padStart(5)}` +
        ` env ${String(q.filterEnvAmount ?? '?').padStart(4)} A${q.attack ?? '?'} D${q.decay ?? '?'} S${q.sustain ?? '?'} R${q.release ?? '?'}` +
        ` sub ${q.subOscVolume ?? 0} noise ${q.noiseVolume ?? 0}${q.octave ? ` oct ${q.octave > 0 ? '+' : ''}${q.octave}` : ''}`,
    );
  }
}

console.log('\nWHICH VOICES THE EXISTING VIBES USE');
for (const v of INSTANT_VIBES) {
  const mark = v.variation?.genre === arg ? '*' : ' ';
  console.log(`  ${mark}${v.id.padEnd(15)} lead ${v.synthPresetId.padEnd(26)} comp ${v.chordPresetId.padEnd(26)} bass ${v.bassPresetId}`);
}
console.log('  (* = same genre as the one you asked about)');

console.log(`\nCOMP RHYTHMS  ${JSON.stringify(RHYTHM_PATTERNS.map((r) => r.id))}`);
console.log(`BASS PATTERNS ${JSON.stringify(BASS_PATTERNS.map((b) => b.id))}`);
