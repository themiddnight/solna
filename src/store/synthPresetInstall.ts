import { audioEngine } from '@/audio/engine';
import type { SynthPreset } from '@/data/synthPresets';
import type { SynthControlTarget } from '@/utils/synthControl';
import { applySynthPreset } from '@/utils/synthPresets';
import type { SourceBusId } from './sourceBuses';
import { SYNTH_ARP_FIELD, SYNTH_SETTER_FIELD } from './sourceBuses';
import { useAppStore } from './store';

/**
 * The gap a preset install leaves before the new sound can be played. The same
 * 0.02 s every other whole-bus stop uses (`LOAD_LOOP_RELEASE`,
 * `VIBE_SWAP_RELEASE`, `INSTALL_RELEASE`) and the same value the voice manager
 * used while it still decided this for itself, so the install is inaudibly
 * identical to what it replaced.
 */
export const PRESET_INSTALL_RELEASE = 0.02;

/**
 * Both ways a library entry can land on a track, and they differ by exactly one
 * thing: whether the bus is stopped first.
 *
 * **The stop lives here because nothing downstream can infer it.** The voice
 * manager used to decide it from the two `ActiveSynth` values alone, asking
 * whether `sourcePresetId` had changed — but every edit path preserves that id
 * (`SubtractiveProPanel`, `SimpleSynthPanel` and `writeSubtractiveSimple` all
 * spread the patch they were handed), so "the user turned a knob" and "the user
 * re-picked the preset they have been editing" arrive there identical in the
 * only field that was being read. The first must morph the sounding voices and
 * the second must not, and no predicate over two patches can tell them apart.
 * Intent is knowable only where it is formed, so the caller states it.
 *
 * `src/store/` may import `src/audio/`, which is why these are store functions
 * and not component helpers: `loadSynthPreset` is what a view calls, and the
 * engine reach stays on this side of the layering line.
 *
 * **The stop reaches hits the transport has already BOOKED, and that is
 * intended.** `stopSource` runs at `ctx.currentTime` and silences every group
 * on the bus, including a sequenced voice whose oscillators are scheduled to
 * start inside the clock's lookahead window — stopping a source before its
 * start time means it never sounds at all, so up to one booked hit is lost and
 * the bridge does not re-book it. Loading a preset is an explicit request to
 * silence the bus, so losing the hit on the far side of that silence costs
 * nothing a user did not ask for; deferring the stop to the end of the
 * lookahead window would buy that one note at the price of a ~100 ms delay
 * before the sound they just picked is audible, and would put
 * `CLOCK_LOOKAHEAD` into the store layer. Do not "fix" this into a re-book:
 * `src/audio/` may not read the store, so nothing below here knows what the
 * lost hit was.
 */
function stopForInstall(target: SynthControlTarget): void {
  // Every `SynthControlTarget` is also the engine's name for that bus. Held in
  // a typed local rather than assumed at the call: if the two unions ever
  // diverge this is a compile error, not a stop aimed at a bus that does not
  // exist.
  const source: SourceBusId = target;
  audioEngine.stopSource(source, PRESET_INSTALL_RELEASE);
}

/** The patch a preset installs on one track, with that track's Arp preserved. */
function patchFor(target: SynthControlTarget, preset: SynthPreset) {
  // Arp is read at call time and handed straight back by `applySynthPreset`:
  // loading a sound never re-arms the arpeggiator.
  const arp = useAppStore.getState()[SYNTH_ARP_FIELD[target]];
  return applySynthPreset(arp, preset).activeSynth;
}

/**
 * Loads a library entry onto a track: stops whatever that bus is sounding, then
 * installs the complete patch.
 *
 * Re-picking a preset you have already edited takes this path too, and that is
 * the point — before, it live-morphed and you heard a hybrid of the edited
 * patch and the library one, the old envelope timing, the old ENV2 route
 * amounts (fixed at note-on) and the old `outputGainDb` all surviving
 * underneath the new oscillators and filter.
 */
export function loadSynthPreset(target: SynthControlTarget, preset: SynthPreset): void {
  stopForInstall(target);
  useAppStore.getState()[SYNTH_SETTER_FIELD[target]](patchFor(target, preset));
}

/**
 * Adopts the preset a Save just created, which is deliberately NOT a load: the
 * saved patch is by construction the sound already playing, so stopping the bus
 * would cut a held key and every scheduled hit to swap a sound for itself. Only
 * the provenance moves — `sourcePresetId` becomes the new entry's id, which is
 * what lights that card up in the library — so this writes through the plain
 * setter and the voices carry on.
 */
export function adoptSavedSynthPreset(target: SynthControlTarget, preset: SynthPreset): void {
  useAppStore.getState()[SYNTH_SETTER_FIELD[target]](patchFor(target, preset));
}
