# ADR-0042: Flat view nav — no layer switch on desktop

**Status:** Accepted — 2026-09-23. Amends [ADR-0040](0040-layout-shell.md) and
[ADR-0041](0041-mobile-frame.md).

## Context

The desktop Header navigated in two steps: a Loop/Song layer switch, then that layer's two tabs.
The switch remembered nothing. Crossing layers always landed on the layer's default tab
(`defaultTabForLayer`), so going from Sound to Master FX took two clicks. The phone frame
(ADR-0041, R318) had already dropped the switch: four tabs, with the tab implying the layer. The
two frames therefore taught two navigation models for one app.

## Decision

- The desktop Header renders all four views as `ViewNav`. It is two `HEADER_GROUP` joins,
  `LOOP_TABS` then `SONG_TABS`, in MobileTabBar's order. Each tab calls `setActiveTab`, and
  `layerForTab` derives the layer, just as it does on the phone. Neither frame has a layer switch.
- `ViewNav` sits in the Header's left group beside `ProjectMenu`, in the switch's old place, not
  in the right cluster. The subject run changes with the layer (loop picker and key on one side;
  project name, follow and export on the other), so tabs placed after it would move sideways on
  every layer crossing.
- The active tab takes the solid segmented fill (`btn-active btn-primary`). The soft fill existed
  to mark the tabs as children of the switch, and the switch is gone.
- Tab labels show from `lg` up, and only the icon shows below `lg`, for all four tabs. Removing the
  two switch buttons freed the width that the two added tabs need.
- The layer still shows at a glance through the subject run, which renders exactly one of the
  loop picker or the project name.

## Rejected alternatives

- Keeping the switch but making it remember each layer's last tab. This still costs two clicks
  whenever the target is not the remembered tab, and it would add a second piece of navigation
  state beside `activeTab`.
- A "Loop" and "Song" caption over each join. It costs header height, and the subject run already
  names the layer.
- Tabs after the subject run, in their old place. Their position would then depend on the layer.

## Consequences

- `LayerSwitcher`, `LAYER_META` and `layerToggleTarget` are deleted. Routing behaves as before;
  `tabsForLayer` is now private to `routing/tabRouting.ts`, whose `resolveRoute` is its only caller.
- ADR-0040's "structural, not tools" list now reads: `ProjectMenu` and the tab nav.

## Rules this implies

- **R322**: Desktop navigation is `ViewNav` in the Header's left group. It holds every view as
  `LOOP_TABS` and `SONG_TABS` joins, each tab calling `setActiveTab`, and the tab implies the
  layer. No frame renders a layer switch, and the tab nav never sits after a layer-gated tool run.

## Sources

The design discussion on branch `feat/mobile-arrange-rows`, and `src/components/Header.tsx`.
