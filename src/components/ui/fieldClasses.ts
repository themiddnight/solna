/**
 * The one stacked form-field label in the app.
 *
 * Four near-copies of this string had drifted apart — ChordView's `LABEL_BASE`
 * (`/60 mb-1`), SortableChordCard's inline copy (`/60 mb-0.5`), ChannelStrip's
 * own `LABEL_BASE` (`/50 mb-1`) and PresetLibrary's inline copy
 * (`uppercase font-bold /60 mb-1`) — one role wearing four looks. They live
 * here now so a fifth cannot appear quietly; `fieldClasses.test.ts` fails the
 * build if one does.
 *
 * Not uppercase and not bold: design.md §3 ("Casing by role") reserves
 * `text-xs font-bold uppercase tracking-wider` for SECTION headers. A field
 * label sitting above its own control is not a section header, so dressing it
 * as one — which PresetLibrary's copy did — flattens the hierarchy the rule
 * exists to create. `/60` over `/50` for contrast.
 */
export const FIELD_LABEL = 'text-[10px] text-base-content/60 block mb-1';

/**
 * The select a card's control row uses. Denser contexts legitimately size down
 * (`select-xs` inside a chord bar card, `select-sm w-full text-xs` in a save
 * form) — it is the LABEL above them that must never vary, not the control.
 */
export const FIELD_SELECT = 'select select-sm font-semibold';

/**
 * The control lane a labelled field sits its control in: the app's standard
 * 32px line, the height `btn-sm` and `select-sm` already resolve to.
 *
 * Its job is to put every LABEL in a control row on one baseline. Without it a
 * row of mixed controls (a 32px select, a 24px `btn-xs` join, a 48px knob, a
 * 30px fader shell) bottom-aligns its controls and scatters its labels — the
 * sequencer's Drum Sound row had them at five different heights. A control a
 * couple of pixels taller than the lane (a `sm` knob is 36px) simply centres
 * and overhangs it symmetrically, which reads as aligned; a control shorter
 * than the lane centres too.
 */
export const FIELD_LANE = 'flex items-center h-8';

/**
 * The count badge the Sounds and Progressions buttons carry.
 *
 * `sm:inline-flex`, never `sm:inline`: daisyUI centres a badge's content with
 * its own `inline-flex` + `align-items:center`, so overriding the display to
 * `inline` drops the centring and leaves the digits sitting whereever the font's
 * line box lands inside the badge's fixed 20px height. That is not a wash —
 * these two badges were 1.5px/6.5px and 4.5px/1px off centre, in OPPOSITE
 * directions, purely because one set `text-[10px]` and the other did not.
 *
 * Shared because the two buttons are deliberate twins: same shape, same place,
 * different content. Three separate class strings for one role had already
 * drifted apart on this screen once.
 */
export const COUNT_BADGE =
  'badge badge-sm badge-outline [--badge-color:currentColor] text-[10px] tabular-nums hidden sm:inline-flex';

/**
 * The section heading that opens a group of cards ("FX Chain", "Monitor",
 * "Drum Sequencer", "Chord Progression"). design.md §3 reserves this exact
 * combination — `text-xs font-bold uppercase tracking-wider` — for section
 * headers, which is precisely why `FIELD_LABEL` above must never wear it.
 * Six components spelled the string out by hand; one drifting copy is all it
 * takes for the rule the field label defers to to stop being true.
 */
export const SECTION_HEADER = 'text-xs font-bold uppercase tracking-wider text-base-content';

/**
 * The ordinal badge a numbered module card carries in its header (the synth's
 * five signal stages, the master rack's four FX units). Nine hand-written
 * copies — the same drift `FIELD_LABEL` and `COUNT_BADGE` were extracted to
 * stop, in markup the same branch added.
 */
export const STEP_BADGE = 'badge badge-sm badge-outline tabular-nums';

/**
 * The badge a view header carries beside its title. `ViewHeader` renders it,
 * and ChordView's inline chord-count chip is the same role in the same place —
 * it just sits in a card body rather than the header.
 */
export const HEADER_BADGE = 'badge badge-sm badge-outline text-[10px] font-semibold tabular-nums';
