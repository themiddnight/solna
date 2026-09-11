# Mobile-responsive workspace design

## Status

Approved design for making every Solna workspace usable on phones and tablets without changing audio, musical data, persistence, or playback behavior.

## Goal

Solna remains a full music workstation on a phone. Mobile does not remove editing capabilities; it reveals them progressively so the active musical task owns the screen. Tablet and laptop share the existing desktop-class composition, with secondary button labels collapsing where horizontal space is constrained.

Success means:

- every feature remains reachable below 768 px;
- the active workspace is legible without page-level horizontal overflow;
- grids may scroll horizontally inside their own bounded viewport;
- Play/Stop and the Input dock toggle remain reachable while a contextual sheet is open;
- touch interactions do not fight page scrolling;
- hidden, always-mounted views do not gain new subscriptions, animation loops, or store writes;
- the existing desktop experience does not regress.

## Responsive model

There are two layout modes, selected with CSS media queries rather than device detection or Zustand state.

### Mobile: below 768 px

Mobile uses a compact two-row app header, progressive disclosure, contextual snap sheets, larger touch targets, and bounded horizontal grid scrollers.

### Desktop class: 768 px and above

Tablet uses the laptop composition. At constrained desktop-class widths, secondary action labels collapse to icons with tooltips and accessible names. There is no tablet-only component tree or third information architecture.

Portrait and landscape phones remain in the mobile mode whenever their CSS viewport is below 768 px. Safe-area insets apply in both orientations.

## Mobile shell

The Loop-layer header contains only:

- the global menu trigger;
- the active loop selector;
- a prominent Vibes trigger;
- the Sound/Pattern view switcher.

The global menu contains project actions, Copy Loop, Key & Scale, MIDI settings, and theme selection. Vibes stays outside the menu because applying and auditioning vibes is a primary loop-building workflow.

The Song-layer header uses the same geometry, replacing loop-specific controls with the project subject and Arrange/Master FX switcher. Layer switching stays directly reachable from the global navigation surface.

The main workspace is the only vertically scrolling page region. The header, Input dock rail, and transport remain outside it.

## Persistent lower controls

The bottom of the viewport is a coordinated stack:

1. contextual sheet, when open;
2. always-visible Input dock rail;
3. expanded Input dock body, when open;
4. transport;
5. bottom safe-area inset.

CSS custom properties define the measured heights and offsets shared by these surfaces. No feature component independently guesses the transport or dock height.

The Input toggle and current focus remain visible on every view and Pattern segment. The transport's Play/Stop action remains interactive while any non-modal sheet or global menu is open.

## Contextual snap sheets

`MobileSheet` is a reusable, non-modal UI primitive. It owns presentation and gestures but no feature or Zustand state.

It supports three snap levels:

- rail: title, current selection, and Close remain visible;
- half: the default opening position;
- expanded: fills the available region above the persistent lower controls.

Sheets close only when the user presses Close, swipes down from the rail, or switches between the Loop and Song layers. Applying a value, pressing Play, changing Sound/Pattern, or interacting with the underlying workspace does not close a sheet.

When the Input dock expands, the active sheet temporarily minimizes to its rail. When the dock collapses, the sheet returns to its previous snap level. This is a suspension, not a close, so selected content and scroll position remain intact.

The sheet is deliberately non-modal: it does not trap focus or place an interaction-blocking backdrop over the transport or Input rail. It still exposes an accessible name, landmarks, Escape handling, deterministic focus restoration, and buttons for every drag-only action.

Only one contextual sheet may be active at a time. Opening another replaces the visible sheet while preserving feature data in the owning component.

## State ownership

A `MobileSheetProvider` near the app shell owns only ephemeral presentation state:

- active sheet identifier;
- requested snap level;
- snap level before Input dock suspension;
- open, close, minimize, restore, and layer-change operations.

The state is React-local, session-only, and excluded from Zustand, persistence, project files, and the URL. Sheet dragging uses local pointer state and CSS transforms; it never writes at pointer frequency to the store.

Feature content continues reading and writing through its existing state owners. Vibes, mixer controls, pattern settings, and synth settings are not duplicated inside the provider.

## View designs

### Sound

A sticky contextual toolbar below the app header contains the focused track and the Simple/Pro display-mode switch. Simple and Pro remain first-class synth workspaces in the main scroll; neither becomes a sheet or hidden advanced menu.

The synth patch card and its existing controls remain in the page. Save, Sounds, and Paste may collapse to icons at constrained widths. Sound Library remains a dedicated library surface.

The Mixer becomes a contextual sheet on mobile. `SoundMixer` must separate its content from the desktop `SectionCard` shell so the same mixer implementation can render in either location. On desktop class it remains inline. At tablet widths its groups become compact columns sooner than they do today, avoiding six tall full-width channel strips.

Beat focus keeps Drum Sound in the main workspace and the same Mixer trigger as melodic focuses.

### Pattern: Lead and FX

The Pattern segment switcher remains immediately visible and sticky with the view context. The piano roll owns most of the viewport.

The roll keeps its fixed musical cell width, horizontal scrolling, sticky note-name gutter, painting, resizing, cursor, marker, tick stride, and per-track playback subscriptions.

Scale/Chromatic mode, octave window, loop length, step resolution, and gate move to a Pattern Settings sheet on mobile. Record, Copy, Paste, and Clear remain close to the grid as editing actions. All actions stay available without changing the stored melody representation.

### Pattern: Accompaniment

The progression is still the primary page content. Add Chord remains visible; Re-harmonize, Auto-Reharmonize, Paste, and other secondary progression actions move into a contextual overflow surface.

The in-scale and borrowed-chord palettes become collapsible mobile sections while preserving immediate preview and add actions. Chord cards use an overflow menu for secondary move/delete operations. Chord, Bass, and Pad module panels remain in the main scroll and share responsive action behavior through `ModulePanelCard`.

### Pattern: Beat

The grid selector remains visible above the sequencer. Shift, Random, and Clear collapse according to available width. The sequencer retains its internal horizontal scroller and sticky track gutter; the gutter becomes narrower on mobile while keeping track name, mute, and volume operable.

A visual edge cue indicates that additional steps are available horizontally. No page-level horizontal scroll is introduced.

### Arrange

The existing mobile card layout is retained. Loop Play, loop name, Edit, playback status, key/repeat summary, and mix controls remain visible. Move, Duplicate, Copy Into, and Delete move into a per-card overflow menu on mobile.

Pointer drag remains available, but explicit move actions remain the keyboard and touch fallback. Touch drag activation must tolerate ordinary vertical scrolling.

The shared Loop Copy dialog remains a modal dialog and stays mounted once per arrangement, never once per loop card.

### Master FX

On mobile, each effect and dynamics stage is a collapsible card. Its identity and power toggle remain visible while collapsed; opening it reveals the knobs and meter. This reduces vertical travel without hiding whether a stage is active.

Tablet and laptop retain the current grid composition. Monitor mode controls and visualizer remain in the main scroll, with the existing active-tab animation gate intact.

## Shared components

The implementation introduces or extends these boundaries:

- `MobileSheet` and `MobileSheetProvider`: ephemeral sheet coordination;
- `MobileOverflowMenu`: grouped mobile actions without feature logic;
- `ResponsiveAction`: icon plus label with explicit collapse policy;
- `Toolbar`: desktop-class icon-only behavior at constrained widths;
- `ViewHeader` and `SegmentHeader`: compact and sticky mobile composition;
- `IconButton`: visual icon size remains small while the touch hit area reaches the mobile minimum;
- `PanelCard`, `SectionCard`, and `ModuleHeader`: responsive density through shared tokens rather than repeated media classes;
- `Modal`, `PresetLibrary`, and `QuickSavePopover`: viewport-height and safe-area hardening.

Existing components must be decomposed only where presentation shells prevent reuse. Business handlers stay with their current feature owners.

## Touch and accessibility contracts

- Primary and navigation targets are at least 44 by 44 CSS pixels on mobile.
- Dense grid cells may render smaller, but their gesture logic and row/column targeting must remain reliable.
- Drag gestures use `touch-action` only on the specific draggable surface; vertical page scrolling remains available elsewhere.
- Icon-only buttons always have `aria-label` and `title` through `IconButton` or `ResponsiveAction`.
- Menus expose menu semantics and deterministic keyboard dismissal.
- Non-modal sheets do not use `<dialog>` or focus trapping because transport interaction is part of the open-sheet workflow.
- Modal workflows such as destructive confirmation, MIDI settings, saving, and Loop Copy continue using the modal primitive.
- Focus returns to the triggering control when a menu, popover, modal, or sheet closes.
- Reduced-motion users get direct snap changes without spring or inertial animation.

## Performance constraints

- Responsive mode is CSS-driven and does not enter Zustand.
- Pointer-driven sheet position remains local and is committed only when a snap completes.
- Hidden always-mounted views acquire no additional timers, animation frames, clock subscriptions, or persisted writes.
- Existing analyser visibility gates and active-tab checks remain intact.
- A shared piece of feature content is not rendered twice merely to support two layouts if doing so would duplicate subscriptions or DOM IDs.

## Component impact map

### Shell and primary navigation

- Modify `src/App.tsx`, `src/index.css`, `src/components/Header.tsx`, `src/components/TransportBar.tsx`, and `src/components/ui/BottomInputDock.tsx`.
- Recompose `src/components/project/ProjectMenu.tsx`, `src/components/loop/LoopSelector.tsx`, and `src/components/loop/LoopCopyButton.tsx` without duplicating their actions.
- Add the sheet, overflow, and responsive-action primitives under `src/components/ui/`.

### Loop layer

- Split reusable Vibes content from `src/components/InstantVibesBar.tsx`.
- Recompose `src/components/loop/SoundView.tsx` and extract the presentation shell from `src/components/loop/SoundMixer.tsx`.
- Adjust layout only in `SimpleSynthPanel.tsx` and the five `loop/synth/*Panel.tsx` controls.
- Recompose `PatternView.tsx`, `LeadMelodyGrid.tsx`, `SequencerView.tsx`, `SequencerGrid.tsx`, and `TrackRow.tsx` without changing their playback logic.
- Recompose `ChordView.tsx`, `SortableChordCard.tsx`, `ModulePanelCard.tsx`, and the Chord/Bass/Pad panels.

### Song layer

- Recompose `ArrangeView.tsx`, `SortableLoopCard.tsx`, and `EffectsRackView.tsx`.
- Harden `LoopCopyDialog.tsx` for mobile viewport height without changing its shared-instance ownership.

### Shared presentation

- Extend `Toolbar.tsx`, `ViewHeader.tsx`, `SegmentHeader.tsx`, `SegmentedControl.tsx`, `IconButton.tsx`, `Modal.tsx`, `PresetLibrary.tsx`, and `QuickSavePopover.tsx`.
- Audit `Knob.tsx`, `Slider.tsx`, `VolumeFader.tsx`, `ChannelStrip.tsx`, and keyboard/drum-pad surfaces for touch hit areas and scroll conflict.

### Explicitly out of scope

- `src/audio/` and playback bridges;
- store slices, persisted state, and project format;
- musical data tables and vibe resolution/application;
- melody tick storage, sequencing semantics, clock ownership, and analyser scheduling;
- visual redesign of Solna's established palette and typography.

## Verification

Each implementation slice adds focused component tests before changing production markup. Tests cover sheet transitions, Input dock suspension and restoration, layer-change dismissal, accessible icon labels, preserved feature handlers, and no duplicate mounted content.

The final viewport matrix is:

- 390 × 844 phone portrait;
- 844 × 390 phone landscape;
- 768 × 1024 tablet portrait;
- 1024 × 768 tablet landscape;
- a representative laptop viewport;
- the existing wide desktop viewport.

For every viewport, exercise Sound Simple, Sound Pro, Beat Sound, Pattern Lead, Pattern FX, Pattern Accompaniment, Pattern Beat, Arrange, Master FX, Input keyboard, Input drums, Vibes, libraries, quick-save, MIDI, project menu, Loop Copy, theme, and transport.

Checks include visible overflow, internal scroll boundaries, safe areas, virtual-keyboard resizing, touch dragging, focus order, Escape behavior, reduced motion, persistent transport access, and console errors. Playback continues while switching tabs and while sheets open. Hidden views remain idle.

The completion gate remains `bun run verify`; the responsive work is not complete until that gate passes with no new ESLint warnings and the visual viewport matrix has been reviewed.

## Implementation sequence

1. Add responsive primitives and shared layout contracts.
2. Recompose App shell, Header, Input dock, and Transport.
3. Move mobile Vibes into the snap sheet.
4. Recompose Sound and the mobile Mixer sheet.
5. Recompose Pattern Lead/FX and their Settings sheet.
6. Recompose Pattern Beat.
7. Recompose Pattern Accompaniment.
8. Compact Arrange actions.
9. Add collapsible mobile Master FX cards.
10. Harden modal, library, popover, keyboard, and drum-pad surfaces.
11. Run focused tests, the viewport matrix, performance checks, and the full verification gate.
