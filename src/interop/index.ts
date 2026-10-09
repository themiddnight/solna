/**
 * The interop bundle's public surface (`bun run build:interop`): everything a
 * consumer outside this app may call. Nothing inside the app imports this
 * folder — it is a second entry point beside `src/main.tsx`.
 */
import type { SolnaSynthPatch } from './contract';
import { SOLNA_REFERENCE_PATCH as REFERENCE_PATCH } from './referencePatch';

export { SOLNA_INTEROP_CONTRACT_VERSION } from './contract';
export type * from './contract';
export { SOLNA_DRUM_VOICES, readSolnaSong } from './readSolnaSong';

/** `referencePatch.ts`'s patch, published under the contract's own type. */
export const SOLNA_REFERENCE_PATCH: SolnaSynthPatch = REFERENCE_PATCH;
