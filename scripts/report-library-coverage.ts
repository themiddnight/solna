/**
 * Which library entries no vibe references.
 *
 *   bun run report:library
 *
 * A REPORT, NOT AN ASSERTION. It always exits 0 and is deliberately not part
 * of `bun run verify`. An unreferenced entry is a fact about the content, not
 * a defect: a progression may exist for the chord preset browser and never
 * suit any vibe. Asserting on the count would make the library's growth depend
 * on the vibes' appetite for it — the exact coupling that deleting the derived
 * genre pool was meant to remove.
 *
 * It exists because explicit per-vibe pools have one accepted cost: a new
 * library entry no longer joins a pool automatically, so it can sit unused
 * forever with nothing saying so. This is the thing that says so.
 */
import { VIBES } from '../src/data/vibes.ts';
import { CHORD_PROGRESSIONS } from '../src/data/chordProgressions.ts';
import { CHORD_RHYTHMS } from '../src/data/chordRhythms.ts';
import { BASS_PATTERNS } from '../src/data/bassPatterns.ts';
import { DRUM_GRIDS } from '../src/data/drumGrids.ts';
import { EFFECT_CHAINS } from '../src/data/effectChains.ts';
import { SYNTH_PRESETS } from '../src/data/synthPresets.ts';

const referenced = {
  progressions: new Set<string>(),
  chordRhythms: new Set<string>(),
  bassPatterns: new Set<string>(),
  drumGrids: new Set<string>(),
  effectChains: new Set<string>(),
  synthPresets: new Set<string>(),
};

for (const v of VIBES) {
  referenced.progressions.add(v.progressionId);
  referenced.chordRhythms.add(v.chordRhythmId);
  referenced.bassPatterns.add(v.bassPatternId);
  referenced.drumGrids.add(v.drumGridId);
  referenced.effectChains.add(v.effectChainId);
  referenced.synthPresets.add(v.synthPresetId);
  referenced.synthPresets.add(v.chordPresetId);
  referenced.synthPresets.add(v.bassPresetId);
  if (v.pad) referenced.synthPresets.add(v.pad.presetId);
  const r = v.random;
  if (!r) continue;
  for (const id of r.progressions) referenced.progressions.add(id);
  for (const id of r.chordRhythms) referenced.chordRhythms.add(id);
  for (const id of r.bassPatterns) referenced.bassPatterns.add(id);
  for (const id of r.drumGrids) referenced.drumGrids.add(id);
}

function report(label: string, allIds: string[], used: Set<string>): void {
  const unused = allIds.filter((id) => !used.has(id));
  const head = `${label.padEnd(18)} ${String(allIds.length - unused.length).padStart(3)}/${String(allIds.length).padEnd(3)} referenced`;
  if (unused.length === 0) {
    console.log(`${head}   (all)`);
    return;
  }
  console.log(`${head}   ${unused.length} unreferenced:`);
  for (const id of unused) console.log(`    ${id}`);
}

console.log('Library entries no Instant Vibe references.');
console.log('A report, not a check — this always exits 0.\n');

report('progressions', CHORD_PROGRESSIONS.map((p) => p.id), referenced.progressions);
report('chord rhythms', CHORD_RHYTHMS.map((p) => p.id), referenced.chordRhythms);
report('bass patterns', BASS_PATTERNS.map((p) => p.id), referenced.bassPatterns);
report('drum grids', Object.keys(DRUM_GRIDS), referenced.drumGrids);
report('effect chains', Object.keys(EFFECT_CHAINS), referenced.effectChains);
report('synth presets', SYNTH_PRESETS.map((p) => p.id), referenced.synthPresets);

console.log('\nUnreferenced is not wrong. The chord preset browser, the sequencer');
console.log('drum-grid picker and the synth preset library all read these tables too.');
console.log('Since the two drum-grid tables merged, the sequencer\'s own 14 grids');
console.log('show up here as unreferenced — they are the menu, not a vibe\'s choice.');
