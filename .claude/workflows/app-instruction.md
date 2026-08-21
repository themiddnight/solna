---
description: the guideline for using the app — for Playwright / AI agents to understand how to navigate and interact with the application
---

### Notes
- Ignore errors related to device permissions or anything concerning HTTP/HTTPS or audio fetching. Since we are running on HTTP, Backblaze might reject some requests. Focus on ensuring the core functionality of the app works correctly.
- This document is a usage narrative for explaining flows/content and serves as a base for marketing content (e.g., landing page). It is NOT the source of truth for business or technical rules.
- If content here conflicts with the main rules, always follow `docs/RULES_AND_CONSTRAINTS.md`.
- This document should be updated after behaviors and tests have been validated.

# App Usage Guide

## 1. Access & Authentication

- **URL**: `http://localhost:5173`
- If not logged in, use these credentials:
  - **Email User 1**: `the.midnight.k.0173@gmail.com` (middnight)
  - **Email User 2**: `ake.pathompong@gmail.com` (Marone)
  - **Email User 3**: `themiddnight.dev@gmail.com` (Mushroom)
  - **Password**: `@1William`
- The app also supports **guest mode** — some features (Profile, Community) are not available without login.
- Other auth routes: Login (`/login`), Register (`/register`), OAuth callback (`/auth/callback`), Verify Email (`/verify-email`), Reset Password (`/reset-password`). **Forgot Password is a modal** opened from the Login page (not a route).
- **Google OAuth** uses a one-time code-exchange flow: the provider redirects to `/auth/callback?code=...`, the app exchanges the single-use code for an access token, and the refresh token is delivered via an HttpOnly cookie (DEV-187/197).

---

## 2. Navigation (Navbar)

The top navbar contains:
- **Left side**: Navigation links
  - **Lobby** (`/`) — room list and room creation (always available)
  - **Profile** (`/profile`) — personal dashboard (requires login)
  - **Community** (`/community`) — browse public projects (requires a **verified** account; gated by `isUserRestricted()` with a "Verified account required" tooltip)
- **Right side**: Account management button (login/register or user menu with Account Settings / Logout)

---

## 3. Lobby (Home Page — `/`)

The lobby shows a list of active rooms that can be joined, plus quick access to user projects and community projects.

**Creating a Room:**
1. In the **"Create Room"** section (left side), choose one of two cards:
   - **"Create Perform Room"** card — real-time live jamming session room (instruments, voice chat, step sequencer)
   - **"Create Arrange Room"** card — real-time collaborative DAW room (multi-track timeline, recording, piano roll)
2. Click the desired card — a create room modal appears with:
   - **Room type pre-selected** (locked based on which card you clicked)
   - **Header image** showing the room type
   - **Modal title** matching the room type (e.g., "Create Perform Room")
3. Fill in the **room name** (required) — can use the dice button to generate random name.
4. Optionally add a **description**.
5. Optionally configure:
   - **Private** — requires approval for band members to join (restricted for unverified accounts)
   - **Hidden** — room won't appear in public list, invite-only (restricted for unverified accounts)
6. Click **"Create Room"** to proceed — you will be redirected to the room.

**Opening a Project:**
- In the **"Continue Your Projects"** or **"Discover & Contribute"** sections, click a project card.
- The app will check if an active room exists for that project:
  - If yes → join the existing room
  - If no → create a new room and load the project automatically

**Joining a Room:**
- In the **"Available Rooms"** section (right side), click on an existing room card in the list.
- Private rooms require approval from the room owner. After sending a join request:
  - The requester sees a waiting state and can **cancel the request** at any time while waiting
  - If the owner does not respond within **10 minutes**, the request is automatically rejected
  - Owner sees a pending request indicator and can approve or reject

---

## 4. Perform Room (`/perform/:roomId`) — Live Jamming

A real-time jam session room where multiple users play virtual instruments together. Maximum capacity: **10 users**.

### Layout — Desktop

**Header / Top Bar:**
- **Room name & settings** — room info, invite link copy, room settings button.
- **Move to Arrange Room** button — switch entire room to Arrange mode (owner only). When pressed, a Follow/Stay modal appears for members with a **30-second countdown** — after 30 seconds, auto-dismisses with default "Stay" if no response.
- **Recording button** — start/stop session recording (see Section 6 for what is recorded). Requires a **verified** account — disabled for guests and unverified registered users (`isUserRestricted()`)
- **Pending member requests** indicator (owner only, for private rooms)

**Instrument Controls Row (below header):**
- **Voice chat toggle** (WebRTC) — ultra-low latency peer-to-peer voice. Click the microphone icon to open advanced settings (see Section 4g)
- **Time Signature control** — room-owner-only control for numerator 2–12 and denominator 4/8. It syncs across users and updates companion beat alignment using the shared quarter-note beat-space helpers.
- **BPM control** — sets room-wide tempo (synced to all users). Owner and band members can edit; audience is view-only
- **Scale key slots** — up to 5 preset slots (hotkeys `1`–`5`) for quick scale switching
- **Room scale selector** — root note + scale type (see Section 4b for all scales). Owner sets it for the room; members can follow or use their own
- **Follow room owner toggle** — when ON, member's scale syncs to owner's changes; when OFF, member uses their own independent scale (slot controls hidden while following)
- **Instrument selector** — choose current virtual instrument (see Section 4a)
- **Metronome toggle** — synchronized metronome with visual beat indicator. Expand for: **volume slider** (personal, not synced), **mute button**, and **tap tempo** (tap the button repeatedly to set BPM from feel — calculates average over up to 8 taps)
- **Shadow Capture toggle** — rolling 30-second audio buffer for retroactive recording; save button appears when active (see Section 4f)
- **Practice Mode toggle** — switch between "Live" (broadcast to room) and "Practice" (play locally only, not heard by others)
- **Broadcast button** (owner only) — start/stop an HLS live stream of the session to the Audience Room (`/perform/:roomId/audience`)
- **Connection status indicator** — colored dot (green/yellow/red) with latency ping in milliseconds

**Step Sequencer (middle section):** — see Section 4c

**Virtual Instrument Interface (below sequencer):** — see Section 4a

**Audio Effect Chain (below instrument):** — see Section 4d

**Right Sidebar:**
- **Sidebar Tab System** — The sidebar utilizes a tabbed navigation system. By default, it opens the **"Performers"** tab (showing the room member list). Users must switch tabs to access other panels:
  - **Performers tab** (`sidebar-tab-performers`): Shows all connected members with status indicators and per-user volume faders.
  - **Companions tab** (`sidebar-tab-companions`): Access the **Band Companion panel** for AI companion management (see Section 4h).
  - **Chat tab** (`sidebar-tab-chat`): Access the **Chat box** for real-time text communication.

### Layout — Mobile

Tab-based dock navigation at the bottom with 5 tabs:
- **Tools** — BPM, scale, voice chat, recording controls
- **Sequencer** — step sequencer grid
- **Input** — virtual instrument interface
- **Effects** — effect chain
- **Sidebar** — member list, Band Companion panel, and chat

---

## 4a. Virtual Instruments

Five instrument types are available. All instruments support external MIDI controllers (Chrome / Edge / Brave only).

**Shared base controls (all instruments unless noted):**

| Control | Key | Notes |
|---------|-----|-------|
| Velocity | `-` / `+` | 10-step scale |
| Octave | `Z` / `X` | Not available in Guitar/Bass Basic |
| Sustain (momentary) | `Space` | Hold to sustain |
| Sustain (toggle) | `\` | Locks sustain on/off |
| Sharp modifier | `Shift` | Transpose all notes +1 semitone while held |

---

### Keyboard

**4 modes** selectable from the mode bar:

**Basic** — Full chromatic piano layout. Standard piano key arrangement, all 12 notes per octave available.

Key mapping:
```
Black keys: W E   T Y U   O P
White keys: A S D F G H J K L ; '
```

**Melody** — Scale-constrained layout. Only notes within the selected scale are shown, split into two rows:
- Upper row (`QWER…`): notes from the octave above
- Lower row (`ASDF…`): notes from the current octave
- Impossible to play wrong notes — every key is always in scale.

**Chord** — One button per scale degree (I–VII). Pressing a key plays a full triad. Chord quality (major/minor/diminished) is automatically determined by scale position. Hold modifier keys while pressing a chord key to modify it:

| Modifier | Key | Suffix shown |
|----------|-----|-------------|
| Add 6 | `Q` | `6` |
| Dominant 7 | `W` | `7` |
| Major 7 | `E` | `M7` |
| Add 9 | `R` | `add9` |
| Sus2 | `A` | `sus2` |
| Sus4 | `S` | `sus4` |
| Maj/Min toggle | `D` | `m` (in major) / `M` (in minor) |

Active modifiers display as a suffix on each chord button (e.g., `Am`, `Csus2+7`). Sus2 and Sus4 are mutually exclusive (sus2 wins). Dominant 7 and Major 7 are mutually exclusive (dominant 7 wins).

Additional chord controls:
- **Chord voicing**: `C` / `V` (changes inversion/spread of the chord)
- **Arpeggio speed**: `N` / `M` (how quickly the triad notes play in sequence)
- **Root notes row**: separate row of keys for playing individual root notes only

**Hybrid** — Split layout combining Chord (left panel) and Melody (right panel) in one screen:
- Left panel: 7 triad chord keys + 8 root note keys + clickable chord modifier buttons
- Right panel: two rows of melody notes (upper `UIOP[` / lower `JKL;'`)
- **Root Octave**: `Z` / `X` (controls chord/root octave)
- **Melody Octave**: `,` / `.` (controls melody row octave)
- **Arpeggio speed**: `N` / `M`

---

### Guitar

**4 modes:**

**Basic** — 6-string fretboard visualization with chromatic note mapping. Frets are clickable.

**Melody** — 2 virtual strings, each mapped to scale notes with 4th-interval spacing:
- **Higher string** (`QWERTYUIOP[]`): notes starting a 4th above the lower string
- **Lower string** (`ASDFGHJKL;'`): notes starting from the root of the current octave
- **Pick Down**: `,` — normal velocity
- **Pick Up**: `.` — 1.25× velocity (lighter, like an upstroke)
- **Hammer-on / Pull-off**: play a different note on the same string within 200ms of the last pick — triggers at 0.8× velocity (hammer-on) or 0.7× velocity (pull-off) without a new pick event. Notes can chain.

**Chord** — 7 scale-degree chord keys (`A`–`G`). Same chord modifier system as Keyboard Chord, with guitar-specific key assignments:
- `Q`=Add6, `W`=Dom7, `E`=Maj7, `R`=Add9, `T`=Sus2, `Y`=Sus4, `U`=Maj/Min toggle
- **Power Chord toggle**: `\` — plays root+5th (no third)
- **Strum Down**: `.` — normal velocity
- **Strum Up**: `,` — 1.5× velocity
- **Brushing speed**: `N` / `M` (strum arpeggio timing)
- **Chord voicing**: `C` / `V`

**Hybrid** — Same hybrid split layout as Keyboard Hybrid, shared component.

---

### Bass

**2 modes:**

**Basic** — 4-string bass fretboard (standard tuning: E, A, D, G). Frets are clickable. Sustain controls active.

**Melody** — 2 virtual strings with 4th-interval layout matching Guitar Melody:
- **Higher string** (`QWERTYUIOP[]`): 4th above lower string
- **Lower string** (`ASDFGHJKL;'`): root of current octave
- **Pick Up**: `,` — 1.5× velocity
- **Pick Down**: `.` — normal velocity
- **Hammer-on / Pull-off**: same 200ms window behavior as Guitar Melody
- **Always Root toggle** (`\`): when ON, both rows play the chord root notes locked to bass frequency range (E1–D#3) instead of scale degrees — aligns bass with Guitar Chord mode so the bass always grounds the harmonic center.

Octave control (`Z`/`X`) available in Melody mode. Sharp modifier (`Shift`) works in both modes.

---

### Drum Pad

**16 pads** split into two groups of 8, mapped to General MIDI percussion:

| Group | Top Row | Bottom Row |
|-------|---------|------------|
| A | `Q W E R` | `A S D F` |
| B | `U I O P` | `J K L ;` |

**3 pages** covering different GM note ranges (Z = previous page, X = next page). Each pad displays both the GM note name (e.g., `C1`) and the percussion label (e.g., `SNARE`, `CL HH`). Total: 48 pads across 3 pages.

Additional controls:
- **Velocity slider**: 1–10 scale (applies to all pads)
- **Edit Volumes mode**: toggle to show per-pad volume sliders (independent from velocity)
- **Reset Volumes**: resets all per-pad volumes to 100%
- **Preset manager**: save, load, and manage pad configuration presets. Built-in default drum presets included.

---

### Synthesizer

Selecting Synthesizer replaces the instrument interface with a synth parameter panel. Notes are triggered by the Step Sequencer or an external MIDI controller.

**4 synth types:**

| Type | Label | Polyphony |
|------|-------|-----------|
| `analog_mono` | Analog Mono Synth | Monophonic |
| `analog_poly` | Analog Poly Synth | Polyphonic |
| `fm_mono` | FM Mono Synth | Monophonic |
| `fm_poly` | FM Poly Synth | Polyphonic |

**Analog Synth controls:**
- **Oscillator**: waveform selector (Sine, Square, Sawtooth, Fat Sawtooth, Triangle), Volume knob
- **Portamento** (mono only): glide time between notes
- **Filter**: Frequency and Resonance knobs
- **Amp Envelope**: Attack, Decay, Sustain, Release (ADSR)
- **Filter Envelope**: Attack, Decay, Sustain, Release (ADSR)

**FM Synth controls:**
- **Modulation**: Modulation Index, Harmonicity knobs, Volume
- **Amp Envelope**: ADSR
- **Modulation Envelope**: ADSR

**LFO (all synth types):**
- **Target**: Pitch (mono synths only) or Filter
- **Waveform**: Sine, Triangle, Square, Sawtooth
- **Rate**: free Hz or BPM-synced subdivisions (1 Bar, 2 Bars, 1/1, 1/2, 1/2 Dotted, 1/2 Triplet, 1/4, 1/4 Dotted, 1/4 Triplet, 1/8, 1/8 Dotted, 1/8 Triplet, 1/16, 1/16 Triplet, 1/32)
- **Amount**: depth knob
- **Sync toggle**: link LFO rate to room BPM

**Arpeggiator** (mono synths only):
- **Mode**: Up, Down, Up/Down, Down/Up, Random
- **Subdivision**: same BPM-synced options as LFO (down to 1/32 Triplet)
- **Octave Range**: 1, 2, or 3 octaves
- **Gate**: note length within each step
- **Latch**: hold the pattern playing hands-free after releasing keys

**Preset Manager**: save, load, import, and export presets per synth type. 8 built-in default presets: Analog Bass, Analog Lead, Analog Pad, Analog Pluck, FM Bell, FM Bass, FM Lead, FM Electric Piano.

---

### Instrument Swap

Any band member can initiate an **instrument swap** with another member in the same room:
1. Request a swap by selecting the target member and requesting to trade instruments
2. The target member receives a swap request and must **approve or reject**
3. If approved, both members instantly exchange: instrument type, instrument category, synth parameters (if synthesizer), and sequencer state
4. Swap is atomic — both sides change simultaneously, or neither does

---

## 4b. Scale System

The room has a shared scale (root note + scale type) set by the owner. Members can follow the owner's scale or use their own independently.

**Hum-to-Find Scale** — Sing or hum into the microphone; the system automatically detects the best matching key and scale. Audio input device selector and always-on level meter are provided.

**32 supported scale types across 6 categories:**

| Category | Scales |
|----------|--------|
| **Diatonic** | Major, Minor (Natural), Harmonic Minor, Melodic Minor, Harmonic Major |
| **Modes** | Dorian, Phrygian, Lydian, Mixolydian, Locrian, Dorian ♭2, Lydian Dominant, Lydian Augmented, Mixolydian ♭6, Locrian ♯2, Phrygian Dominant |
| **Pentatonic** | Major Pentatonic, Minor Pentatonic, Egyptian |
| **Blues** | Major Blues, Minor Blues |
| **World** | Hirajoshi (Japanese), Pelog (Indonesian), Vietnamese, Double Harmonic Major, Hungarian Minor, Flamenco |
| **Jazz & Other** | Bebop (Dominant), Bebop Major, Bebop Minor, Whole Tone, Diminished |

Powered by [Tonal.js](https://github.com/tonaljs/tonal) for accurate music theory calculations.

**Chord quality rules by scale degree (auto-applied in Chord mode):**

| Scale | I | ii | iii | IV | V | vi | vii° |
|-------|---|----|-----|----|---|----|------|
| Major | Major | minor | minor | Major | Major | minor | dim |
| Minor | minor | dim | Major | minor | minor | Major | Major |

Non-standard scales (pentatonic, blues, world) use their parent diatonic scale for chord generation.

---

## 4c. Step Sequencer

A grid-based pattern sequencer synced to the room BPM and metronome. Pattern length is shown in bars and converted through shared sequencer-safe time-signature helpers so compound meters keep integer step lengths.

**Grid controls:**
- Click or drag cells to toggle steps on or off
- **Pattern length**: 1–32 steps
- **Step speed (Beat Length)**: controls how fast each step plays — options: 1/16, 1/8, 1/4, 1/2, 1, 2, 4, 8, 16 beats per step (default: 1/4)
- **Velocity per step**: 10-step scale per cell
- **Gate per step**: 10-step scale; 100% = legato (notes blend into each other)

**Banks:**
- 4 banks: **A, B, C, D** (keyboard shortcuts: `6`=A, `7`=B, `8`=C, `9`=D)
- **Loop Mode — Single**: loops the active bank continuously
- **Loop Mode — Continuous**: plays banks in sequence (A → B → C → D → A…), skipping disabled banks

**Scale view modes:**
- **All Notes**: show all chromatic notes (C, C#, D, D#…)
- **Scale Notes**: show only in-scale notes + any out-of-scale notes that already have steps
- **Drum Mode**: General MIDI percussion mapping, not affected by scale

Out-of-scale notes are visually dimmed with a warning indicator.

**AI Pattern Generation**: a purple "AI" button opens a prompt box — describe a style or feel and AI generates an initial pattern for the current instrument (drum beat or melodic), informed by the room's BPM, scale, and loop length. Available in both Perform Room and Arrange Room. Requires AI features enabled in Account Settings.

**Preset Manager**: save and load sequencer pattern presets. Built-in default drum and melodic presets included.

Performance: the grid is rendered via Konva (Canvas) for performance with large step counts, and timing runs in a Web Worker for stable rhythm independent of UI load.

---

## 4d. Audio Effect Chain

Two separate effect destinations:
1. **Instrument output** — effects applied to the virtual instrument's audio
2. **Voice input** — effects applied to your microphone/voice

**16 available effects** (in default signal chain order):

| Effect | Description |
|--------|-------------|
| Compressor | Dynamic range control |
| Graphic EQ | Multi-band equalizer |
| Distortion | Clipping/overdrive |
| Bitcrusher | Lo-fi bit reduction |
| AutoFilter | LFO-modulated filter sweep |
| AutoWah | Envelope-following wah filter |
| Filter | Static low/high/band-pass filter |
| Phaser | Phase-shifting modulation |
| Chorus | Pitch-detuned doubling |
| Tremolo | LFO-modulated amplitude |
| Vibrato | LFO-modulated pitch |
| Auto Panner | LFO-modulated L/R panning |
| Stereo Widener | Haas-effect stereo width expansion |
| Delay | Tempo-syncable echo |
| Ping Pong Delay | Stereo alternating echo |
| Reverb | Room/hall ambience |

Each effect has parameter knobs/sliders (e.g., Dry/Wet, Frequency, Depth). Effects can be added, reordered, and removed from the chain.

Audio routing uses Tone's native `Channel.volume`/`Channel.pan` as the live volume/pan stage (`channelCount: 2` explicitly set, so the panner stays in true stereo mode) that preserves stereo signals from effects like Ping Pong Delay, Auto Panner, and Stereo Widener (no mono downmix on panning).

---

## 4e. Room Member Status Panel

Real-time status indicators visible to all users in the right sidebar:

- **Instrument name** — each member's currently selected instrument
- **Mic mute icon** — appears instantly when a member mutes their voice (🔇)
- **Practice badge** — "Practice" label shown when a member is in practice mode (playing locally only)
- **Shadow Capture indicator** — recording icon shown when a member has shadow capture active
- **Reconnecting** — greyed-out card with "Reconnecting" label during a grace period; restores automatically on rejoin

**Per-user volume fader** — adjust how loud each member's instrument sounds to you (local mix only, does not affect others).

**Reset All Volumes** button — resets all per-user volume faders to 0 dB.

---

## 4f. Shadow Capture

A rolling 30-second audio buffer that continuously records your instrument output. Never miss a good improvised moment:
1. Toggle Shadow Capture on (button in the header controls)
2. Play freely
3. When you want to save something you just played, click **Save** — it exports the last 30 seconds as a WAV file
4. Toggle off when done

Shadow capture is powered by AudioWorklet (zero main thread blocking). Your capture status is visible to other room members via the status panel.

---

## 4g. Voice Chat Settings

Click the microphone icon to expand advanced voice chat options (WebRTC peer-to-peer):

| Setting | Description |
|---------|-------------|
| **Input device** | Choose which microphone to use |
| **Gain** | Manual input gain control (disabled when Auto Gain is on) |
| **Clean Mode** | Ultra-low latency mode — disables all audio processing for the purest signal. Recommended for singing or playing acoustic instruments near the mic |
| **Self-Monitor** | Hear your own voice while speaking (useful for checking mix) |
| **Performance Mode** | When muted, stops receiving remote audio (reduces CPU); "Normal" mode keeps remote audio active while muted |
| **Voice Mesh** | Shows count of connected peers; includes a **Retry** button if connections are missing |

---

## 4h. Band Companion (AI Companions)

Virtual musicians that play automatically alongside room members, driven by the server. Located in the right sidebar under the **"Companions" tab**, visible to all roles but manageable only by room owner and band members (not audience).

**Panel-level controls:**
- **Add Companion** button — creates a new companion with default settings (max 5 companions per room). Disabled for audience.
- **Play All / Stop All** toggle — starts or stops playback for all companions simultaneously. Appears only when at least one companion exists.
- **Genre × Intensity preset system** — a one-touch way to style all companions at once:
  - **Genre selector** (6 options with emoji): Pop ✨, Hip-Hop 🎤, R&B 🎹, Lo-Fi 📻, Bossa Nova 🎸, Jazz 🎷. A "Mixed" badge appears when companions don't all share the same genre.
  - **Intensity** — 3-step segmented control: `1 - Lite`, `2 - Groove`, `3 - Full`. A "Mixed" badge appears when intensities differ.
  - Picking a genre + intensity applies a research-backed profile to each companion's advanced harmony/rhythm fields (complexity, voicing, comping style, bass pattern, swing, groove, fills, density). The chosen genre/intensity is stored on each companion and restored on rejoin.
- **Chord Display & Beat Counter** — shows the current chord, next chord, and a countdown beat bar for how many beats remain before the chord changes. Appears when at least one companion exists. **Harmony badges** annotate passing chords: a `V7 → <chord>` badge for secondary dominants and a `Borrowed ✦` badge for borrowed chords (falls back to a "Diatonic harmony" label otherwise). **Note**: The chord progression display and beat lights will only render in the DOM and animate when music/companions playback is actively running (`isAnyPlaying === true`).
- **Chord progression — Auto / Manual** (room-global, shared by all companions; non-audience only):
  - **Auto / Manual mode toggle**. In **Auto** mode an inline **chord-length** selector (½ / 1 / 2 / 4 bars) is shown; the server runs a deterministic Markov-chain progression driven by the room scale.
  - In **Manual** mode the inline selector is replaced by a single **"Manual Setup"** button that opens the **Manual Progression modal** (degree-based Roman-numeral editor): a diatonic palette (I–VII labelled in the current key), a collapsible **borrowed-chord catalog** (modal-interchange chords, key-relative), click-to-select step cards (**drag to reorder**) with per-step **duration** (½/1/2/4 bars) and **tension modifiers** (the 8 chord modifiers — dom7/maj7/sus2/sus4/6/add9/maj-min/power), a **chord preview 🔈** (plays the chord locally on acoustic piano, never broadcast), 4 starter presets (Pop axis / classic cadence / doo-wop / ii–V–I), and a loop-length indicator. Edits are local-draft → **Apply** broadcasts the whole progression once; **Cancel/close** restores the snapshot.
  - **Room-global exclusive editing lock**: opening Manual Setup acquires a single room-level lock (TTL 30s, refreshed by a ~15s heartbeat while open). Other members see the toggle + button disabled with the holder's `LockBadge`. The lock is advisory (UI only) — progression writes still apply under the per-room mutex regardless of lock ownership.
  - Because steps are stored as **scale degrees** (not absolute names), the progression auto-transposes when the room key/scale changes (degree I = "C" in C major, "G" in G major).
- **Harmonic Flavor selector** (room-global, non-audience only) — `Diatonic` / `Borrowed (parallel-minor interchange)` / `Secondary Dominant (V7)`. Sets the harmony all companions resolve to in **Auto** mode (ignored in Manual mode). The global **genre + intensity** picker also sets this flavor from the resolved (genre, intensity) pair, so different intensities of the same genre can flip the flavor (e.g. Pop Groove→Full flips diatonic→borrowed).

**Per-companion card** (one card per companion):

| Control | Description |
|---------|-------------|
| **Instrument selector** | Choose from all General MIDI soundfont instruments, synthesizers (Analog/FM Mono/Poly), and drum machines. The companion's **role** (bass / chord / beat) is automatically derived from the selected instrument. |
| **Play / Stop** | Toggle individual companion playback. |
| **Mute** | Silence this companion locally for all users (state is synced to the room). |
| **Volume fader** | Per-companion output gain in dB (-60..+12, unity = 0, default -3.1), applied as a mixer channel fader. Separate from Mute. |
| **Remove** | Remove the companion (button inside the settings popup). |

**Collaborative locking**: each individual control (Style, Complexity, Voicing, etc.) is lockable — while one user is editing a control, other users see a lock badge such as "X is editing Style" and the control is disabled for them.

**Manual Advanced Controls** (collapsible accordion inside each companion's settings popup):

*Style & timing*

| Control | Role | Options |
|---------|------|---------|
| **Style** | Bass | `Root Only` / `Root & Fifth` / `Walking Bass` |
| **Style** | Chord | `Block Chords` / `Arpeggiator` |
| **Style** | Beat | `Basic Beat` / `Hip Hop Groove` / `Funk Pocket` / `Reggae One-Drop` / `Latin Samba` / `Jazz Swing` |
| **Timing** | Bass / Beat | `Normal Time` / `Half Time` / `Double Time` |
| **Density** | Bass / Beat | `Sparse` / `Normal` / `Dense` |

*Advanced harmony*

| Control | Role | Options |
|---------|------|---------|
| **Complexity** | Chord | `Triad (Basic)` / `Seventh (Rich)` / `Extended` |
| **Voicing Style** | Chord | `Standard` / `Drop 2` / `Rootless` |
| **Bass Passing** | Bass | `None (Straight)` / `Diatonic approach` / `Chromatic approach` |

> **Note**: *Progression Flavor* (Diatonic / Borrowed / Secondary Dominant) used to live here as a per-companion control. As of DEV-202 it is a **room-global** control — see the **Harmonic Flavor** selector in the panel-level controls below. Which chord plays (progression, chord length, flavor) is shared across all companions; only *how* each companion voices/embellishes that chord stays per-companion.

*Advanced rhythm*

| Control | Role | Options |
|---------|------|---------|
| **Comping Rhythm** | Chord | `Block (On-beat)` / `Strum` / `Arpeggio` / `Skank` / `Charleston Sync` / `Offbeat comping` / `Bossa groove` / `Syncopated Push` |
| **Hi-hat Swing** | Beat | 50–70% slider |
| **Drum Fills Every** | Beat | `Disabled` / `4 bars` / `8 bars` / `12 bars` |
| **Ghost Note Density** | Bass | `None` / `Low` / `High` |
| **Groove Pocket** | All | `Push (-15ms)` / `On Grid (0ms)` / `Laid Back (+25ms)` |

*Chord-role base settings* (shown for chord companions)

| Setting | Options | Description |
|---------|---------|-------------|
| **Interval** | ½ bar / 1 bar / 2 bars / 4 bars | Block-chord retrigger / arp phrase-restart interval |
| **Gate** | 25 / 50 / 70 / 90 / 100% (Block) · 25 / 50 / 70 / 100% (Arp) | Note length as a percentage (100% = legato) |
| **Octave** | 1 – 7 (± buttons) | Base octave for chord/arp voicings |
| **Sustain** toggle | on/off | Hold notes until the next chord change |
| **Root note** toggle | on/off | Add a low root note at the head of each chord |

*Arpeggiator-only extras* (shown when chord Style = Arpeggiator)

| Setting | Options | Description |
|---------|---------|-------------|
| **Rate** | beat-duration labels: `4 beats` (1/1), `2 beats` (1/2), `1 beat` (1/4), `1/2 beat` (1/8), `1/4 beat` (1/16) | How fast arp notes play |
| **Direction** | Up / Down / Up-Down | Arpeggio direction through the chord notes |

**Chord progression**: room-global and shared by all companions, with two modes. In **Auto** mode the server generates a deterministic Markov-chain progression driven by the room scale (same seed → same sequence for all companions), with chord length set by the global selector and harmony shaped by the global **Harmonic Flavor** (diatonic / borrowed / secondary-dominant). In **Manual** mode the progression is the user-built degree sequence (diatonic + borrowed steps, each with optional tension modifiers) from the Manual Setup modal; flavor is ignored. Both modes resolve through the shared chord-symbol layer (`shared/src/music/chordSymbol.ts` + `chordModifiers.ts`) so the engine, the editor labels, and the Chord Display always agree. The Chord Display widget reflects the server-computed progression state in real time.

**Audio scheduling**: note events are generated server-side on each metronome tick and delivered via `perform:companion_note_events`. Clients use an NTP-corrected clock and shared quarter-note timing helpers to schedule notes with sample-accurate timing. Stale payloads (>1 second late) are automatically discarded to avoid audio bursts after tab un-hide or reconnect.

---

## 5. Arrange Room (`/arrange/:roomId`) — Collaborative DAW

A full collaborative music production environment — like Google Docs but for music production. Multiple users can edit tracks, regions, and notes simultaneously. Maximum capacity: **10 users**.

### Layout — Desktop

**Transport & Top Bar:**
- **Transport controls**: Return to Start (`Cmd/Ctrl+1`), Play/Pause (`Cmd/Ctrl+2`), Stop (`Cmd/Ctrl+3`), Record (`Cmd/Ctrl+4`)
- **Count-In button**: 1-bar countdown before recording starts; metronome clicks during count-in regardless of metronome setting. Count length follows the time signature's native beat count, while click timing stays quarter-note based through the shared timing helper.
- **Loop toggle**: enable/disable loop region playback
- **Snap toggle**: snap regions and notes to grid
- **BPM control**: project-wide tempo (synced to all users)
- **Time Signature control**: numerator and denominator; timeline, ruler, loop, and recording count-in timing derive bar length through the shared time-signature helper.
- **Project Scale control**: root note + scale type (same 32 scales as Perform Room)
- **Project Menu** (Save / Remix / Stems / Mixdown — plus dev-only Import / Export):
  - **Save / New Save**: first save creates the project and makes you the project owner; label changes to "Save" on subsequent saves. Auto-save also runs every 60 seconds to IndexedDB (browser-local) as crash recovery.
  - **Remix**: shown only to non-owners on projects that allow remixing — copies the project to your own account (opens a confirm modal; see Section 11). Hidden for the project owner.
  - **Stems**: export MIDI + per-track WAV + a manifest as a ZIP for use in external DAWs (Logic Pro, Ableton, FL Studio, Pro Tools). No settings dialog. (owner-locked after first save)
  - **Mixdown**: render the final stereo audio mix in the browser; opens a settings modal (the only export with configurable options). (owner-locked after first save)
  - **Import** / **Export** (dev-only — gated behind `VITE_LOCAL_PROJECT === 'true'`): load / save a `.collab` project ZIP. Not visible in standard builds. (owner-locked after first save — BR-12)
- **Room Settings** button — allows project owner to edit **project name and description** (name/description editing is restricted to project owner only for existing projects; anyone can set them before first save)
- **Move to Perform Room** button (owner only)
- **Invite link copy** button

**Multi-track Timeline (main area):**
- **Add Track**: MIDI track (for virtual instruments) or Audio track
- Each **track header** contains: track name, volume slider, pan knob, mute button, solo button, instrument selector (MIDI tracks), color indicator, **Voice-to-MIDI toggle** (MIDI tracks), and an **input-monitoring ("hear yourself") toggle**
- All track parameters sync in real-time to all users
- Timeline contains **regions** (MIDI clips or audio clips) placed on a beat/measure grid
- Regions can be dragged, resized, and rearranged — all changes sync to all users
- **Collaborative locking**: when a user edits a region or track parameter, it locks to prevent conflicts (auto-expires after 5 minutes); a lock indicator appears on the locked element
- **Markers**: add named markers at specific timeline positions
- **Timeline zoom** in/out
- **Fit to All Regions** button — auto-zoom to fit all content
- **Marquee selection** for multi-region selection

**Multitrack toolbar buttons:**
- **Idea Capture** — hum + tap-tempo workflow to create a MIDI track (see Section 6). Lives here in the toolbar, not in the Project Menu.
- **Split Selected Regions at Playhead** — splits the selected region(s) at the current playhead position.
- **Add MIDI Region at Playhead (+)** — creates a new MIDI region on the selected track at the playhead.
- **Delete Selected Regions**, **Fit to All Regions**, **Zoom In / Zoom Out**.

**Track-level AI Generation** — click the AI button on any MIDI track:
- Free-text prompt describing what to generate
- Model selector
- Optional: use context from other tracks to make generation aware of existing content; can focus on a specific track for context

**Region Editor (bottom panel — appears when a region is selected):**

*MIDI Region → Piano Roll editor:*
- Draw, select, move, resize, delete notes
- Velocity control per note
- Quantization: 1/4, 1/8, 1/16, 1/32
- Scale view modes:
  - **All Keys**: all 128 MIDI notes
  - **Scale Keys**: only in-scale notes + existing out-of-scale notes
  - **Only Notes**: compact view — only rows that contain notes
- Out-of-scale notes highlighted with a warning color

*Audio Region → Waveform view:*
- Visual waveform display
- Region trimming

**Virtual Instrument Panel** (for MIDI tracks):
- Same keyboard/guitar/bass/drum pad/synthesizer interface as Perform Room
- **Voice-to-MIDI mode** (per MIDI track): toggle on the track header — sing or hum into the mic to record MIDI notes directly into that track in real-time

**Synth Controls Panel**: when a MIDI track uses a synthesizer instrument, synth parameters appear in a dedicated panel (same full controls as Perform Room synthesizer, including preset manager).

**Right Sidebar:**
- Per-track effect chain (same 16 effects as Perform Room)
- Room member list with presence indicators showing what each user is currently editing
- **Monitor Share toggle** — a sidebar control (enabled when a MIDI track is selected). When on, your instrument audio is streamed to all other band members in the room so they can hear you playing in real time — useful for practicing parts together or auditioning changes.

### Layout — Mobile

Mobile-optimized layout with simplified navigation. Full multi-track editing recommended on desktop.

---

## 6. Recording Features

### Perform Room

**Session Recording:**
- Requires a **verified** account — the Record button is unavailable to guests and unverified registered users (`isUserRestricted()`).
- Start/stop via the Record button in the top bar
- Records MIDI data and each instrument's output as separate tracks during the session
- When stopped, a "Save to Arrange Room" modal appears — confirm to create a new Arrange Room project pre-loaded with all recorded tracks.

**Shadow Capture:**
- Rolling 30-second buffer (see Section 4f)
- Save any moment retroactively as WAV

### Arrange Room

**Audio Recording (into Audio tracks):**
- Arm a track, press Record in transport
- Waveform visualization appears in real-time during recording

**MIDI Recording (into MIDI tracks):**
- Arm a MIDI track, play via the virtual instrument panel or external MIDI controller
- Notes captured as MIDI data into the track

**Voice-to-MIDI (Hum-to-MIDI) — per MIDI track:**
- Toggle per MIDI track via the track header button
- Sing or hum into mic → real-time pitch detection → MIDI notes recorded into that track
- Audio input device selector and always-on level meter provided

**Idea Capture** (3-phase workflow):
1. **Record phase** — tap the button repeatedly to set BPM from feel (requires ≥ 2 taps), then hum/sing your melody idea into the mic with a real-time level meter. Stop when done.
2. **Processing phase** — pitch detection, beat segmentation, quantization, and automatic key & scale detection run in sequence (progress bar shown).
3. **Ready phase** — shows detected note count + BPM; key & scale selector lets you override the auto-detected values (notes re-snap to the new scale automatically); **preview button** plays back the captured notes as acoustic piano. Apply to create a new MIDI track instantly.

---

## 7. MIDI & Soundfont Instruments (Arrange Room)

MIDI tracks in the Arrange Room can use any General MIDI soundfont instrument. The full 128-instrument GM set is available:

- **Keyboards**: Acoustic Grand Piano, Bright Acoustic Piano, Electric Grand Piano, Honky-tonk Piano, Electric Piano 1/2, Harpsichord, Clavinet
- **Chromatic Percussion**: Celesta, Glockenspiel, Music Box, Vibraphone, Marimba, Xylophone, Tubular Bells, Dulcimer
- **Organs**: Drawbar Organ, Percussive Organ, Rock Organ, Church Organ, Reed Organ, Accordion, Harmonica, Tango Accordion
- **Guitars**: Acoustic (nylon), Acoustic (steel), Jazz, Clean Electric, Muted Electric, Overdriven, Distortion, Harmonics
- **Bass**: Acoustic, Electric (finger), Electric (pick), Fretless, Slap 1/2, Synth 1/2
- **Strings, Brass, Reed, Pipe, Synth Lead/Pad/Effects, Ethnic, Percussive, Sound Effects** — full GM set

Additionally, the 4 synthesizer types (Analog Mono/Poly, FM Mono/Poly) are available as MIDI track instruments with full real-time parameter control.

**External MIDI Controller support** (Chrome / Edge / Brave only — requires Web MIDI API):
- Plug in any standard MIDI controller and it works automatically — no mapping setup needed
- **Note On/Off**: maps directly to the active instrument's note range
- **Sustain pedal**: CC 64 mapped to sustain hold
- **Pitch bend**: pitch bend wheel mapped to pitch modulation
- Connection status shown in the instrument area; a connect/disconnect button appears when a device is detected

---

## 8. Audience Room (`/perform/:roomId/audience`)

A view-only mode for watching a Perform Room session without participating. No instrument or sequencer controls are available.

Audio is delivered via **HLS (HTTP Live Streaming)** — not WebRTC — which allows the Audience Room to scale to many simultaneous listeners without impacting the performers' peer-to-peer mesh. The room owner must start the broadcast from the Perform Room for audio to be available; otherwise viewers see the room but hear no audio.

---

## 9. Profile Page (`/profile`)

Requires login. Personal dashboard for managing bands and projects.

**Sections:**
- **Bands**: list of bands the user belongs to. Click to go to Band Detail page.
- **Projects** — two tabs:
  - *Owned Projects*: projects you created
  - *Contributed Projects*: projects you have collaborated on (auto-tracked when saving projects with access)
- **Project Settings** (per project, owner only):
  - **Privacy**: Public (visible to everyone), Band (shared with one or more bands), Private
    - A project can be shared with **multiple bands simultaneously** (many-to-many). If the last shared band is removed, privacy resets automatically to Private.
  - **Allow Remix toggle**: whether others can remix (copy) this project. (Exposed in the API/UI as `allowRemix`; the underlying DB field is still named `allowFork`.)
  - **Lock toggle**: prevent non-owners from saving (read-only mode for collaborators)
- **Contributor System**:
  - When a user saves a project they have access to (BAND or PUBLIC), they become a **contributor** automatically
  - Contributors can save but cannot change settings, lock, visibility, or delete
  - Top 5 contributors shown on project cards with last contribution timestamp
- Click a project to open it in a new Arrange Room session

---

## 10. Band Detail Page (`/profile/band/:bandId`)

Shows band information and management.

**Sections:**
- Band name and description (inline editable by owner)
- **Band Projects**: list of projects shared within the band
- **Member Management** (owner only):
  - View member list with roles (Owner, Member)
  - Remove members
  - Generate shareable invite links (with expiration dates)
  - Send email invitations
  - Refresh invite tokens for security

**Join Band**: via invite link (`/join/:token`)

**Band Ownership**: the band owner **cannot leave the band** without first transferring ownership to another member. (Ownership transfer UI is a planned feature — currently, leaving as owner is blocked.)

---

## 11. Community Page (`/community`)

Requires login. Discover and collaborate on public projects.

**Features:**
- Search and filter public projects by name
- Paginated results
- **Active session detection**: live user count shown on projects with active rooms
- **One-click join**: join active sessions directly from community page
- **Open project**: creates a new room with the project loaded
- **Remix project**: create your own copy to remix freely (if the owner allows remixing)
  - **Remix workflow**:
    1. Click "Remix" on a project card
    2. If at project limit → modal to select an old project to replace
    3. Remixed project created with name `${original.name} (Remix)`
    4. Remixed project has remixing disabled (cannot be remixed again)
    5. Shows reference to original project (name + owner)
  - **Restrictions**: cannot remix your own projects; remixed projects cannot be remixed again
- **Contributor tracking**: top 5 contributors shown per card; contributors auto-tracked on save

---

## 12. Account Settings (`/account`)

User account management. Sections: **Profile** (username + profile picture), **Appearance** (application theme picker), **Password** (Change Password, or Set Password if the account has none), **Subscription & Billing**, **AI**, and **Logout**. (There is no connected-accounts / Google OAuth management section.)

**Project limits by account type:**

| Account Type | Project Limit |
|--------------|---------------|
| Guest (not logged in) | 0 (cannot save projects) |
| Registered (unverified or verified) | 3 projects |
| Artist | 10 projects |
| Pro | Unlimited |

**Billing page** (`/account/billing`): includes a 3-plan **PlanSelector** (Free / Artist / Pro), a **Payment Methods** section, a **Billing History** section, and a **Danger Zone**. Actual payment/subscription processing and history are still **Coming Soon** (Beta — Free Access); the page currently shows plan information and placeholders for the paid flows.

**AI Features (bring-your-own-key)**: enabling AI features is now a toggle plus a configuration form. When enabled, choose an **AI provider** (OpenAI or Gemini) and enter an **API key** (encrypted and stored server-side; never returned to the client). These keys power AI pattern generation in the sequencer and AI MIDI generation on Arrange tracks.

---

## 13. Key Interaction Patterns for Testing

- **Auth flow (validated)**:
  - Valid login redirects to lobby and persists `auth_token` after reload.
  - Invalid password shows error and stays on login page.
  - Guest mode can enter lobby without `auth_token`.
  - Guest users see restricted room options (private/hidden checkboxes disabled with explanation).
- **Lobby and room creation (validated)**:
  - "Create Perform Room" routes to `/perform/:roomId`.
  - "Create Arrange Room" routes to `/arrange/:roomId`.
  - Hidden rooms do not appear in public "Available Rooms" cards.
- **Private room approval (validated)**:
  - Join request shows waiting state on requester side; requester can cancel while waiting.
  - Owner sees pending request indicator and can approve/reject.
  - If owner does not respond within 10 minutes, request is auto-rejected.
  - Approve → requester enters room.
  - Reject → requester gets rejection modal and does not enter room.
- **Ghost/stale room handling (validated)**:
  - If room no longer exists, waiting-approval flow should not trap user.
  - Direct navigation to stale room shows "Room Not Available" flow and returns user to lobby.
- **Room lifecycle and role behavior (validated)**:
  - Room owner leave transfers ownership to another member.
  - Room owner can kick a member out.
  - Perform → Arrange switch by owner shows follow/stay modal to members with 30-second countdown; auto-dismisses with "Stay" if no response.
  - If member follows, member is moved to new Arrange room. If member stays, member remains in original room.
- **Reconnect behavior (validated)**:
  - Reloading Perform/Arrange pages keeps user in the same room URL and preserves interactive role.
- **Real-time sync behavior (validated)**:
  - BPM change syncs to other users after commit (Enter).
  - Scale slot change syncs to followers.
  - When follow mode is active, follower sees "Following:" state and local scale slot controls are hidden.
- **Arrange project ownership and permissions (validated)**:
  - In a new Arrange room with no linked project: `room_owner` sees and can use Import; `band_member` does not get Import and has disabled Save/New Save.
  - First successful "New Save" changes the label to "Save".
  - Existing linked project shows "Save" immediately (not "New Save").
  - Non-owner Save remains disabled after ownership is established.
  - When project owner joins a room containing their project, they are promoted to room_owner and previous room owner is demoted.
  - Project name and description in Room Settings are editable only by the project owner for existing projects.
- **Project rules and modals (validated)**:
  - Opening a project that already has an active room shows "Project In Use" modal.
  - If user is at project limit, save attempt shows "Project Limit Reached" modal.
  - Locked project prevents non-owner save.
- **Band Companion and Time Signature (validated)**:
  - Adding, playing, muting, updating settings (style, arpeggiator), and removing companions.
  - Audience role restriction (cannot view/manage Band Companion control actions).
  - Room owner can change the Perform Time Signature control, which properly syncs across all users and updates the companion beat alignment.
  - Dynamic chord display renders properly only when companion playback is active (`isAnyPlaying === true`).
- **Still expected but not fully asserted in E2E specs**:
  - Full effect-chain audio correctness.
  - Deep Arrange editing flows (region lock visuals, piano roll note editing, audio waveform editing).
  - Instrument audio output correctness (hammer-on velocity, chord voicing, drum per-pad volumes).
  - Synthesizer parameter changes, LFO, arpeggiator, and preset save/load.
  - AI pattern generation in sequencer and MIDI tracks.
  - Idea Capture and Voice-to-MIDI recording flows.
  - Instrument swap request/approval flow between members.
  - Monitor Share audio streaming in Arrange Room.
  - Session recording save-to-Arrange modal (verified accounts only; recording is blocked for guests and unverified users).
  - HLS broadcast start/stop and Audience Room audio delivery.
- **Mobile responsive**: The app has separate mobile layouts — on smaller screens the Perform Room uses a tab-based dock navigation (Tools / Sequencer / Input / Effects / Sidebar). Arrange Room on mobile has limited functionality; full workflow recommended on desktop.

### Practical E2E Notes for Agents

- Prefer `waitForLoadState('load')` over `networkidle` (WebSocket-heavy pages may not settle on networkidle).
- For multi-user assertions, allow short socket settle windows (commonly 2–3 seconds) before strict assertions.
- To avoid audience-role fallback in tests, seed role before entering room (e.g., via test setup/session path).
- Stable selectors commonly used in this app include title-based controls such as Leave Room, BPM, slot buttons, and owner-action buttons.
- Sequencer bank shortcuts are number keys `6`–`9` (not function keys).
- Shadow Capture, Practice Mode, and Follow Mode are per-user states — not synced across users (except the visible indicator on the member panel).
- Room capacity limits: Perform Room max 10 users, Arrange Room max 10 users — tests should not exceed these.
