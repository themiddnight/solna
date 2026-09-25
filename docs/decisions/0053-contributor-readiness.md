# ADR-0053: Contributor readiness: CI, licence and trademark, content checks

**Status:** Accepted — 2026-09-25. DEV-381.

## Context

The repo had a strong local gate (`bun run verify`) and nothing that ran it for anyone else: no CI,
no README, no contribution guide and no licence. Without a licence the code is "all rights reserved"
by default, so nobody could legally contribute or fork it. The data-layer extraction made
factory content a bounded edit in `src/data/`, which is the surface an outside contributor is most
likely to touch.

Running `verify` on Linux x64 for the first time found one failure: the DEV-420 mixdown golden
compares a sha256 of rendered WAV bytes, and `node-web-audio-api`'s float output differs by OS and
CPU. The platform-independent call-log golden matched. This is the variance the DEV-420 spec
recorded as risk R2, which assumed the golden would only ever run on the machine that recorded it.

## Decision

- **CI.** `.github/workflows/ci.yml` runs `bun install --frozen-lockfile` and `bun run verify` on
  every pull request and every push to `main`. The workflow runs the whole gate as one step, so
  local and CI answers cannot drift. The Bun version is read from `packageManager` in
  `package.json`.
- **Per-platform WAV golden.** `renderMixdownGolden.wav.sha256` holds one `<sha256> <platform>` line
  per platform the golden has been recorded on, and a render passes when it matches any of them. A
  new platform's line is recorded only when that platform's call log already matches, in a commit
  that changes nothing else.
- **Licence: Apache-2.0 for the code, trademarks kept.** The owner does not want to restrict the
  code, only the brand. Apache-2.0 section 6 grants no trademark rights, and section 5 licenses
  contributions under the same terms, so no CLA is needed. `NOTICE` and `TRADEMARKS.md` name the
  reserved marks: **Solna**, **murva**, and the image files under `public/assets/`. A fork may say
  it is based on Solna, but a published fork uses its own name and icons.
- **Content checks are tests, not a new script.** The DEV-381 card asked for a `check:presets`
  script inside `verify`. Almost every rule it listed already had a test (id uniqueness, cross-table
  references, drum-row shape and meter, preset completeness), spread across `src/data/`,
  `src/audio/` and `src/store/`. A second script would duplicate those rules and run them twice
  inside `verify`. The missing generic rules (non-empty fields, unique names across the three comp
  libraries) were added as `src/data/libraryEntries.test.ts`. `bun run check:content` runs the
  content tests, `check:drums` and `check:levels` for fast contributor feedback. It is not part of
  `verify`, because `bun test` already covers it. The card's "seven rows × 16 steps" rule was out
  of date: rows are optional, there are eleven voices, and 3/4 and 6/8 grids are 12 steps.
- **Test isolation across files.** The first CI run also showed the suite depended on local file
  order. `bun test` runs every file in one process, in filesystem order. Three leaks surfaced:
  - Five store tests left `window = globalThis` behind, so axe-core, loaded through
    `eslint-plugin-jsx-a11y`, crashed on import in every later ESLint-API test.
  - `mixdownSnapshot.test.ts` left a drum solo in the shared store, and solo outranks mute.
  - `leadRecord.test.ts` trusted the lead step resolution left by the previous file.

  Each of these tests now cleans up after itself or sets what it relies on. The suite was re-run
  green in reverse and in shuffled file orders.
- **Taste is reviewed, not gated.** `CONTRIBUTING.md` defines a listening review: the maintainer
  auditions each content addition against the pull-request template's description before merge.
- **One contributor document.** `CONTRIBUTING.md` holds the how-to for each content type.
  `CLAUDE.md` points at it and does not duplicate it.

Rejected: PolyForm Strict or another no-derivatives licence, because it conflicts with accepting
contributions and would need a CLA. AGPL-3.0, because the owner does not want to restrict how the
code is reused. Apache-2.0 was preferred over MIT for its explicit trademark and patent clauses.

## Consequences

- A red `verify` on any platform CI runs is a real failure. A golden that depends on the platform
  must say so and record one value per platform.
- Changing how a content type is added, including a new required field, a pinned id list or a
  calibration step, means updating `CONTRIBUTING.md` in the same change.
- Before a fork deploys, it must replace every brand asset listed in `TRADEMARKS.md`.

## Rules this implies

- **R351** — CI runs `bun run verify` as one step on every pull request and push to `main`; the gate
  changes in `package.json`, never by running a subset in the workflow.
- **R352** — A platform-dependent golden records one value per platform; a new platform's value is
  added only when its platform-independent evidence matches, in a commit that changes nothing else.
- **R353** — A content-table invariant is a test, not a separate `check:*` script; `check:content`
  is a fast subset for contributors and stays out of `verify`.
- **R354** — The code is Apache-2.0; the Solna and murva names and the images under
  `public/assets/` are trademarks outside the licence (`NOTICE`, `TRADEMARKS.md`).
- **R355** — `CONTRIBUTING.md` is the contributor guide; `CLAUDE.md` points at it, and a change to how
  a content type is added updates it in the same change.

- **R356** — `bun test` has no fixed file order: a test file removes the globals it installs and
  restores the shared store state it changes, and sets the state it depends on itself.

## Sources

Linear DEV-381. Owner decisions from the DEV-381 discussion on 2026-09-25: Apache-2.0 with the brand
reserved, and murva included. DEV-420 spec risk R2
(`docs/superpowers/specs/2026-09-22-dev-420-song-event-timeline-design.md`).
