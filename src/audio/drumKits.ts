import { DEFAULT_DRUM_KIT, type DrumKit } from '@/data/drumKits';

/** A kit is a partial; this is the merge that makes it whole. */
export function mergeDrumKit(partial?: Partial<DrumKit>): DrumKit {
  return {
    kick: { ...DEFAULT_DRUM_KIT.kick, ...partial?.kick },
    snare: { ...DEFAULT_DRUM_KIT.snare, ...partial?.snare },
    rimshot: { ...DEFAULT_DRUM_KIT.rimshot, ...partial?.rimshot },
    clap: { ...DEFAULT_DRUM_KIT.clap, ...partial?.clap },
    hihat: { ...DEFAULT_DRUM_KIT.hihat, ...partial?.hihat },
    openhat: { ...DEFAULT_DRUM_KIT.openhat, ...partial?.openhat },
    hitom: { ...DEFAULT_DRUM_KIT.hitom, ...partial?.hitom },
    lowtom: { ...DEFAULT_DRUM_KIT.lowtom, ...partial?.lowtom },
    ride: { ...DEFAULT_DRUM_KIT.ride, ...partial?.ride },
    crash: { ...DEFAULT_DRUM_KIT.crash, ...partial?.crash },
    bell: { ...DEFAULT_DRUM_KIT.bell, ...partial?.bell },
  };
}
