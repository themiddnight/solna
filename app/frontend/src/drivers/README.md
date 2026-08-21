<!-- doc-sync: codebase-reference -->

# Drivers (event-source layer)

This layer translates a room's control model into engine `NoteEvent`s:
- `live/` — perform: schedule @now. **Realized (DEV-238)** — see Code map below.
- `scheduled/` — arrange: hardware-MIDI note + sustain-pedal translation. **Slice landed (DEV-249, partial)** — see Code map below.

**Target invariant:** depend only on `engine` and `shared` — codified by the
`eslint-plugin-boundaries` allow-matrix in `app/frontend/eslint.config.js` (the `driver` element's
`allow: { to: { type: ['engine', 'shared'] } }` entry; anything not in a `from` element's
allow-list is disallowed by default). **Holds for both `live/` and `scheduled/`:** each is a pure
function with no feature imports, re-exported through its own barrel. This removed the
`driver → feature` suppression entries in
`app/frontend/eslint-suppressions.json` that used to cover `src/drivers/live/index.ts`. It
**narrows** — but does not fully close — the `scheduled/` reservation in
`docs/architecture/ROOM_ENGINE_RELAYERING_BACKLOG.md` §2 /
`docs/adr/2026-07-05-room-engine-relayering.md`: the broader DEV-249 work (unifying virtual +
hardware note capture into one audition/record path, and relocating `trackInstrumentRegistry`
out of the arrange feature) is still pending.

`scheduled/` is the arrange-side seam (the hardware-MIDI slice of DEV-249): it translates a
canonical `MidiMessage` into an engine command covering **note and sustain-pedal CC64**,
feeding arrange's MIDI-monitoring playback path. Timing (@t) is applied by the caller, not the
driver.

## Code map

- `live/midiNoteDriver.ts` — `midiMessageToLiveNote(message: MidiMessage): LiveNoteCommand | null`.
  Pure translation of a canonical `MidiMessage` (from `@/shared/midi`) into an engine
  note command (`NoteEvent`/`NoteStopEvent` from `@/engine`) to play **@now**. No audio
  side effects, no feature imports. Exported via `live/index.ts`. Consumed by
  `features/rooms/perform/hooks/usePerformMidi.ts`.
- `scheduled/midiScheduledDriver.ts` — `midiMessageToScheduledNote(message: MidiMessage): ScheduledNoteCommand | null`.
  Pure translation of a canonical `MidiMessage` (from `@/shared/midi`) into an engine command
  (`noteOn`/`noteOff` with `NoteEvent`/`NoteStopEvent` from `@/engine`, or `sustain` on/off from
  CC64). No audio side effects, no feature imports. Exported via `scheduled/index.ts`. Consumed
  by `features/rooms/arrange/hooks/playback/useMidiMonitoring.ts`.
- `live/index.ts`, `scheduled/index.ts` — barrels re-exporting each driver's public surface.
- `live/__tests__/midiNoteDriver.test.ts`, `scheduled/__tests__/midiScheduledDriver.test.ts` — unit
  tests for the two translation functions above.
