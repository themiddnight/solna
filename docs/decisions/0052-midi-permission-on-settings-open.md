# ADR-0052: MIDI permission is asked for only when MIDI settings opens

**Status:** Accepted — 2026-09-25. No issue.

## Context

`startMidiInputBridge` called `navigator.requestMIDIAccess()` at startup, from `startEngineSync`.
Chromium now asks for permission even for a request without sysex, so every first-time visitor saw a
MIDI permission prompt on page load, whether or not they own a MIDI device. The same call made
Chrome log a "Deprecated feature used" issue (`NoSysexWebMIDIWithoutPermission`) on every load.
Blink reports it once per page for any secure-context request without `sysex: true`, even when
permission is already granted (`navigator_web_midi.cc`, crbug.com/1420307). `MidiSettingsModal`
made a second, separate request to list devices, and it set `onstatechange` on its own access
object.

## Decision

- There is one `MIDIAccess` request per session: `requestMidiAccess()` in `store/midiInput.ts`,
  memoized by `createMidiAccessRequester`. It wires the input bridge on the first grant, and both
  the bridge and the MIDI settings device list use it. A rejected request (prompt dismissed or
  denied) is forgotten, so the next settings open asks again.
- At startup the bridge never prompts. `connectWhenMidiGranted` reads
  `navigator.permissions.query({ name: 'midi' })`. It connects right away only when the permission
  is already `granted`, and it connects later if the permission changes to `granted`. When the
  state is `prompt` or `denied`, or the browser cannot answer (`unknown`), it connects nothing.
- Opening MIDI settings is the only thing that raises the prompt: `useMidiInputs` calls
  `requestMidiAccess()`. A grant there also connects the bridge through the shared request, so
  input starts without a reload. The modal listens with `addEventListener('statechange')` and
  removes the listener on close, because the bridge owns `onstatechange` on the same object.

Rejected:

- **`requestMIDIAccess({ sysex: true })`** to silence the deprecation issue. It asks for the
  stronger "control and reprogram your MIDI devices" permission, and Solna only reads notes and
  CCs.
- **A connect button or a banner** asking for MIDI. MIDI settings is already the place where a
  device is chosen, so asking there needs no new UI.
- **Requesting at load when the Permissions API cannot answer.** That would bring back the
  load-time prompt in exactly the browsers we cannot check.

## Consequences

- A visitor who never opens MIDI settings never sees a MIDI prompt, and Chrome's deprecation issue
  does not appear for them. Once permission is granted, later loads connect silently, but Chrome
  still logs the issue on those loads because the request itself triggers it.
- A first-time MIDI user has to open MIDI settings once (the MIDI indicator in the transport bar)
  before a device plays. After that, the permission lasts across sessions.
- In a browser whose Permissions API cannot query `midi`, the bridge connects only after MIDI
  settings is opened, in every session.

## Rules this implies

- **R350** — only a MIDI settings open, or a permission already `granted`, calls
  `requestMidiAccess()`; nothing requests MIDI at load, and there is one shared request
  (`note-input.md`).

## Sources

Branch `fix/web-midi-permission-notice`; Chromium
`third_party/blink/renderer/modules/webmidi/navigator_web_midi.cc` (the `sysex` branch of
`requestMIDIAccess`).
