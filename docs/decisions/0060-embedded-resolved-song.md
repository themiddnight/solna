# ADR-0060: The resolved song is written into every `.solna` file

**Status:** Accepted — 2026-10-09

## Context

[ADR-0059](0059-interop-reader-and-contract.md) gave a consumer outside this app (murva) a reader:
`readSolnaSong` resolves a `.solna` file into the `SolnaSong` of `src/interop/contract.ts`. The
consumer vendors the built bundle, and the bundle carries this app's planners and content tables.

A `.solna` body stores a chord rhythm and a bass pattern by id. Every preset added here, by the
owner or by a contributor, therefore made the consumer's vendored copy stale: a file naming the new
id read back with the default pattern until the consumer rebuilt and re-synced the bundle. The
coupling ran from this repo's content to another repo's release.

## Decision

1. `serializeProject` (`src/store/projectFile.ts`) writes the resolved song into the file text on
   every save, as the last top-level member `resolvedSong`, beside `content`. The four save paths
   (download, local file Save and Save As, Drive create and update) all go through it.
2. The body stays pretty-printed exactly as before. The embedded song is one minified line spliced
   before the final `}` (`embedSong`), so the file is still plain JSON a text editor opens.
3. `src/interop/embeddedSong.ts` is the format. It imports only `./contract`, so a consumer copies
   the two files verbatim; an ESLint guard holds that, and now holds `contract.ts` to no import at
   all. The embedded song is `SolnaSong` minus `name` and `formatVersion` (the envelope carries
   both), with every distinct synth patch stored once in a `patches` table, every distinct pass of
   a part stored once in `{ distinct, order }`, and chords, notes and drum hits as tuples.
4. One parser description (`SHAPE`) defines the format. The embedded type is derived from it,
   `packSong` assigns the contract's types into that type and `unpackSong` assigns it back, so a
   required patch leaf or an enum member that exists in `contract.ts` and not in `SHAPE`, or the
   reverse, fails to compile, here and in the consumer's copy.
5. `unpackSong` treats the embedded part as hostile input and is all-or-nothing. It answers `null`
   for another `version`, another `contractVersion`, a wrong type, a non-finite or out-of-range
   number, an index into nothing, a pass count that is not the repeat count, synth parts that are
   not exactly the synth tracks, an incomplete patch, or a song over the size caps. `null` means
   "no usable embedded song, use the full reader". It is never an error and never a partial song.
6. Trust runs one way. This app never reads `resolvedSong`: `parseProjectFile` ignores it, and
   every save resolves it again from `body.content`. A consumer may therefore take an accepted
   embedded song as what this app plays. The embedded song exists in the file text only; the
   IndexedDB slot stores the body object and never holds it.
7. A save never fails on it. If resolving or packing throws, the file is written without the
   member.
8. Nothing is version-bumped. `PROJECT_FORMAT_VERSION` stays: an older build already ignores an
   unknown top-level member ([ADR-0023](0023-validation-instead-of-migration.md)), so it keeps
   opening new files. `SOLNA_INTEROP_CONTRACT_VERSION` stays: the `SolnaSong` shape is unchanged.
   The embedded shape has its own `SOLNA_EMBEDDED_SONG_VERSION`, bumped when a reader of the
   current version could no longer read it.
9. The body-to-song walk moved out of `readSolnaSong.ts` into `src/interop/resolveSong.ts`, which
   does not import `projectFile.ts`. The file writer and `readSolnaSong` both call it. It stays in
   `src/interop/` because it produces the contract's shape and nothing else; `store/` may import
   the folder, and imports only `resolveSong.ts` and `embeddedSong.ts`, never the bundle's index.
10. `readSolnaSong` stays, as the reader for a file saved before this change and for a file whose
    embedded song a consumer's `unpackSong` refuses.

### Size caps

`unpackSong` refuses a song over any of three exported caps, so a small file cannot unpack into a
huge one. A repeat count is at most 32, the clamp `sanitizeLoops` applies on every read. The app
caps neither loops nor events, so those two are set from a real project with headroom: 1,024 loops
and 1,000,000 notes and hits. Repeats that play the same pass share one array, so unpacking
multiplies nothing before the count is taken.

### Measured

On the owner's 22-loop project (33 passes of music, 3,362 notes and 1,650 drum hits):

| | Bytes |
|---|---|
| File before (pretty-printed body) | 725,449 |
| Resolved song as plain contract JSON, minified | 429,908 |
| Embedded song, minified | 101,857 |
| Embedded song, gzipped | 9,100 |
| File after | 827,326 |

110 patch slots held 14 distinct patches (13 kB of the embedded song); 204 passes across 132
parts held 142 distinct ones. The file grew 14%.

Resolving, packing and splicing took a median 5.2 ms on top of the 1.3 ms the body's own
`JSON.stringify` takes (30 runs under Bun on the owner's machine, range 5.8 to 8.3 ms for the
whole of `serializeProject`; 20 ms on the first, cold call). The walk is about two thirds of it.
All four save paths are explicit user actions. The autosave writes the IndexedDB slot and never
calls `serializeProject`.

## Rejected

- **Storing the pattern data beside its id in `content`.** It removes the content tables from the
  consumer and nothing else: voicing, the arp, feel, pad holds and the lead's tick grid are still
  resolved by the planners, so the consumer would still carry and re-sync them.
- **gzip plus base64.** About 12 kB instead of 102 kB, but the member stops being readable JSON,
  and every consumer needs an inflate step before it can validate anything. The tables already
  remove three quarters of the plain size.
- **A separate "export for murva" action.** A file saved the ordinary way would lack the song, so
  the consumer would need the full reader for most files anyway, and the user would have to know
  which kind of file they hold.
- **Minifying the whole file.** The body alone minifies from 725 kB to 272 kB, which would more
  than pay for the embedded song. It was still rejected: it ends the promise that a `.solna` file
  reads and diffs in a text editor, and it does nothing about the stale bundle.

## Consequences

- A preset added here reaches a consumer through the next file saved, with no bundle rebuild.
- A file saved by a build without this change carries no embedded song, and a build without it
  that re-saves a newer file drops the member. Both read through the full reader.
- A file edited by hand outside the app keeps its old embedded song until the app saves it again.
  A consumer that trusts the embedded song reads the old one.
- The embedded song carries no warnings. An unknown scale or pattern id is resolved at save, by
  the build that saves, to the same fallback it plays.
- An optional field added to the contract is not a compile error in `SHAPE`; `unpackSong` drops a
  field `SHAPE` does not name. The round-trip test over `SOLNA_REFERENCE_PATCH` fails for any leaf
  the app's own patch type gains.
- `store/projectFile.ts` now depends on the export walk. The production build's store chunk grew
  7.2 kB minified (2.5 kB gzipped) and no other chunk changed size: the planners were already
  loaded with the store. `resolveSong.ts` reaches neither `projectFile.ts` nor `store.ts` through
  its imports, so the new edge closes no cycle.
- The interop bundle gains the format module and is about 233 kB unminified.

## Rules this implies

- **R368** — `serializeProject` writes the resolved song as the last top-level member
  `resolvedSong` of every `.solna` text, minified on one line after the unchanged pretty-printed
  body; a resolve or pack failure writes the file without it.
- **R369** — The app never reads `resolvedSong`: `parseProjectFile` ignores it, every save
  regenerates it from `body.content`, and it never enters `ProjectBody` or the IndexedDB slot.
- **R370** — `src/interop/embeddedSong.ts` imports only `./contract` (ESLint); `SHAPE` is the
  format's one definition, and the embedded type is derived from it.
- **R371** — `unpackSong` is all-or-nothing: `null` for anything it does not fully understand or
  that exceeds an exported size cap, never a partial song, never a throw.
- **R372** — The embedded song bumps neither `PROJECT_FORMAT_VERSION` nor
  `SOLNA_INTEROP_CONTRACT_VERSION`; a change a current reader could not read bumps
  `SOLNA_EMBEDDED_SONG_VERSION`.

## Sources

Owner decision, 2026-10-09. Measured against the owner's project file, which is not in this
repository.
