import React, { Suspense } from "react";
import {
  Sparkles,
  Bookmark,
  Library,
  Check,
  ChevronLeft,
  ChevronRight,
  AudioWaveform,
} from "lucide-react";
import type { MixLayerId } from "@/store/focusTrack";
import type { SynthPreset, SynthPresetCategory } from "@/data/synthPresets";
import { SYNTH_CATEGORIES } from "@/data/synthPresets";
// The drawer is never needed on first paint — PresetLibrary early-returns
// null when closed — so it is code-split out of the main chunk.
const SynthPresetLibrary = React.lazy(() =>
  import("./SynthPresetLibrary").then((m) => ({ default: m.SynthPresetLibrary })),
);
import { SoundScope } from "./SoundScope";
import { SubtractiveProPanel } from "./synth/SubtractiveProPanel";
import { SimpleSynthPanel } from "./SimpleSynthPanel";
import { useSynthChannel } from "./synth/useSynthChannel";
import type { SynthChannel } from "./synth/useSynthChannel";
import { ModulePasteButton } from "./ModulePasteButton";
import { QuickSavePopover } from "../ui/QuickSavePopover";
import { SectionCard } from "../ui/SectionCard";
import { IconButton } from "../ui/IconButton";
import { COUNT_BADGE } from "../ui/fieldClasses";
import { SYNTH_TARGET_STYLES } from "@/utils/synthControl";
import type { SynthControlTarget } from "@/utils/synthControl";
import type { LoopCopyGroupId } from "@/store/loopCopy";
import { TOOLBAR_BUTTON_IDLE } from "@/components/ui/Toolbar";
import {
  categoryPresetCount,
  groupInCategory,
  useSynthOverlays,
  useSynthPresetBrowser,
  type SynthOverlays,
  type SynthPresetBrowser,
} from "./synth/synthPresetBrowser";
import type { SoundDepth } from "./useSoundDepth";

/** The Pro mode category tabs, in the order the original listed them. */
const PRO_CATEGORY_TABS: readonly { id: string; label: string }[] = [
  { id: "All", label: "All" },
  { id: "Bass", label: "Bass" },
  { id: "Lead", label: "Lead" },
  { id: "Pad", label: "Pad" },
  { id: "Keys", label: "Keys" },
  { id: "Pluck", label: "Pluck" },
  { id: "Brass", label: "Brass" },
  { id: "FX", label: "FX" },
  { id: "User", label: "Custom" },
];

/** The Simple mode style chips, with the original's emoji per chip. */
const SIMPLE_CATEGORY_CHIPS: readonly { id: string; label: string; emoji: string }[] = [
  { id: "All", label: "All Sounds", emoji: "✨" },
  { id: "Lead", label: "Lead Melody", emoji: "⚡" },
  { id: "Pad", label: "Ambient Pad", emoji: "🌌" },
  { id: "Keys", label: "Keys & Piano", emoji: "🎹" },
  { id: "Bass", label: "Deep Bass", emoji: "🔥" },
  { id: "Pluck", label: "Snappy Pluck", emoji: "🪕" },
  { id: "Brass", label: "Brass Stabs", emoji: "🎷" },
  { id: "FX", label: "Sci-Fi FX", emoji: "🛸" },
];

/**
 * The Synth band's three actions: Save (raises the quick-save popover), Sounds
 * (opens the library) and the paste button, which follows the FOCUS rather than
 * the tab — this section shows whichever melodic patch `synthTarget` names, so
 * its paste button has to name THAT track's sound group. `SYNTH_SOUND_GROUP`
 * carries the mapping and its docblock says why a two-way test is wrong here;
 * `synthTarget` is non-null everywhere inside this card, so the lookup is
 * total. The pattern groups are not offered from this band — the melody grids
 * and the Pattern segments already carry them. The table itself is the tab's
 * (`SYNTH_SOUND_GROUP` in SoundView), passed in rather than declared here.
 */
function SynthSectionActions({
  synthTarget,
  soundGroups,
  presetCount,
  toast,
  onQuickSave,
  onOpenLibrary,
}: {
  synthTarget: SynthControlTarget;
  soundGroups: Record<SynthControlTarget, LoopCopyGroupId>;
  presetCount: number;
  toast: string | null;
  onQuickSave: () => void;
  onOpenLibrary: () => void;
}) {
  return (
    <>
      <button
        id="btn-quick-save-preset"
        onClick={onQuickSave}
        className="btn btn-sm btn-ghost gap-1 border border-base-300 text-xs font-semibold"
        title="Save preset"
      >
        <Bookmark className="w-3.5 h-3.5 text-primary" />
        <span className="hidden sm:inline">Save</span>
      </button>

      <button
        id="btn-open-presets-library"
        onClick={onOpenLibrary}
        className="btn btn-sm btn-primary gap-1 text-xs font-semibold"
        title="Sound Library"
      >
        <Library className="w-3.5 h-3.5" />
        {/* Names the content, not the container: the Chords view has an
            identical button in the identical place, and "Library" made
            the two read as the same drawer. It also makes the count badge
            answerable — "Library 29" never said 29 of what. */}
        <span>Sounds</span>
        <span className={COUNT_BADGE}>{presetCount}</span>
      </button>

      <ModulePasteButton groups={[soundGroups[synthTarget]]} />

      {/* Inside `actions`, so it hangs off the button cluster that
          raised it. As a child of the card it anchored to the card's own
          `relative` root, which wraps the focus row, the preset bar AND
          the whole Simple/Pro body — so `top-full` resolved at the
          bottom edge of a five-panel card, over the Drum Sound card
          below and nowhere near the Save button. */}
      {toast && (
        <div className="toast toast-top toast-end absolute top-full right-0 mt-2 z-20">
          <div className="alert alert-success text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-lg">
            <Check className="w-3.5 h-3.5" />
            <span>{toast}</span>
          </div>
        </div>
      )}
    </>
  );
}

/** One of the four preset steppers, which differ only in id, label, size and
 *  direction — the icon scales with the button. */
function PresetStepButton({
  id,
  label,
  size,
  direction,
  onStep,
}: {
  id: string;
  label: string;
  size: 'xs' | 'sm';
  direction: -1 | 1;
  onStep: (direction: -1 | 1) => void;
}) {
  return (
    <IconButton
      id={id}
      label={label}
      icon={
        direction === -1 ? (
          <ChevronLeft className={size === 'xs' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        ) : (
          <ChevronRight className={size === 'xs' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        )
      }
      size={size}
      variant="outline"
      onClick={() => onStep(direction)}
    />
  );
}

/** The Pro bar's category filter tabs, with each chip's own count. */
function ProCategoryTabs({ browser }: { browser: SynthPresetBrowser }) {
  const { allPresets, selectedCategoryFilter, filterByCategory } = browser;

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none text-[11px]">
      <span className="text-[10px] uppercase font-bold text-base-content/50 px-1">
        Category:
      </span>
      {PRO_CATEGORY_TABS.map((cat) => {
        const isSelected = selectedCategoryFilter === cat.id;
        return (
          <button
            key={cat.id}
            id={`filter-category-${cat.id.toLowerCase()}`}
            onClick={() => filterByCategory(cat.id)}
            className={`btn btn-xs gap-1 font-semibold whitespace-nowrap text-xs ${
              isSelected
                ? "btn-primary"
                : "btn-ghost text-base-content/60 hover:bg-base-300"
            }`}
          >
            <span>{cat.label}</span>
            <span
              className={`badge badge-xs text-[9px] ${
                isSelected
                  ? "badge-outline [--badge-color:currentColor]"
                  : "badge-ghost text-base-content/60"
              }`}
            >
              {categoryPresetCount(allPresets, cat.id)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The Pro bar's right half: the active category tag, the two steppers and the
 * optgroup dropdown.
 *
 * The dropdown is flexible below `sm` and fixed above it. `min-w-50` (200px)
 * plus the badge and the two stepper buttons came to ~316px inside a 327px
 * phone card, so the NEXT button wrapped to a line of its own and the two
 * steppers stopped reading as a pair. Letting the dropdown take the leftover
 * width instead keeps all four on one row at every width.
 */
function ProPresetPicker({ browser }: { browser: SynthPresetBrowser }) {
  const {
    activePresetItem,
    categoryGroups,
    selectedCategoryFilter,
    activeCategoryMeta,
    stepPreset,
    selectByName,
  } = browser;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Active Category Pill Tag */}
      {activeCategoryMeta && (
        <span
          className={`badge badge-sm badge-outline text-[10px] font-semibold ${activeCategoryMeta.badgeClass}`}
          title={`Category: ${activeCategoryMeta.label} - ${activeCategoryMeta.description}`}
        >
          {activeCategoryMeta.shortLabel}
        </span>
      )}

      <PresetStepButton
        id="btn-prev-synth-preset"
        label="Previous Preset"
        size="xs"
        direction={-1}
        onStep={stepPreset}
      />

      {/* Categorized Dropdown with Optgroups */}
      <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-field px-2 min-w-0 flex-1 sm:flex-none sm:min-w-50 max-w-60">
        <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
        <select
          id="select-synth-preset"
          value={activePresetItem?.name ?? ''}
          onChange={(e) => selectByName(e.target.value)}
          className="select select-sm select-ghost bg-transparent border-0 text-base-content text-xs focus:outline-none pr-2 font-medium min-w-0 max-w-60 truncate"
        >
          {categoryGroups
            .filter((g) => groupInCategory(g.category, selectedCategoryFilter))
            .map((group) => (
              <optgroup
                key={group.category}
                label={group.label}
                className="font-bold"
              >
                {group.presets.map((p) => (
                  <option key={p.id} value={p.name}>
                    {!p.isFactory ? `★ ${p.name}` : p.name}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </div>

      <PresetStepButton
        id="btn-next-synth-preset"
        label="Next Preset"
        size="xs"
        direction={1}
        onStep={stepPreset}
      />
    </div>
  );
}

/** Pro Mode: the categorized preset selection bar above the control panels. */
function ProPresetBar({
  synthTarget,
  browser,
}: {
  synthTarget: SynthControlTarget;
  browser: SynthPresetBrowser;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2.5 bg-base-300 border border-base-300 p-2 rounded-box ${SYNTH_TARGET_STYLES[synthTarget].tint}`}>
      <ProCategoryTabs browser={browser} />
      <ProPresetPicker browser={browser} />
    </div>
  );
}

/** Simple Mode: the preset selector, the category chips and the quick filters. */
function SimplePresetBar({ browser }: { browser: SynthPresetBrowser }) {
  const {
    allPresets,
    activePresetItem,
    activeCategoryMeta,
    selectedCategoryFilter,
    stepPreset,
    selectPreset,
    filterByCategory,
  } = browser;

  return (
    <div className="pt-3 border-t border-base-300 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-0">
        {/* Preset Title & Category Badge */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {activeCategoryMeta && (
            <span
              className={`badge badge-sm text-[10px] font-bold ${activeCategoryMeta.badgeClass}`}
            >
              {activeCategoryMeta.label}
            </span>
          )}
          <p className="text-2xl leading-6 font-extrabold text-base-content tracking-tight truncate">
            {activePresetItem?.name ?? "Default Sound"}
          </p>
        </div>

        {/* Preset Stepper & Selector */}
        <div className="flex items-center gap-2">
          <PresetStepButton
            id="btn-simple-prev-preset"
            label="Previous Sound"
            size="sm"
            direction={-1}
            onStep={stepPreset}
          />

          <select
            id="select-simple-preset"
            value={activePresetItem?.name ?? ''}
            onChange={(e) => {
              const found = allPresets.find(
                (p) => p.name === e.target.value,
              );
              if (found) selectPreset(found);
            }}
            className="select select-sm text-xs font-semibold max-w-50 truncate"
          >
            {allPresets.map((p) => (
              <option key={p.id} value={p.name}>
                {p.category}: {p.name}
              </option>
            ))}
          </select>

          <PresetStepButton
            id="btn-simple-next-preset"
            label="Next Sound"
            size="sm"
            direction={1}
            onStep={stepPreset}
          />
        </div>
      </div>

      {/* Category Quick Filter Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0 no-scrollbar">
        <span className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider font-sans mr-1">
          Sound Style:
        </span>
        {SIMPLE_CATEGORY_CHIPS.map((cat) => {
          const isSelected = selectedCategoryFilter === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => filterByCategory(cat.id)}
              className={`btn btn-xs gap-1.5 text-xs font-medium whitespace-nowrap ${
                isSelected
                  ? "btn-primary font-semibold"
                  : TOOLBAR_BUTTON_IDLE
              }`}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The preset bar above the body, in whichever depth mode is showing. */
function SynthPresetBar({
  depth,
  synthTarget,
  browser,
}: {
  depth: SoundDepth;
  synthTarget: SynthControlTarget;
  browser: SynthPresetBrowser;
}) {
  if (depth === 'pro') {
    return <ProPresetBar synthTarget={synthTarget} browser={browser} />;
  }
  return <SimplePresetBar browser={browser} />;
}

/**
 * Simple vs Pro Mode body panels. Inside the Synth section now: they edit the
 * target the row above selects, so a card boundary between the two said they
 * were separate things.
 *
 * Both are views of the SAME `SynthChannel`, and switching between them writes
 * nothing — Simple stores nothing of its own (see `SimpleSynthPanel`), so the
 * toggle is a change of depth, not of state.
 *
 * The "switch to Pro" invitation lives inside the Simple deck's own footer
 * rather than in a banner under it: Variant B gives it a slot, and a banner
 * repeating the footer would state the same fact twice on one screen.
 */
function SynthPanels({
  depth,
  channel,
  synthTarget,
  onSwitchToPro,
}: {
  depth: SoundDepth;
  channel: SynthChannel;
  synthTarget: SynthControlTarget;
  onSwitchToPro: () => void;
}) {
  if (depth === 'pro') {
    return <SubtractiveProPanel channel={channel} synthTarget={synthTarget} />;
  }
  return <SimpleSynthPanel channel={channel} onSwitchToPro={onSwitchToPro} />;
}

/**
 * Quick Save Modal Popover with Category selection. Outside the Synth section,
 * not in it: it is an overlay the section raises, and nesting it would put a
 * popover inside the tinted card it floats over. Gated on a melodic focus along
 * with the section that raises it — a drum focus has no synth patch for it to
 * save.
 */
function SynthQuickSaveOverlay({ overlays }: { overlays: SynthOverlays }) {
  return (
    <QuickSavePopover
      open={overlays.isQuickSaving}
      onClose={overlays.closeQuickSave}
      heading="Save Custom Preset to LocalStorage:"
      placeholder="Preset Name..."
      saveLabel="Save Patch"
      name={overlays.quickSaveName}
      onNameChange={overlays.setQuickSaveName}
      categories={SYNTH_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
      category={overlays.quickSaveCategory}
      onCategoryChange={(v) => overlays.setQuickSaveCategory(v as SynthPresetCategory)}
      onSubmit={overlays.handleQuickSaveSubmit}
      formClassName="flex items-center gap-2 flex-1 max-w-xl flex-wrap sm:flex-nowrap"
    />
  );
}

/**
 * Preset Library Sidebar Drawer / Modal. Gated with the Synth section: the
 * library edits whichever synth patch `target` names, and a drum focus names
 * none.
 */
function SynthPresetDrawer({
  overlays,
  synthTarget,
  showSoundBadges,
  onSelectPreset,
  onSavedPreset,
}: {
  overlays: SynthOverlays;
  synthTarget: SynthControlTarget;
  showSoundBadges: boolean;
  onSelectPreset: (preset: SynthPreset) => void;
  onSavedPreset: (preset: SynthPreset) => void;
}) {
  return (
    <Suspense
      fallback={
        overlays.isLibraryOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/60">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : null
      }
    >
      <SynthPresetLibrary
        isOpen={overlays.isLibraryOpen}
        onClose={overlays.closeLibrary}
        target={synthTarget}
        showSoundBadges={showSoundBadges}
        onSelectPreset={(preset) => {
          onSelectPreset(preset);
          overlays.closeLibrary();
        }}
        onSavedPreset={(preset) => {
          onSavedPreset(preset);
          overlays.closeLibrary();
        }}
      />
    </Suspense>
  );
}


/**
 * The Synth card: the band's three actions, the preset bar, and the control
 * panels that shape whichever patch the focus points at.
 */
function SynthCard({
  synthTarget,
  activeTab,
  depth,
  channel,
  browser,
  overlays,
  soundGroups,
  onSwitchToPro,
}: {
  synthTarget: SynthControlTarget;
  activeTab: string;
  depth: SoundDepth;
  channel: SynthChannel;
  browser: SynthPresetBrowser;
  overlays: SynthOverlays;
  soundGroups: Record<SynthControlTarget, LoopCopyGroupId>;
  onSwitchToPro: () => void;
}) {
  const tintClass = [SYNTH_TARGET_STYLES[synthTarget].ring, SYNTH_TARGET_STYLES[synthTarget].tint]
    .filter(Boolean)
    .join(" ");

  return (
    /* The Synth section: the target it points at, the preset on it, and the
       controls that shape it, in ONE card. They were three stacked siblings — a
       tinted target/preset card, then a bare row of five module cards, then the
       drum card — which read as "the tab" rather than as one of the tab's three
       sections, and left the Drum and Mixer cards below looking like leftovers
       rather than peers. */
    <SectionCard
      icon={AudioWaveform}
      title="Synth"
      tint={tintClass}
      /* The scope rides the band beside the name, not the card body: it
         monitors the very patch this section's title names, and a full-width
         row of its own between the band and the preset bar spent a whole line
         on a 25px-tall readout. */
      monitor={
        <SoundScope
          source={synthTarget}
          label={SYNTH_TARGET_STYLES[synthTarget].label}
          /* The Chord target is the one whose identity is the accent role;
             every other melodic target traces in primary. */
          colorTheme={synthTarget === 'chord' ? 'accent' : 'primary'}
          paused={activeTab !== 'sound'}
        />
      }
      /* Save and Sounds ride the SYNTH band, not the tab header: both act on
         the synth patch and nothing else on this tab, and a synth-only
         control sitting in the tab's own header is part of what made the tab
         read as "the synth, plus two leftovers". */
      actions={
        <SynthSectionActions
          synthTarget={synthTarget}
          soundGroups={soundGroups}
          presetCount={browser.allPresets.length}
          toast={browser.saveToast}
          onQuickSave={() =>
            overlays.openQuickSave(
              browser.activePresetItem?.name ?? '',
              browser.activePresetItem?.category,
            )
          }
          onOpenLibrary={overlays.openLibrary}
        />
      }
    >
      <SynthPresetBar
        depth={depth}
        synthTarget={synthTarget}
        browser={browser}
      />
      <SynthPanels
        depth={depth}
        channel={channel}
        synthTarget={synthTarget}
        onSwitchToPro={onSwitchToPro}
      />
    </SectionCard>
  );
}

/**
 * The Synth half of the Sound tab: the Synth card and the two overlays it
 * raises. It reads the five synth channels from the store itself rather than
 * taking them as props.
 *
 * It does NOT render the tab's header, and the focus chips that used to sit
 * above it live in the header now too — the header is SoundView's, because
 * the tab's identity, AND the control that changes what the tab is focused
 * on, must not belong to a section that is unmounted on a drum focus.
 *
 * SoundView unmounts this section entirely on a drum focus rather than
 * rendering it bodiless, so `synthTarget` arrives here already non-null.
 */
export function SoundSynthSection({
  focusTrack,
  synthTarget,
  activeTab,
  soundGroups,
  depth,
  onDepth,
}: {
  focusTrack: MixLayerId;
  synthTarget: SynthControlTarget;
  activeTab: string;
  /** SYNTH_SOUND_GROUP, owned by SoundView — see its docblock for why the
   *  paste button follows the FOCUS rather than the tab. */
  soundGroups: Record<SynthControlTarget, LoopCopyGroupId>;
  /** The MELODIC-scope depth (see `DepthScope` in `useSoundDepth.ts`): a
   *  synth preference held independently of Beat's, owned by SoundView, so
   *  going deep here never drags Beat's editor along with it. */
  depth: SoundDepth;
  /** Raised by the Simple deck's own "switch to Pro" footer invitation. */
  onDepth: (next: SoundDepth) => void;
}) {
  // The focused track's patch, its Arp and the writer for each. The five-way
  // routing lives in `useSynthChannel` now — it was a sixth hand-maintained
  // copy of the same table here.
  const channel = useSynthChannel(focusTrack);

  const browser = useSynthPresetBrowser(synthTarget);
  const overlays = useSynthOverlays({
    target: synthTarget,
    reloadPresets: browser.reloadPresets,
    onSaved: browser.adoptSavedPreset,
  });

  return (
    <>
      <SynthCard
        synthTarget={synthTarget}
        activeTab={activeTab}
        depth={depth}
        channel={channel}
        browser={browser}
        overlays={overlays}
        soundGroups={soundGroups}
        onSwitchToPro={() => onDepth("pro")}
      />

      <SynthQuickSaveOverlay overlays={overlays} />

      <SynthPresetDrawer
        overlays={overlays}
        synthTarget={synthTarget}
        showSoundBadges={depth === "pro"}
        onSelectPreset={browser.selectPreset}
        onSavedPreset={browser.adoptSavedPreset}
      />
    </>
  );
}
