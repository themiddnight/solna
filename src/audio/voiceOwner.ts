/**
 * Who created a synth voice. Four values, each a kind of caller that exists
 * today; none is speculative.
 *
 * - `'live'`      — a person pressing something: computer keyboard, on-screen
 *                   keyboard, MIDI device.
 * - `'arp'`       — the arpeggiator's clock.
 * - `'sequencer'` — the transport playing back written material.
 * - `'preview'`   — an audition: a library item or a grid cell clicked to hear.
 *
 * A tuple AND a type, not one of them: a union declared alone cannot be
 * enumerated at runtime, and a roster declared alone cannot be checked at
 * compile time. `voiceOwner.test.ts` pins the two together in both directions.
 *
 * Its own leaf module rather than an export of `engine.ts` because every bridge
 * in `audio/playback/` needs the type and none of them should widen its
 * dependency on the engine to get it. It imports nothing.
 */
export const VOICE_OWNERS = ['live', 'arp', 'sequencer', 'preview'] as const;

export type VoiceOwner = (typeof VOICE_OWNERS)[number];
