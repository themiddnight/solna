# Reporting bugs

Solna never sends anything on its own. There is no telemetry, no background upload and no
bundled GitHub token. A report exists only when you choose to share it.

## Automatic and manual incidents

- **Automatic:** when the audio session degrades, the app crashes while rendering, an uncaught
  error occurs, or a critical operation fails, Solna stores the latest incident locally and offers
  to report it. Expected outcomes (cancelled dialogs, validation errors, sign-in prompts, ordinary
  network failures) never raise a prompt.
- **Manual:** **Project > Report a Bug** creates a `manual` incident on demand.

Only the latest incident is kept, in this browser.

## What a report contains

Schema version, incident kind and severity, timestamp, app build, browser engine and platform,
a sanitized error message and stack, the audio health samples (at most 300), and recovery
attempts with their results, plus a short fingerprint. The runtime block includes your browser user agent string, which can narrow down your device; review it before posting.

## What it never contains

Project names, file paths, notes, chords, patterns, presets, imported content, Drive data,
tokens, store snapshots, or any stable user identifier. Error text is redacted before storage.

## Sharing

From the incident dialog you can **copy** the JSON, **share** it (where the browser supports it),
or **download** it. **Open GitHub issue** opens a prefilled form with headline facts only; the
JSON is never placed in the URL. Attach the file yourself.

**GitHub issues are public.** Open and review the file before uploading it.

## Fingerprints

The fingerprint is a short hash of the incident kind and error shape. Maintainers use it to
group duplicate reports; it does not identify you.

## Why there is no auto-submit

Anything posted to GitHub is public and permanent, and creating an issue needs credentials the
app must not carry. An explicit, reviewable step keeps you in control of what leaves your device.
