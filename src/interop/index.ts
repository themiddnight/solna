/**
 * The interop bundle's public surface (`bun run build:interop`): everything a
 * consumer outside this app may call. It is a second entry point beside
 * `src/main.tsx`, and nothing in the app imports this index.
 *
 * The app does import two modules of the folder directly, from
 * `@/store/projectFile`: `resolveSong.ts` and `embeddedSong.ts`, to write the
 * resolved song into every file it saves.
 */
import type { SolnaSynthPatch } from './contract';
import { SOLNA_REFERENCE_PATCH as REFERENCE_PATCH } from './referencePatch';

export { SOLNA_INTEROP_CONTRACT_VERSION } from './contract';
export type * from './contract';
export {
  SOLNA_EMBEDDED_MAX_EVENTS,
  SOLNA_EMBEDDED_MAX_LOOPS,
  SOLNA_EMBEDDED_MAX_REPEAT_COUNT,
  SOLNA_EMBEDDED_SONG_KEY,
  SOLNA_EMBEDDED_SONG_VERSION,
  packSong,
  readEmbeddedSong,
  unpackSong,
} from './embeddedSong';
export type { SolnaEmbeddedSong } from './embeddedSong';
export { readSolnaSong } from './readSolnaSong';
export { SOLNA_DRUM_VOICES } from './resolveSong';

/** `referencePatch.ts`'s patch, published under the contract's own type. */
export const SOLNA_REFERENCE_PATCH: SolnaSynthPatch = REFERENCE_PATCH;
