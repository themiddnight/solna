# Solva — Design System & Architecture Specification

## 1. Introduction & Conceptual Vision

**Solva** is a dawn-inspired, single-user solo music creation and idea-sketching workspace. 
- **The Narrative**: Solva represents the quiet, focused morning hours (*Dawn*) where a musician explores chords, tests melodies, and sequences loops in solitude. Later, these ideas can be brought into **Murva** (*Dusk*) for multiplayer collaborative jamming.
- **Design Objective**: Deliver a cozy, low-pressure, highly tactile audio workstation experience that blends professional DAW capabilities with warm, inviting analog-hardware aesthetics.

---

## 2. Color System & Theme Architecture

Solva is built using Tailwind CSS and DaisyUI, featuring two custom-crafted warm-tinted themes designed to reduce eye strain during extended creative sessions while maintaining high contrast.

### ☕ Solva-Dark (`solva-dark`) — Espresso & Sunrise Glow
Designed for deep night-owl or twilight composition sessions with warm charcoal undertones instead of cold blue-blacks.

* **Canvas & App Background (`base-200`):** `#14121B` (Deep Espresso Charcoal)
* **Panels & Cards (`base-100`):** `#1C1924` (Warm Dark Slate)
* **Borders & Insets (`base-300`):** `#2C2738` (Warm Muted Inset)
* **Primary Accent (`primary`):** `#F59E0B` (Sunrise Amber — Playhead, Active Steps, Key Controls)
* **Secondary Accent (`secondary`):** `#FB7185` (Dawn Coral — Chords & Harmony highlights)
* **Visual Accent (`accent`):** `#2DD4BF` (Fresh Teal — Synth & Modulation)
* **Base Content (Text):** `#F5EFEB` (Warm Cream Off-White)

### 📜 Solva-Light (`solva-light`) — Sunlight Alabaster & Warm Paper
Designed for morning and daytime sketching, simulating warm parchment paper without clinical stark white glare.

* **Canvas & App Background (`base-200`):** `#F7F4EF` (Warm Alabaster Linen)
* **Panels & Cards (`base-100`):** `#FFFFFF` (Pure White with Warm Cast)
* **Borders & Insets (`base-300`):** `#E8E2D8` (Soft Warm Gray Border)
* **Primary Accent (`primary`):** `#D97706` (Deep Warm Amber)
* **Secondary Accent (`secondary`):** `#E11D48` (Terracotta Rose)
* **Visual Accent (`accent`):** `#0D9488` (Deep Morning Teal)
* **Base Content (Text):** `#241E19` (Roasted Coffee Charcoal)

---

## 3. Typography & Hierarchy

Solva uses clean, highly readable font stacks optimized for precision controls and musical notation.

* **Headings & Titles:** Inter / System Sans-Serif with `tracking-tight` for compact musical labels.
* **Musical Values & BPM:** Monospace font stack (`font-mono`) for numerical readouts (BPM, Filter cutoff, Gain dB, step timing).
* **Font Scaling:**
  * **App Title:** 14px Bold (`text-sm font-extrabold`)
  * **Section Headers:** 14-16px Bold
  * **Control Labels & Hints:** 10-12px Medium (`text-xs` / `text-[10px]`)

---

## 4. Component Architecture

Solva is structured into modular, single-responsibility React components:

1. **`Header.tsx`**: Top navigation bar containing the Solva brand logo, project title, primary view tabs (`Synth`, `Step Matrix`, `Chords`, `Master FX`), global Key/Scale selector, Project modal trigger, and the **Theme Toggle** button.
2. **`InstantVibesBar.tsx`**: Quick-start genre and mood presets (`Lo-Fi Chill`, `Synthwave 80s`, `Cyber EDM`, `Deep Ambient`, `Boom Bap`, `Zen Garden`) allowing instant loading of complete harmonic and rhythmic templates.
3. **`TransportBar.tsx`**: Bottom sticky player controls featuring Play/Stop All, Tab Play, Tap Tempo BPM control, Metronome toggle, real-time stereo VU meter, and Master Output volume fader.
4. **`SimpleSynthPanel.tsx` / `SynthView.tsx`**: Dual-mode synthesizer interface featuring 4 friendly macro knobs (`Tone`, `Space`, `Vibe`, `Punch`), 1-click Arpeggiator controls, and an interactive musical keyboard supporting computer key bindings.
5. **`SequencerView.tsx`**: Multi-track step sequencer grid for drums, bass, synth, and percussion patterns with velocity and step probability editing.
6. **`ChordView.tsx`**: Interactive chord progression builder featuring sortable chord cards, Roman numeral analysis, and automatic chord voicing generation.
7. **`EffectsRackView.tsx`**: Master audio chain comprising Algorithmic Space Reverb, Stereo Echo Delay, Wave Distortion/Crunch, and a 3-Band Equalizer.

---

## 5. Audio Engine & State Persistence

- **Audio Synthesis**: Powered by `Tone.js` running through robust Web Audio API context management.
- **State Management**: Zustand store (`src/store/`) managing transport, synth patches, chord progressions, drum patterns, and master effects in real-time.
- **Persistence**: Local storage and project JSON export/import workflows allowing creators to save and load their musical sketches effortlessly.
