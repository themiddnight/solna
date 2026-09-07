/**
 * What is already available for a scale type, in one call.
 *
 * Run from the repo root:
 *   bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts
 *   bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts "Natural Minor"
 *
 * Organised by SCALE TYPE, not by genre: a vibe's pool is constrained by its
 * scaleType (referenceScale must match, minScaleLength must fit) and by nothing
 * else. The VibeGenre union and VIBE_GENRE_SCALES are gone — a pool is now a
 * taste call, so this prints the candidates and leaves the choosing to you.
 *
 * `bun run report:library` is the companion: it lists what NOTHING references.
 */
import { CHORD_PROGRESSIONS } from '@/data/chordProgressions';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { CHORD_RHYTHMS } from '@/data/chordRhythms';
import { BASS_PATTERNS } from '@/data/bassPatterns';
import { DRUM_GRIDS } from '@/data/drumGrids';
import { EFFECT_CHAINS } from '@/data/effectChains';
import { VIBES } from '@/data/vibes';
import { SCALES } from '@/data/scales';

const arg = process.argv[2];

if (!arg) {
  console.log('SCALE TYPES that progressions are authored against\n');
  const scales = [...new Set(CHORD_PROGRESSIONS.map((p) => p.referenceScale))].sort();
  for (const s of scales) {
    const playable = CHORD_PROGRESSIONS.filter(
      (p) => p.referenceScale === s && p.minScaleLength <= SCALES[s].intervals.length,
    );
    const vibes = VIBES.filter((v) => v.scaleType === s).map((v) => v.id);
    console.log(
      `${s.padEnd(15)} ${String(SCALES[s].intervals.length)} degrees  ` +
        `${String(playable.length).padStart(2)} progressions   used by: ${vibes.join(', ') || '(none)'}`,
    );
  }
  console.log('\nPass a scale type in quotes for its full inventory.');
  process.exit(0);
}

if (!SCALES[arg]) {
  console.error(`Unknown scale type "${arg}". Known: ${Object.keys(SCALES).join(', ')}`);
  process.exit(1);
}

const len = SCALES[arg].intervals.length;
console.log(`SCALE ${arg} — ${len} degrees\n`);

const pool = CHORD_PROGRESSIONS.filter((p) => p.referenceScale === arg && p.minScaleLength <= len);
console.log('PROGRESSIONS a vibe in this scale may pool. Choose; do not copy wholesale:');
for (const p of pool) {
  const bars = p.steps.map((s) => s.bars);
  const uniform = new Set(bars).size === 1 ? `${bars[0]} bars each` : `bars ${bars.join('/')}`;
  console.log(
    `  ${p.id.padEnd(28)} ${String(p.steps.length)} steps, ${uniform.padEnd(14)} ${p.roman}` +
      `   tags: ${p.genres.join(',') || '-'}`,
  );
}
const fourStep = pool.filter((p) => p.steps.length === 4);
console.log(`\n  ${fourStep.length}/${pool.length} have exactly 4 steps — a vibe's own progressionId must be one of those:`);
console.log(`  ${JSON.stringify(fourStep.map((p) => p.id))}`);
console.log('  (`genres` is a free-form browsing tag. Nothing computes from it.)');

console.log('\nPRESETS — no genre tags exist by design; pick by ear, by category.');
const byCat = new Map<string, typeof SYNTH_PRESETS>();
for (const p of SYNTH_PRESETS) {
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
for (const v of VIBES) {
  const mark = v.scaleType === arg ? '*' : ' ';
  console.log(`  ${mark}${v.id.padEnd(15)} lead ${v.synthPresetId.padEnd(26)} comp ${v.chordPresetId.padEnd(26)} bass ${v.bassPresetId}`);
}
console.log('  (* = same scale type as the one you asked about)');

console.log(`\nCOMP RHYTHMS  ${JSON.stringify(CHORD_RHYTHMS.map((r) => r.id))}`);
console.log(`BASS PATTERNS ${JSON.stringify(BASS_PATTERNS.map((b) => b.id))}`);
console.log(`DRUM GRIDS ${JSON.stringify(Object.keys(DRUM_GRIDS))}`);
console.log("  (one table: a vibe's drumGridId and the sequencer's grid menu both resolve here)");
console.log(`EFFECT CHAINS ${JSON.stringify(Object.keys(EFFECT_CHAINS))}`);
for (const [id, chain] of Object.entries(EFFECT_CHAINS)) {
  console.log(`  ${id.padEnd(24)} ${JSON.stringify(chain)}`);
}
console.log('  (a Partial<MasterEffects> — an omitted key inherits the current value, so omissions are deliberate)');
