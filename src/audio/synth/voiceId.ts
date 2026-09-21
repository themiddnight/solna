/**
 * The identity a note-on hands back, and the identity a note-off addresses.
 *
 * It exists because a source/note pair is NOT an identity: three players share
 * every melodic bus (live input, the arp, the melody-track sequencer), so
 * `${source}:${noteName}` names as many voices as happen to be sounding that
 * note — which is exactly how an arp key-up came to cut a melody track's note
 * short (docs/decisions/0017-voice-identity-and-ownership.md). A `VoiceId` names ONE
 * note-on, and nothing else can be mistaken for it.
 *
 * Branded rather than a bare `string` so a caller cannot pass a note name, a
 * source name or a preset id where a voice id is wanted: the brand is a
 * compile-time fiction with no runtime cost, and the value is still a plain
 * string at run time, which is what makes it a usable `Map` key.
 *
 * Its own leaf module, importing nothing, for the same reason `voiceOwner.ts`
 * is one: every playback bridge needs the type and none of them should widen
 * its dependency on the voice manager to get it.
 */
declare const voiceIdBrand: unique symbol;

export type VoiceId = string & { readonly [voiceIdBrand]: 'voice' };

/**
 * A counter, not a random id: an offline mixdown render runs this same code
 * and wants the same ids every time it renders the same material. Per
 * allocator rather than per module, so two managers (the live engine and a
 * throwaway render engine) never interleave their serials and a test reading
 * `voice-1` gets the first voice ITS manager made.
 */
export function createVoiceIdAllocator(prefix = 'voice'): () => VoiceId {
  let serial = 0;
  return () => {
    serial += 1;
    return `${prefix}-${serial}` as VoiceId;
  };
}
