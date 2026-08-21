// ============================================================================
// Instrument Settings — Single Source of Truth
// ============================================================================
// รวมค่า settings ทั้งหมดของ instruments ไว้ในที่เดียว
// เพื่อให้ง่ายต่อการปรับแต่งและดูแลรักษา

// ----------------------------------------------------------------------------
// 1. Velocity Multipliers
// ----------------------------------------------------------------------------

/** Guitar pick-up (,) velocity = 70% ของ main velocity */
export const PICK_UP_VELOCITY_MULTIPLIER = 0.7;

/** Guitar strum up velocity = 70% ของ main velocity */
export const STRUM_UP_VELOCITY_MULTIPLIER = 0.7;

/** Hybrid chord velocity = 70% ของ main velocity */
export const HYBRID_CHORD_VELOCITY_MULTIPLIER = 0.7;

/** Bass pick-up (,) velocity = 70% ของ main velocity */
export const BASS_PICK_UP_VELOCITY_MULTIPLIER = 0.7;

// ----------------------------------------------------------------------------
// 2. Hammer-on / Pull-off Settings
// ----------------------------------------------------------------------------

/** Hammer-on velocity = 80% ของ main velocity */
export const HAMMER_ON_VELOCITY_MULTIPLIER = 0.8;

/** Pull-off velocity = 70% ของ main velocity */
export const PULL_OFF_VELOCITY_MULTIPLIER = 0.7;

/** Time window (ms) สำหรับ hammer-on/pull-off */
export const HAMMER_ON_WINDOW_MS = 200;

// ----------------------------------------------------------------------------
// 3. Velocity Bounds & Step
// ----------------------------------------------------------------------------

/** Velocity control step size (10 steps from 0 to 1) */
export const VELOCITY_STEP = 0.1;

/** Minimum velocity (to avoid silence) */
export const MIN_VELOCITY = 0.1;

/** Maximum velocity */
export const MAX_VELOCITY = 1.0;

// ----------------------------------------------------------------------------
// 4. Octave Bounds
// ----------------------------------------------------------------------------

/** Default minimum octave */
const DEFAULT_MIN_OCTAVE = 0;

/** Default maximum octave */
const DEFAULT_MAX_OCTAVE = 8;

/** Bass maximum octave (lower range) */
const BASS_MAX_OCTAVE = 6;

// ----------------------------------------------------------------------------
// 5. Default Values per Instrument
// ----------------------------------------------------------------------------

export const INSTRUMENT_DEFAULTS = {
  /** Base defaults (used by createInstrumentStore fallback) */
  base: {
    velocity: 0.8,
    melodyOctave: 4,
    rootOctave: 2,
  },
  /** Keyboard defaults */
  keyboard: {
    velocity: 0.8,
    melodyOctave: 4,
    rootOctave: 2,
  },
  /** Guitar defaults */
  guitar: {
    velocity: 0.8,
    melodyOctave: 4,
    rootOctave: 2,
  },
  /** Bass defaults */
  bass: {
    velocity: 0.8,
    melodyOctave: 2,
    rootOctave: 2,
  },
  /** Drum defaults */
  drum: {
    velocity: 0.8,
  },
  /** Drumpad local state default */
  drumpad: {
    velocity: 0.8,
  },
  /** useInstrumentState hook default */
  instrumentState: {
    velocity: 0.8,
  },
} as const;

// ----------------------------------------------------------------------------
// 6. Default Bounds (used by createInstrumentStore)
// ----------------------------------------------------------------------------

export const DEFAULT_VELOCITY_BOUNDS = {
  min: MIN_VELOCITY,
  max: MAX_VELOCITY,
  step: VELOCITY_STEP,
} as const;

export const DEFAULT_OCTAVE_BOUNDS = {
  min: DEFAULT_MIN_OCTAVE,
  max: DEFAULT_MAX_OCTAVE,
} as const;

export const BASS_OCTAVE_BOUNDS = {
  min: DEFAULT_MIN_OCTAVE,
  max: BASS_MAX_OCTAVE,
} as const;

export const BASS_VELOCITY_BOUNDS = {
  min: MIN_VELOCITY,
  max: MAX_VELOCITY,
  step: VELOCITY_STEP,
} as const;
