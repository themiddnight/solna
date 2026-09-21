# Task 5 report: cross-browser acceptance evidence

Status: Complete. Added a repeatable Chrome macOS and Safari macOS acceptance procedure and results matrix. Browser/device runs remain marked Pending / Not run; no audible browser pass is claimed.

The document records the Task 4 automated `node-web-audio-api` evidence separately as repository-runtime evidence: six muted-source cases, exact zero peak in the opening 100 ms, focused 138 checks and full verification with 4,595 checks. It explicitly does not call this Chromium or browser evidence.

Verification: `git diff --check` passed.

Commit subject: `docs: add audio runtime acceptance matrix`

Concerns: Chrome and Safari physical-device acceptance is still outstanding.

Document: `docs/testing/audio-runtime-acceptance.md`

## Fix round 1/5

Review finding: the previous procedure did not define repeatable fixtures; “load or create” left patch, note, level, mute state, and empty-grid setup unspecified.

Changes: replaced the open-ended setup with named `SB-LOUD-LEAD`, `SB-MUTED-STEP0`, and `SB-MUTED-EMPTY` recipes. They specify the fresh-project defaults, `Cosmic Lead` factory preset, A3 at step zero with a two-tick note length, 0.0 dB Lead fader, mute states for all other sources, 1/16 resolution, 85% gate, and arp-off state. The browser rows remain Pending / Not run.

Verification: `git diff --check` — passed (exit 0; no output).
