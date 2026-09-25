# Architecture Decision Records

This folder holds the *why* behind Solna's architecture. The *what* lives elsewhere:

- `CLAUDE.md` — commands, the completion gate, the layer map and one-line cross-cutting invariants.
- `.claude/rules/<topic>.md` — normative rules for one area, loaded when a matching file is opened.
  Each rule is tagged `(R###, ADR-NNNN)` and links back here.
- `docs/decisions/NNNN-<slug>.md` — one decision each: context, decision, consequences, rejected
  alternatives and history, plus the `R###` rules it implies.

ADRs 0001-0030 were recorded retroactively from the pre-restructure `CLAUDE.md` (at `02cf1a9b`) in
DEV-425; their **Sources** sections cite line ranges in that snapshot.

## Index

| ADR | Title | Summary |
|---|---|---|
| [0001](0001-always-mounted-views.md) | Every view stays mounted; high-frequency state stays local | All layers, tabs and Pattern segments stay mounted so audio never stops; per-frame state lives in local pub/subs, never a slice. |
| [0002](0002-four-layer-import-architecture.md) | Four import layers enforced by ESLint | `data` → `audio` → `store` → `components`, each banned from importing upward; `eslint.config.js` binds. |
| [0003](0003-incidents-privacy-boundary.md) | `src/incidents/` is a privacy boundary | Bug reports are built from sanitized arguments only; no store/component/engine import; closed `IncidentReportV1` schema. |
| [0004](0004-utils-placement-and-store-constant-inversion.md) | `src/utils/` placement and the MIME-constant inversion | `utils/` sits above `data/` and may import Music Core; two files import MIME constants from `store/` as the one sanctioned inversion. |
| [0005](0005-music-core-and-tonal-confinement.md) | Music Core owns music theory; Tonal confined to one file | `tonal` only in `tonalAdapter.ts`; one chord-quality registry; intent vs derived vs playable event; no hand-rolled note regex. |
| [0006](0006-derived-degree-qualities-and-display-spelling.md) | Degree qualities are derived; spelling is display-only | `resolveDegreeQuality` derives by semitone offset with no overrides; sharp names are identities, spelled names are labels. |
| [0007](0007-chord-notes-derived-not-stored.md) | A chord's notes are derived on read | `ChordItem` stores no `notes`; every consumer calls `generateBlockChordNotes` with its own octave. |
| [0008](0008-reharmonization-category-and-roman-numerals.md) | Reharmonization by registry category; Roman numeral accidentals | Snap preserves or regenerates by `reharmonizationCategory`; Roman accidentals are relative to Major, never on the mediant. |
| [0009](0009-vibes-as-data-and-single-drum-grid-library.md) | Vibes are pure data over one drum-grid library | `VIBES` name ids only; one `DRUM_GRIDS` library; a grid replaces the whole pattern; explicit dice pools; provenance governs edits. |
| [0010](0010-beat-instrument-three-fields.md) | Beat is a per-loop instrument of three complete fields | `beatParams`/`beatPattern`/`beatMix`; complete patches installed whole; eleven voices in one canonical order. |
| [0011](0011-check-drums-non-vacuous.md) | `check:drums` asks two questions and cannot pass vacuously | Pairwise preset separation and within-kit voice separation, each with counted minimums and fail-closed checks. |
| [0012](0012-pattern-storage-and-step-layouts.md) | Fixed-width storage, three step layouts, span mechanics | Grids store at max width and window; three lane layouts; shared headless span resize; folded chord boundaries; absolute publisher step. |
| [0013](0013-melody-tracks-table-and-record-arm.md) | FX as Lead's twin via `MELODY_TRACKS`; one armed track; borrowed rows | Table-driven melody tracks; a single `recordingTrack`; key changes move every melody; out-of-scale notes borrow a row. |
| [0014](0014-atomic-loop-delete-with-undo.md) | Loop delete is atomic, seamless and undoable | One `set()` installs the fallback; the transport never stops; timed Undo toast via `restoreLoop`. |
| [0015](0015-session-only-track-solo.md) | Track solo is a session-only monitoring set | A persisted-nowhere set that beats mute, clears on layer/loop/project change but not on focus; audibility computed only in `engineSync`. |
| [0016](0016-focus-routed-note-input.md) | Input plays the focused track | Keyboard and arp play `focusTrack`'s bus and patch; bus captured at note-on; drum focus is a no-op; external MIDI always plays Lead. |
| [0017](0017-voice-identity-and-ownership.md) | Note-on returns `VoiceId`; every voice has an owner | Voices are released by id; a required `VoiceOwner` scopes bulk releases; whole-bus reach needs a method named for it. |
| [0018](0018-engine-frequency-boundary.md) | The engine takes Hz, never a note name | Controllers resolve pitch via `noteFrequency`; the engine imports only timing from `musicTheory` and nothing from `playback/` (DEV-399). |
| [0019](0019-polyphony-gain-and-voice-lifetime.md) | Dedicated polyphony gain; no lifetime timer | Equal-power scale rides its own `polyGain`; no wall-clock voice timer, with the live-input backstop and the chord-preview gap recorded. |
| [0020](0020-synth-patch-model.md) | Engine-tagged complete patches, arp beside, units in names | `ActiveSynth` with an engine tag; presets installed whole by clone; arp stored beside the patch; every field names its unit. |
| [0021](0021-shared-live-and-offline-render.md) | One synth implementation for speakers and mixdown | `createRenderEngine(ctx)` reuses the live voices; every scheduled time is an argument; no render-only copies. |
| [0022](0022-persist-write-path-and-guarded-storage.md) | Deduped, coalesced persist writes; guarded storage | Persist skips unchanged state by reference and coalesces writes to idle; `localStorage` access is always guarded. |
| [0023](0023-validation-instead-of-migration.md) | Validation replaced migration chains (with precondition) | Every read is sanitized instead of migrated while there are no real users; the lead-melody blank-payload trap (DEV-388). |
| [0024](0024-storage-zones-project-slot-autosave.md) | Four storage zones, one project slot, autosave | `localStorage`/IndexedDB slot/Drive; `{ body, source }` slot record; independent format version; continuous autosave. |
| [0025](0025-drive-token-in-closure.md) | The Google token lives only in a closure | `driveAuth.ts` holds the token; slices only mirror signed-in state; calls go through `withDriveToken`; the account (never the token) is remembered across reloads. |
| [0026](0026-clock-and-engine-bridge.md) | Clock runs iff a player subscribes; store→engine bridge | The metronome is a click, not a transport; persistent audio state reaches the engine only via `engineSync.ts`. |
| [0027](0027-planned-then-performed-playback.md) | Pure planners, four snapshots, context objects | Pure per-lane planners fed by live and offline snapshot builders; arm-time snapshot vs emit-time context (DEV-397). |
| [0028](0028-sample-based-metering.md) | Meters read samples before the dynamics | Peak/RMS dBFS from time-domain data, tapped pre-dynamics, scheduled with visibility gating, never in a slice (DEV-383). |
| [0029](0029-verify-gate-and-lint-severity.md) | `verify` gate, Knip baselines, D5 severity policy | `bun run verify` defines done; zero ESLint errors, only two rules may warn; zero Knip findings; D5 warn-then-error. |
| [0030](0030-palette-contrast-gate.md) | Palette contrast is a non-vacuous gate | `check:contrast` holds both palettes above AA in both themes and fails on a one-theme-only module colour. |
| [0031](0031-component-hook-store-selector-and-placement-conventions.md) | Component hooks, narrow store selectors, topic-grouped utils, placement | Component logic in a colocated `useXxx` hook; one value per `useAppStore` selector or `useShallow`; one theme per `utils/` file; one-area code stays with the area; every rules file ends in a `## Prohibited` checklist. |
| [0032](0032-key-change-as-loop-content-operation.md) | Key change as a loop-content operation | Pure `changeKey` in `store/keyChange.ts` runs melody and chord harmonize in one setter write, for any loop; the badge clears only on a wholesale chord replacement. |
| [0033](0033-batch-key-change-across-loops.md) | Batch key change across loops | `changeKeyAcrossLoops` plus `applyLoopKeyChange`/`undoLoopKeyChange`, each one `set()`; Set vs Transpose; a session-only, single-level, key-fields-only undo snapshot shared with the loop-delete Undo toast. |
| [0034](0034-pure-song-event-timeline.md) | Pure song event timeline | `walkSongTimeline`/`buildSongTimeline` turn a snapshot into timed events; the mixdown performs the walk incrementally (RNG order); pure chord helpers and `planBeatStep` in `plan/`; an import-graph test keeps planners off the engine. |
| [0035](0035-export-feature.md) | Export as a feature — one job, kinds as data | One session-only `exportJob`, `startExport`/`cancelExport`, a shared runner that owns capture, download and notices, `ExportKindSpec` entries in `EXPORT_KINDS`, and an `ExportDialog` the Header only opens; closing it never cancels. |
| [0036](0036-midi-export-from-song-timeline.md) | MIDI export from the song timeline | A format-1 SMF built from `walkSongTimeline`: one track per lane, GM drums on channel 10, mute honoured and solo never, note numbers from `noteMidi`. |
| [0037](0037-per-track-sends.md) | Per-track sends into the shared master effects | Each track's own Rev/Dly/Dist send nodes, post-fader, per loop; Beat reverb stays per-voice × track send, second convolver input; defaults keep audio byte-identical. |
| [0038](0038-dry-stems.md) | Dry stems: one render, bus taps, one ZIP | One multichannel offline render with a post-fader tap per bus and a detached master; a stem per track with content, zipped store-only; the mixdown golden unchanged. |
| [0039](0039-playback-host.md) | PlaybackHost — transport controllers out of the grids | One memoized PlaybackHost mounts every transport controller in clock-listener order; the chord controller split into clock and audition halves, the playing chord on a pub/sub; no react under src/audio/. |
| [0040](0040-layout-shell.md) | Layout shell and one layout-mode switch | useLayoutMode picks DesktopShell or MobileShell by width at Tailwind md; Workspace keeps the coordinators, PlaybackHost and dialogs; the Header's tools are HEADER_TOOLS rows gated by layer. |
| [0041](0041-mobile-frame.md) | Mobile frame — bottom tabs, top bar, menu sheet | Below md, MobileShell renders a four-tab bottom dock over setActiveTab, a top bar with the field tools inline and a bottom-sheet Modal holding the other HEADER_TOOLS as rows plus the project actions; the tab bar owns the bottom inset. |
| [0042](0042-flat-view-nav.md) | Flat view nav — no layer switch on desktop | The desktop Header shows all four views as two joins (loop tabs, song tabs) beside ProjectMenu, the tab implies the layer as on the phone, and no frame renders a Loop/Song switch. |
| [0043](0043-hint-text-on-desktop-only.md) | Hint text on the desktop frame only | Prose that describes or teaches a surface wears `HINT_TEXT` and is hidden below `md`; state, feedback and warnings stay on every frame. |
| [0044](0044-secondary-canvas-taxonomy.md) | Secondary-canvas taxonomy | Every overlay is one of five kinds with one primitive each (Dock, Drawer, Bottom sheet, Modal, Popup), plus quick pick and three feedback kinds (Toast, Snackbar, Banner); one fixed z-scale; feedback queues and holds its timers while a dialog is open. |
| [0045](0045-vibe-picker-preview.md) | Vibe picker with preview | Vibes open from a Header tool into a centred Modal that auditions a vibe on the current loop (stop, cut, one write, soloLoop); Use keeps it, every other exit restores a one-write snapshot; persisted writes are held and note input suspended while it is open. |
| [0046](0046-mobile-keyboard-fits-the-width.md) | The mobile keyboard fits the width | Below `md` the dock's keys share the width and never scroll, asked for by the frame: chromatic one octave, scale one octave of the scale per row, chord the chords only. |
| [0047](0047-drum-pads-take-the-beat-mix-level.md) | Drum pads take their level from the Beat mix | A pad has no level control: every pad strikes at the Beat audition velocity and its voice's level is the current loop's Beat-mix fader; the persisted `drumPadVelocities` is gone. |
| [0048](0048-input-target-link.md) | Input target link | The keys play an input target that follows the selection unless the dock's link toggle pins it (`inputTargetPin`, `null` = linked); record arm overrides the pin; the dock panel is derived from the target, so the Keyboard / Drums tabs are gone; `kbd` keycaps show only on a desktop screen. |
| [0049](0049-per-view-scroll-memory.md) | Per-view scroll memory | The frame's one scroll container remembers its position per visible view (tab, plus Pattern segment) and restores it before paint on a switch; first visit starts at the top; positions stay in the hook, never a slice. |
| [0050](0050-melody-grid-touch-gestures.md) | Pattern-grid touch gestures | One shared classifier and session rule touch on the Lead/FX matrix and the custom Chord/Bass lane: a tap edits on pointerup, a swipe scrolls and writes nothing, a long-press paints (Lead) or resizes a note or event; mouse and pen are unchanged. |
| [0051](0051-theme-picker.md) | Theme picker | The wordmark opens Settings / About; any Solna or daisyUI theme, System by default, previewed then applied; palettes follow the scheme through CSS selectors bound to a registry by test. |

## Adding or changing a decision

- **A new decision gets a new ADR.** Take the next free number, copy the template below, and add a
  row to the index. If it implies normative rules, add them to the matching `.claude/rules/` file
  tagged `(R###, ADR-NNNN)` with the next free `R###` ids, and list them under "Rules this implies".
- **An accepted ADR is never rewritten.** When a later decision replaces it, write the new ADR and
  change only the old one's Status line to `Superseded by NNNN` (linking the new file). Its context
  and decision stay as they were, so the history of why remains readable.
- Small factual corrections (a renamed file, a broken link) may be edited in place; a change to what
  was decided or why may not.
- Do not record version numbers, file counts or line numbers of live files — write the rule, and
  point at the source that binds. (Sources sections cite a pinned commit, which does not go stale.)

## Template

```markdown
# ADR-NNNN: <title>

**Status:** Proposed | Accepted — YYYY-MM-DD | Superseded by [NNNN](NNNN-<slug>.md). <issue ids>

## Context

What forces are at play: the problem, the constraints, what existed before and why it was not
good enough.

## Decision

What was decided, stated with the identifiers and paths it binds. Include rejected alternatives and
why they were rejected.

## Consequences

What becomes easier, what becomes harder, and what a future change must respect.

## Rules this implies

- **R###** — one-line normative rule (mirrored in `.claude/rules/<topic>.md`).

## Sources

Where this was recorded (issue, spec, plan, or pinned commit + path).
```
