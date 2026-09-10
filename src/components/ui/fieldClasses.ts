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
 * The variant of `FIELD_LANE` a daisyUI `join` of `btn-xs` toggles sits in —
 * the synth's Simple/Pro switch and all four of the pad module's toggle groups.
 * The shell is what makes a row of 24px buttons occupy the same 32px lane a
 * `select-sm` does, so its label lands on the shared baseline; `px-0.5` keeps
 * the outer buttons off the border and `bg-base-200` sinks the group the way a
 * segmented control reads.
 *
 * Composed from `FIELD_LANE` rather than repeating it: five copies of this
 * exact string had already accumulated, which is one edit away from the same
 * drift `FIELD_LABEL` exists to stop.
 */
export const JOIN_LANE = `join ${FIELD_LANE} bg-base-200 border border-base-300 rounded-box px-0.5`;

/**
 * The shell every group in the header chrome sits in: the layer switcher and
 * the tab bar in `Header.tsx`, Pattern's segment row, and the Sound tab's
 * Simple/Pro switch. A `join` of `btn-sm` buttons, so every one of them is the
 * same height.
 *
 * It is deliberately NOT `JOIN_LANE`. That one is a form control — it composes
 * `FIELD_LANE` to drop a row of `btn-xs` toggles onto a labelled field's 32px
 * baseline — and the header has no field baseline to join. Sound's Simple/Pro
 * wore it while it sat in `actions`, which put a 32px segmented control in the
 * same card as Pattern's 40px one; moving it beside the title is what made the
 * mismatch a thing you see side by side.
 */
export const HEADER_GROUP =
  'join bg-base-200 border border-base-300 rounded-box p-1 shrink-0';

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
 * The select the header chrome wears: the loop picker and both master scale
 * selects. Ghost-filled, because the shell around it already draws the box.
 *
 * `appearance-none` is load-bearing, not decoration. daisyUI opts every
 * `.select` into Chrome's customizable select (`@supports (appearance:
 * base-select)`) and clips the label through a rule on `selectedcontent` — but
 * `selectedcontent` only exists when the author writes the
 * `<button><selectedcontent>` markup themselves. With a plain `<select>` Chrome
 * renders its own button instead, that rule matches nothing, and a label longer
 * than the control paints straight through the padding, over the chevron and
 * out past the border. Falling back to the classic rendering hands the label
 * back to `.select`'s own `text-overflow: ellipsis`, which clips it at the
 * content edge; `pe-8` widens daisyUI's 1.75rem end padding by 4px so the
 * ellipsis lands a clear 8px short of the arrow rather than 4.
 *
 * The trade, on the record: these selects open the platform's own list rather
 * than daisyUI's styled picker. Everything about the CLOSED control — the ghost
 * fill, the arrow (a background image, not the hidden `::picker-icon`) — is
 * unchanged.
 *
 * Truncation also needs a FIXED width at the call site — a `w-*`, never a
 * `min-w-*`: daisyUI sizes `.select` at `clamp(3rem, 20rem, 100%)` with
 * `flex-shrink: 1`, so a min-width leaves the real width to whatever the navbar
 * has left over that render — and a select free to size itself never overflows,
 * so its `text-overflow` never fires.
 */
export const HEADER_SELECT = 'select select-sm select-ghost font-bold appearance-none pe-8';

/**
 * The box a labelled control group sits in in the navbar: the loop picker and
 * the master key/scale pair. It is the header's answer to `FIELD_LANE` — the
 * caption and its control read as one object rather than two things that happen
 * to be adjacent — and both groups wearing it is what makes the right-hand
 * cluster a row of equals rather than a run of loose selects.
 */
export const HEADER_FIELD_SHELL =
  'flex items-center gap-1 bg-base-200 border border-base-300 px-2 py-0.5 rounded-field';

/**
 * The right-hand control cluster of a card's header band.
 *
 * `HeaderCard` (a tab's header) and `SectionCard` (a section inside it) both
 * draw one, and on the Sound tab they stack on the same screen — so a gap or
 * min-height change to one has to reach the other or the two bands visibly
 * split. They were two literals that already differed by two modifiers, each
 * file's comment pointing at the other as the model, which is the tell that
 * they were meant to be one thing. Compose the per-band modifier at the call
 * site: `cx(ACTION_CLUSTER, 'empty:hidden')`, `cx(ACTION_CLUSTER, 'relative')`.
 */
export const ACTION_CLUSTER = 'flex items-center flex-wrap gap-1.5 min-h-8';

/**
 * The same pill, at the transport bar's tighter metrics.
 *
 * A named sibling rather than a private literal in `TransportBar.tsx`, because
 * BPM and Meter are the same role as the navbar's loop picker and key/scale
 * group — "the box a labelled control group sits in" — and one role spelled in
 * two files is how the two ended up a padding step apart with nothing to say
 * whether that was a decision. It IS a decision: the transport bar packs
 * Play, a target label, BPM, Meter, a metronome, a meter and the master fader
 * into one row, so its pills give up horizontal padding below `sm` where the
 * header's have room. Keep the difference here, in one file with the token it
 * differs from, so the next reader compares two lines instead of two files.
 */
export const TRANSPORT_FIELD_SHELL =
  'flex items-center gap-0.5 sm:gap-1 bg-base-200 border border-base-300 px-1 sm:px-1.5 py-0.5 sm:py-1 rounded-box';

/**
 * The transport pill's caption. Lowercase where `GROUP_LABEL` is uppercase:
 * "BPM" and "Meter" are already caps as words, so the transform buys nothing
 * and the tracking it carries costs width the row does not have.
 */
export const TRANSPORT_FIELD_LABEL = 'text-[10px] text-base-content/50 hidden sm:inline px-1';

/**
 * The badge a view header carries beside its title. `ViewHeader` renders it,
 * and ChordView's inline chord-count chip is the same role in the same place —
 * it just sits in a card body rather than the header.
 */
export const HEADER_BADGE = 'badge badge-sm badge-outline text-[10px] font-semibold tabular-nums';

/**
 * The micro-label that names a GROUP rather than a field: the caps line above
 * a GroupFrame, the keyboard's octave caption, the Sound view's "Focus:".
 *
 * Smaller and dimmer than SECTION_HEADER, which names a whole card, and unlike
 * FIELD_LABEL it is uppercase — design.md §3 assigns the casing by role, and
 * three literal copies of this exact string had already appeared before it was
 * a constant. The loop card's three caps captions wear `font-bold` rather than
 * `font-semibold` and stay their own literals: matching them here would change
 * how they look, which is a design call and not a cleanup.
 */
export const GROUP_LABEL = 'text-[10px] uppercase tracking-wider text-base-content/50 font-semibold';
