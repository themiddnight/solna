---
name: music-theory-companion
description: Use this skill when creating, updating, or auditing genre spec files for the Companion feature in the murva app. Triggers on requests like "add a genre spec for hip-hop", "update the reggae spec", "populate the companion genre docs", "fix the jazz preset", "research drum patterns for electronic", or any task involving companion-genres/ docs. This skill ensures every spec value is grounded in actual music theory research — not guessed. Always use this skill before writing or editing any file inside docs/companion/genres/.
---

# Music Theory Companion Skill

This skill produces or updates genre spec files for the Companion feature by researching actual music theory sources first, then synthesizing findings into the schema. No value may be written to a spec file without a research basis.

## When You're Invoked

You'll receive a request in one of these forms:

1. **New genre spec** — "create a spec for hip-hop", "add electronic genre"
2. **Update existing spec** — "fix the jazz timing modifiers", "add guitar-skank role to reggae"
3. **Audit existing spec** — "check if the disco spec is correct", "verify these preset values"
4. **Populate all missing genres** — "fill in all the remaining genre docs"

## Files to Read First

Before doing anything, read these two files:

1. `docs/companion/DEVELOPMENT.md` §6 — the genre spec schema format, attribute reference, and writing rules
2. `shared/src/types/companion.ts` — the actual TypeScript types in the codebase (source of truth for what attributes exist today)
3. If updating an existing spec: read `docs/companion/genres/[genre-id].md` first

---

## Research Phase (Required — Do Not Skip)

Every attribute value in a genre spec must come from research, not inference. Follow this phase before writing a single attribute.

### Step 1 — Parallel Research Queries

Run all of these searches simultaneously. Do not run them sequentially.

For a genre named `[GENRE]`, search for:

```
"[GENRE] drum pattern" music production
"[GENRE] bass guitar technique" music theory
"[GENRE] chord voicing" jazz/pop/rock (whichever applies)
"[GENRE] BPM tempo range" music
"[GENRE] swing feel" OR "[GENRE] groove pocket" rhythm
"[GENRE] half time feel" OR "[GENRE] double time feel" drums
"[GENRE] music production characteristic" sound design
```

For **drum-specific** research, also search:
```
"[GENRE] kick pattern" snare placement
"[GENRE] hi hat pattern" open hat rhythm
"[GENRE] ride cymbal" (if jazz/latin/fusion)
```

For **bass-specific** research:
```
"[GENRE] bass line" walkthrough technique
"[GENRE] slap bass" OR "walking bass" OR "808 bass" (genre-specific)
```

For **chord/harmony** research:
```
"[GENRE] chord progression" theory
"[GENRE] voicing" piano guitar keyboard
```

### Step 2 — Trusted Source Priority

When multiple sources conflict, use this priority order:

1. **Music theory textbooks / academic sources** — highest authority for harmonic rules
2. **Producer tutorials from known educators** (e.g., musictheory.net, Adam Neely, 8-bit Music Theory)
3. **Wikipedia articles on specific drum patterns** (e.g., "Amen break", "Clave", "One drop") — usually precise
4. **Music production forums** (Reddit r/WeAreTheMusicMakers, Gearslutz) — useful for consensus on production techniques
5. **General music blogs** — lowest priority, cross-check with above

### Step 3 — Build a Research Summary

Before writing any spec content, compile an internal summary in this format:

```
GENRE: [name]
BPM RANGE: [found from sources] — source: [URL or title]
FEEL: [description from research]

BEAT research findings:
- Kick: [what sources say about kick pattern]
- Snare: [placement, technique]
- Hi-hat: [density, open hat usage]
- Primary timekeeper: [hihat/ride/other]
- Swing: [exact % if found, or "moderate/heavy/none"]

BASS research findings:
- Technique: [walking/root/slap/808/etc]
- Note density: [sparse/busy]
- Characteristic techniques: [slides, octave jumps, etc]

CHORD/HARMONY research findings:
- Typical complexity: [triads/7ths/extended]
- Voicing approach: [rootless/standard/drop2]
- Rhythmic placement: [block/offbeat/syncopated/etc]

DOUBLE-TIME: [what sources say actually changes]
HALF-TIME: [what sources say actually changes]

GAPS: [things you couldn't verify — mark these]
```

Only proceed to writing the spec file once this summary exists.

---

## Synthesis Phase

Map research findings to schema attributes. Use `docs/companion/DEVELOPMENT.md` §6 as the attribute reference.

### Mapping Rules

**For `swingPercent`:**
- "No swing / straight" → 50
- "Slight groove / hip-hop" → 54–58
- "Medium swing / blues / R&B" → 60–63
- "Standard jazz swing (triplet feel)" → 65–67
- "Heavy swing / New Orleans" → 70
- Never exceed 72

**For `groovePocket`:**
- "Behind the beat / lazy / relaxed" → `laidback`
- "Locked / tight / programmed" → `on-grid`
- "Aggressive / driving / ahead" → `push`
- `laidback` requires `humanizeAmount ≥ 0.15`
- `on-grid` requires `humanizeAmount ≤ 0.05`

**For `beatStyle`:**
Map to the closest existing codebase value: `basic | hiphop | funk | jazz | reggae | latin`
If none fit, use the closest and add an implementation note explaining the gap.

**For timing modifiers (half-time / double-time):**
Must specify which *specific attributes* change and the exact from→to values. Never write "feels slower" — always write "snare moves from `on-2-4` → `on-3`".

The most common mistake in the current codebase is treating double-time as "increase hi-hat density." Research what actually changes for each role:
- **Beat:** snare/kick grid changes, not just hi-hat
- **Bass:** subdivision and note density changes
- **Chord:** comping pattern frequency changes

**For unverified attributes:**
If research didn't provide clear evidence for a value, mark it:

```
swingPercent: 55  # ? — sources conflict; value estimated
```

**For TODO attributes (not yet in codebase):**
```
primaryTimekeeping: ride  ⚠️ [TODO] — not in CompanionConfig yet, see DEVELOPMENT.md §6.5
```

---

## Output Phase

Write the genre spec file to `docs/companion/genres/[genre-id].md`.

Follow the exact template from `docs/companion/DEVELOPMENT.md` §6.6. Every section is required:
- Genre metadata header
- Roles table (system roles + future roles)
- One section per role with Lite/Groove/Full intensity levels
- Timing modifiers for each role
- Implementation notes for each role
- `musical-intent` sentence for every intensity level — written for a listener, not a programmer

Append this section at the end of every file:

```markdown
---

## Research Sources

- [source title or description] — [URL if available]
- [source title or description] — [URL if available]

*Any values marked with `?` above were not conclusively verified.*
```

---

## Audit Mode

When asked to audit an existing spec ("is this correct?", "verify the reggae spec"):

1. Read the existing spec file
2. Run the Research Phase for the same genre
3. Compare each attribute value against research findings
4. Output a diff-style audit report:

```markdown
## Audit: [genre-id].md

### Confirmed correct:
- `beatStyle: reggae` — one-drop kick on beat 3 confirmed by [source]

### Incorrect / needs update:
- `voicingStyle: standard` (Lite level) — should be `rootless` for jazz comp
  Source: [reference]

### Unverified:
- `humanizeAmount: 0.25` — no clear reference found; value seems reasonable

### Missing attributes (TODO items to implement):
- `primaryTimekeeping` not set — jazz beat MUST use ride cymbal
```

---

## Multi-Genre Mode

When asked to populate multiple or all genres at once:

1. List all genre IDs that need work: check `docs/companion/genres/` for missing or stub files
2. Research each genre in parallel — do not research sequentially
3. Write specs one at a time (to avoid context overflow)
4. After each file, state which source backed the most critical values

Priority order (highest inaccuracy in current codebase first):
1. `jazz` — ride cymbal missing, voicingStyle wrong at Lite level
2. `reggae` — guitar-skank role missing entirely
3. `hip-hop` — trap vs boom bap distinction missing, 808 behavior undefined
4. `electronic` — arp role undefined, sidechain behavior missing
5. `latin` — clave role missing, bossa vs salsa distinction absent
6. `disco` / `funk` — mostly correct, minor attribute gaps
7. `pop` / `rock` — least inaccurate, guitar-rhythm role mapping missing

---

## Quality Check Before Finishing

Before presenting any output:

- [ ] Every `musical-intent` is written in listener language (not technical jargon)
- [ ] Every timing modifier specifies attribute-level changes with from→to values
- [ ] All TODO attributes are marked with ⚠️
- [ ] `groovePocket` and `humanizeAmount` are consistent per the coupling rule
- [ ] `swingPercent` is within valid range (50–72)
- [ ] Research Sources section is populated with real sources found during research
- [ ] No attribute value appears without a corresponding research finding

If any check fails, fix it before finishing.

---

## Schema Update: chordPlayStyle (replaces rhythmStyle)

As of June 2026, the chord role uses `chordPlayStyle` instead of `rhythmStyle`. Always use `chordPlayStyle` in new or updated spec files. Do NOT write `rhythmStyle`.

**For `chordPlayStyle`:**
Map the genre's authentic chord delivery style to one of:
- `block` — all notes simultaneously (piano block, single guitar downstrum)
- `strum` — guitar sweep low→high with velocity curve and micro-timing
- `arp` — notes in sequence (broken chord, fingerpicking)
- `skank` — offbeat + staccato + muted (reggae/funk upstroke)
- `charleston` — beat 1 + and-of-2
- `offbeat` — offbeats only
- `bossa` — bossa nova clave-synced pattern
- `syncopated-push` — anticipation before the next downbeat

**Instrument-conditional playStyle (write when guitar and keys differ in a genre):**

When a genre has genuinely different authentic behavior for guitar vs. piano/keys, document both in the spec:

```
### Instrument-conditional playStyle
chordPlayStyle (piano/keys): syncopated-push
chordPlayStyle (guitar):     strum
```

The current runtime applies the profile's single `chordPlayStyle` value. Guitar variants in a spec are future design guidance until the runtime explicitly branches by instrument family.

**When to write instrument-conditional vs. single value:**
- Same behavior on both → write a single `chordPlayStyle: X` line
- Different behavior → write both variants with the `### Instrument-conditional playStyle` block
- Genres where this matters most: jazz (piano comp vs. Freddie Green strum), reggae (keyboard skank vs. guitar skank), rock (organ block vs. guitar power chord strum)
