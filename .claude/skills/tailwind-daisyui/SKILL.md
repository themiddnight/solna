---
name: tailwind-daisyui
description: Tailwind CSS v4 + daisyUI v5 UI framework reference for murva — CSS-first configuration, component recipes, responsive patterns, project conventions. Read before writing any UI markup, adding new components, or styling any TSX/JSX.
---

# Tailwind CSS v4 + daisyUI v5 — UI Framework Skill

Read every time before working on: any component UI markup, styling, layout, new component creation, or UI refactoring.

**Related Skills:** `responsive-mobile` (mobile-specific layouts + breakpoints)

**⚠️ i18n is mandatory (TR-35):** every user-facing string in markup goes through a Lingui macro — `<Trans>...</Trans>` for JSX text, `` t`...` `` (from `@lingui/core/macro`) for attribute values like `title`/`data-tip` and toast/label text. Bare literals are an ESLint **error**. See [`app/frontend/docs/I18N.md`](../../../app/frontend/docs/I18N.md).

**Versions in use:**
- **Tailwind CSS**: `^4.1.11` — CSS-first config, Oxide engine (Rust)
- **daisyUI**: `^5.0.46` — CSS plugin for Tailwind v4, 0 dependencies
- **Vite plugin**: `@tailwindcss/vite` — Tailwind v4 Vite integration

---

## 1. Configuration — How It's Set Up

### Single Source of Truth: `app/frontend/src/index.css`

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: all;
}

@utility kbd {
  @apply bg-black/10;
  @apply hidden lg:inline-block;
}

@utility card-body {
  @apply p-3;
}

@utility modal-box {
  @apply p-3 lg:p-4 xl:p-5;
}
```

### Vite Config

```typescript
// app/frontend/vite.config.ts
import tailwindcss from '@tailwindcss/vite';
// ...
plugins: [tailwindcss(), /* ... */]
```

### Key Differences from Tailwind v3

| v3 (Legacy — Do NOT Use) | v4 (Current) |
|---|---|
| `tailwind.config.js` / `tailwind.config.ts` | **No config file** — everything in CSS |
| `@tailwind base; @tailwind components; @tailwind utilities` | `@import "tailwindcss"` (one line) |
| Manual `content: [...]` paths | **Automatic content detection** from framework + `.gitignore` |
| `daisyui` in `plugins: [require("daisyui")]` | `@plugin "daisyui"` in CSS |
| JS-based `theme.extend` | CSS `@theme { }` block |
| `safelist: [...]` for dynamic classes | **Not needed** — v4 scans all files by default |

**⚠️ There is NO `tailwind.config.js` in this project.** All customization is done in `index.css` via `@theme`, `@utility`, `@plugin`, and daisyUI theme variables.

---

## 2. Tailwind CSS v4 — Core Concepts

### `@theme` — Design Tokens (replaces `tailwind.config.js`)

Define project-wide design tokens directly in CSS. Each namespace generates corresponding utility classes:

```css
@theme {
  /* Colors → bg-*, text-*, border-*, ring-*, etc. */
  --color-primary: oklch(0.60 0.18 250);
  --color-surface: oklch(0.97 0.005 240);

  /* Fonts → font-* */
  --font-display: "Inter", sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  /* Text sizes → text-* */
  --text-tiny: 0.625rem;

  /* Spacing → p-*, m-*, gap-*, w-*, h-* */
  --spacing-18: 4.5rem;

  /* Breakpoints → md:*, lg:*, etc. */
  --breakpoint-3xl: 1920px;

  /* Shadows → shadow-* */
  --shadow-glow: 0 0 20px rgba(59, 130, 246, 0.5);

  /* Border radius → rounded-* */
  --radius-pill: 9999px;
}
```

**Available namespaces:** `--color-*`, `--font-*`, `--text-*`, `--tracking-*`, `--leading-*`, `--spacing-*`, `--breakpoint-*`, `--shadow-*`, `--inset-shadow-*`, `--radius-*`, `--animate-*`, `--ease-*`

**`@theme inline`** — emits raw values instead of CSS variables (for smaller output when cascade isn't needed):

```css
@theme inline {
  --color-brand: oklch(0.60 0.18 250);
  /* Output: .bg-brand { background-color: oklch(0.60 0.18 250); } */
  /* NOT: .bg-brand { background-color: var(--color-brand); } */
}
```

### `@utility` — Custom Utility Classes (replaces `@layer utilities { ... }`)

Custom utilities get full variant support (responsive, hover, dark, focus, etc.). **This project uses `@utility` for daisyUI overrides.**

```css
/* Static utility */
@utility glass-surface {
  backdrop-filter: blur(16px);
  background: rgba(31, 31, 33, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* Functional utility with --value() */
@utility grid-cols-auto-* {
  grid-template-columns: repeat(--value(integer), minmax(0, 1fr));
}
/* Usage: class="grid-cols-auto-3" */
```

**`--value()` resolution types:**
| Type | Accepts | Example |
|---|---|---|
| `--value(integer)` | bare integers | `grid-cols-auto-3` |
| `--value(percentage)` | bare percentages | `opacity-fade-50` |
| `--value([length])` | arbitrary `[...]` form | `tab-[10rem]` |
| `--value(--color-*)` | color theme namespace | (rarely needed) |

### `@custom-variant` — Custom Variant Prefixes

Define new variant prefixes that work like `hover:`, `dark:`, `md:`, etc:

```css
@custom-variant dark (&:where(.dark, .dark *));
@custom-variant any-hover {
  @media (any-hover: hover) {
    &:hover { @slot; }
  }
}
```

### `@apply` — Inline Utility Classes in Custom CSS

Use `@apply` sparingly inside `@utility` blocks or custom component classes. Avoid in random CSS rules — prefer utility classes in HTML.

```css
/* ✅ OK — inside @utility for a reused pattern */
@utility kbd {
  @apply bg-black/10;
  @apply hidden lg:inline-block;
}

/* ❌ Avoid — unnecessary abstraction */
.my-custom-button {
  @apply btn btn-primary btn-sm;
  /* Just use class="btn btn-primary btn-sm" in HTML! */
}
```

### `@source` — Control File Scanning

Used when Tailwind v4's auto-detection misses something:

```css
@source "../node_modules/my-library";
@source inline("bg-red-500", "text-lg"); /* Force classes into bundle */
@source not "../legacy-folder";          /* Exclude directory */
```

### `@reference` — Import Without Injecting Styles

For CSS Modules or third-party stylesheets where you need Tailwind's variables but don't want to inject utilities:

```css
@reference "tailwindcss";
/* Now you can use theme() and @apply without duplicating Tailwind's output */
```

### OKLCH Colors (Preferred Format)

Tailwind v4 uses OKLCH internally. Prefer OKLCH for custom colors in this project:

```css
/* ✅ OKLCH — perceptually uniform, wide gamut */
--color-primary: oklch(0.60 0.18 250);

/* ✅ Also fine — simple hex/rgb */
--color-surface: #1a1a2e;

/* Use oklch.com or oklch.evilmartians.io to convert */
```

### v4 Breaking Changes (from v3)

If migrating existing components:

| Old (v3) | New (v4) |
|---|---|
| `shadow-sm` | `shadow-xs` |
| `shadow` | `shadow-sm` |
| `blur-sm` | `blur-xs` |
| `blur` | `blur-sm` |
| `ring` (1px) | `ring-3` |
| `outline-none` | `outline-hidden` (truly removed) |
| `text-opacity-50` | `text-black/50` |
| `ring-opacity-*` | `ring-black/50` |

---

## 3. daisyUI v5 — Component Library

### How It's Configured

daisyUI v5 is a **Tailwind CSS plugin** loaded via `@plugin`:

```css
@plugin "daisyui" {
  themes: all;  /* All 30+ themes available */
}
```

### murva Brand Themes & Room Colors (CI)

Three custom brand themes are defined in `index.css` via `@plugin "daisyui/theme"`:
- **`murva-dark`** — `default: true`, `prefersdark: true`. App default theme. Primary `#877dca` (CI dusk violet `#3d3a6b` lifted to ~5.3:1 contrast on the dark base; content is dark `#15132e`).
- **`murva-light`** — warm-white base `#faf8f5`, primary = CI `#3d3a6b`.
- **`murva-neutral`** — additional neutral theme (index.css L81-119).

They're registered in `src/shared/constants/themes.ts` (`DAISY_THEMES` + `DARK_THEMES`) and appear at the top of the ThemePicker. The default font is **Figtree** (Latin/UI) with **Anuphan** as Thai fallback, set via `@theme { --font-sans }` and loaded from Google Fonts in `index.html`.

**Room-identity colors are dedicated tokens — NOT `primary`/`secondary`.** Perform = coral pink, Arrange = cyan-teal. They are defined in `@theme` so they stay constant across *every* daisyUI theme (with a deeper override for light surfaces):

```css
@theme {
  --color-perform: #d846ac;  --color-perform-content: #2e0a22;
  --color-arrange: #35a5b6;  --color-arrange-content: #06262b;
}
```

This auto-generates `bg-perform`, `text-perform`, `border-perform` (and `-arrange`). For daisyUI component variants, custom `@utility` classes bind the same internal vars daisyUI reads:

```tsx
<span className="badge badge-perform">Perform</span>   {/* coral */}
<span className="badge badge-arrange">Arrange</span>   {/* cyan-teal */}
<button className="btn btn-perform">Create Jam Session</button>
<button className="btn btn-soft btn-arrange">…</button>   {/* soft/outline variants work too */}
<h2 className="text-perform">Perform</h2>
```

> **Rule:** When something represents a Perform or Arrange room (badge, header title, create-room button, room-switch button), use `*-perform` / `*-arrange` — never `*-primary` / `*-secondary`. The latter change per theme; room colors must not.

**v5 key changes from v4:**
- No `tailwind.config.js` needed — pure CSS plugin
- CSS variables renamed: `--p` → `--color-primary`, `--b1` → `--color-base-100`, `--bc` → `--color-base-content`
- `btn-group` → `join` (or `join-item`)
- `card-compact` → `card-sm`
- `btm-nav` → `dock`
- `tabs-bordered/lifted/boxed` → `tabs-border/tabs-lift/tabs-box`
- `form-control` → `fieldset`
- `avatar online/offline` → `avatar-online/avatar-offline`
- All sizes now support `xl`: `btn-xs btn-sm btn-md btn-lg btn-xl`
- New components: `status`, `filter`, `fieldset`, `list`, `stack`, `calendar`, `validator`
- New styles: `soft` and `dash` variants on buttons/badges/alerts
- Responsive component modifiers: `md:btn-sm lg:btn-lg`

### daisyUI CSS Variables (v5 Naming)

The theme system exposes readable CSS variables:

```css
/* Color variables available on every element */
--color-primary          /* Primary brand color */
--color-primary-content  /* Text on primary background */
--color-secondary
--color-secondary-content
--color-accent
--color-accent-content
--color-neutral
--color-neutral-content
--color-base-100         /* Page background */
--color-base-200         /* Card background */
--color-base-300         /* Border / elevated */
--color-base-content     /* Default text color */
--color-info / --color-info-content
--color-success / --color-success-content
--color-warning / --color-warning-content
--color-error / --color-error-content

/* Sizing */
--size-field    /* Input/select height */
--size-selector /* Toggle/checkbox size */
--border        /* Global border width */
--radius-field  /* Input border radius */
--radius-box    /* Card/modal border radius */
--radius-selector /* Toggle/checkbox radius */

/* Effects */
--depth  /* Subtle shadow depth (new in v5) */
--noise  /* Textured look (new in v5) */
```

**Using daisyUI variables in Tailwind arbitrary values:**

```tsx
<div className="bg-[var(--color-base-200)] text-[var(--color-base-content)]">
  <div className="shadow-[var(--depth)]">
</div>
```

---

## 4. Component Reference — daisyUI Classes Used in This Project

Every daisyUI component in murva. Listed by usage frequency (high → low):

### Button (`btn`) — ~1340 usages

```tsx
// Sizes
<button className="btn btn-xs">...</button>   // Extra small
<button className="btn btn-sm">...</button>   // Small (most common)
<button className="btn btn-md">...</button>   // Medium (default)
<button className="btn btn-lg">...</button>   // Large
<button className="btn btn-xl">...</button>   // Extra large (v5 new)

// Variants
<button className="btn btn-primary">Primary</button>
<button className="btn btn-secondary">Secondary</button>
<button className="btn btn-accent">Accent</button>
<button className="btn btn-neutral">Neutral</button>
<button className="btn btn-ghost">Ghost</button>
<button className="btn btn-outline">Outline</button>
<button className="btn btn-soft">Soft (v5)</button>
<button className="btn btn-dash">Dashed (v5)</button>
<button className="btn btn-success">Success</button>
<button className="btn btn-warning">Warning</button>
<button className="btn btn-error">Error</button>
<button className="btn btn-info">Info</button>

// Shapes
<button className="btn btn-circle">○</button>
<button className="btn btn-square">□</button>

// States
<button className="btn btn-disabled" disabled>Disabled</button>
<button className="btn btn-active">Active</button>
```

**Project patterns for buttons:**

```tsx
// Pattern: Icon + compact label (responsive)
<button className="btn btn-xs join-item">
  <Icon icon={tab.icon} />
  <span className="hidden sm:inline">{tab.label}</span>
</button>

// Pattern: Active tab in button group
<button className={`btn btn-xs join-item ${active ? "btn-primary" : "btn-ghost"}`}>

// Pattern: Ghost square icon button
<button className="btn btn-ghost btn-sm btn-square">
  <Icon icon="mdi:close" />
</button>

// Pattern: Mobile-responsive button size
<button className="btn btn-xs sm:btn-sm">Action</button>
```

### Select (`select`) — ~866 usages

```tsx
<select className="select select-bordered select-xs sm:select-sm w-full max-w-xs">
  <option>Option 1</option>
</select>

// Sizes: select-xs | select-sm | select-md | select-lg | select-xl
// Variants: select-bordered | select-ghost | select-soft | select-dash
// Note: `select-companion-style` is an i18n ariaLabel (CompanionQuickSettings), not a daisyUI class
```

### Label (`label`) — ~838 usages

```tsx
<label className="label">
  <span className="label-text">Label</span>
  <span className="label-text-alt">Alt text</span>
</label>

// v5: floating labels
<label className="floating-label">
  <input className="input" placeholder="name@example.com" />
  <span>Email</span>
</label>
```

### Range (`range`) — ~835 usages

```tsx
<input type="range" className="range range-primary range-xs sm:range-sm" />

// Sizes: range-xs | range-sm | range-md | range-lg
// Colors: range-primary | range-secondary | range-accent | range-success | etc.
```

**Project pattern (responsive range):**

```tsx
<input type="range" className="range range-xs sm:range-sm" />
```

### Stat (`stat`) — ~758 usages

```tsx
<div className="stat">
  <div className="stat-title">Title</div>
  <div className="stat-value">Value</div>
  <div className="stat-desc">Description</div>
  <div className="stat-actions">
    <button className="btn btn-sm">Action</button>
  </div>
</div>
```

### Input (`input`) — ~406 usages

```tsx
<input className="input input-bordered input-sm w-full max-w-xs" />

// Sizes: input-xs | input-sm | input-md | input-lg | input-xl
// Variants: input-bordered | input-ghost | input-soft | input-dash
// With validator (v5): input-success | input-warning | input-error
```

### Card (`card`) — ~302 usages

```tsx
<div className="card bg-base-100 card-border shadow-sm">
  <div className="card-body">              {/* @utility override: p-3 */}
    <h2 className="card-title">Title</h2>
    <p>Content</p>
    <div className="card-actions">
      <button className="btn btn-primary">Action</button>
    </div>
  </div>
</div>

// v5: card-border (replaces card-bordered)
// v5: card-sm | card-md | card-lg | card-xl (replaces card-compact)
// Sizes control padding preset
```

**Project override:** `@utility card-body { @apply p-3; }` — reduces default daisyUI card padding.

### Badge (`badge`) — ~211 usages

```tsx
<span className="badge badge-primary badge-sm">Label</span>

// Sizes: badge-xs | badge-sm | badge-md | badge-lg | badge-xl
// Variants: badge-primary | badge-secondary | badge-accent | badge-neutral
//           badge-success | badge-warning | badge-error | badge-info
//           badge-ghost | badge-outline | badge-soft | badge-dash
```

### Toggle (`toggle`) — ~194 usages

```tsx
<input type="checkbox" className="toggle toggle-primary toggle-sm" />

// Sizes: toggle-xs | toggle-sm | toggle-md | toggle-lg | toggle-xl
// Colors: toggle-primary | toggle-secondary | toggle-accent | etc.
// v5: custom icon support via CSS
```

### Join (`join`) — ~186 usages

```tsx
// Groups buttons/inputs together without gaps
<div className="join">
  <button className="btn btn-xs join-item">1</button>
  <button className="btn btn-xs join-item btn-primary">2</button>
</div>
```

**Key rule:** Every child of `.join` MUST have `.join-item`.

### KBD (`kbd`) — ~168 usages

```tsx
<kbd className="kbd kbd-sm">⌘K</kbd>
// Sizes: kbd-xs | kbd-sm | kbd-md | kbd-lg
```

**Project override:** `@utility kbd { @apply bg-black/10; @apply hidden lg:inline-block; }`

### Modal (`modal`) — ~158 usages

```tsx
<dialog className="modal" open>
  <div className="modal-box">  {/* @utility override: p-3 lg:p-4 xl:p-5 */}
    <h3 className="text-lg font-bold">Title</h3>
    <p>Content</p>
    <div className="modal-action">
      <button className="btn">Close</button>
    </div>
  </div>
</dialog>
```

**v5 new positioning:** `modal-top` | `modal-bottom` | `modal-start` | `modal-end` | `modal-middle` (default)

**Project override:** `@utility modal-box { @apply p-3 lg:p-4 xl:p-5; }` — responsive padding.

### Alert (`alert`) — ~135 usages

```tsx
<div className="alert alert-error">
  <Icon icon="mdi:alert-circle" />
  <span>Error message</span>
</div>

// Variants: alert-info | alert-success | alert-warning | alert-error
// v5: alert-soft | alert-outline | alert-dash
```

### Filter (`filter`) — ~121 usages (new in v5)

```tsx
<div className="filter">
  <input className="btn btn-square" type="radio" name="filter" aria-label="Option A" />
  <input className="btn btn-square" type="radio" name="filter" aria-label="Option B" />
</div>
```

### Checkbox (`checkbox`) — ~82 usages

```tsx
<input type="checkbox" className="checkbox checkbox-primary checkbox-sm" />

// Sizes: checkbox-xs | checkbox-sm | checkbox-md | checkbox-lg | checkbox-xl
// Colors: checkbox-primary | checkbox-secondary | checkbox-accent | etc.
```

### Progress (`progress`) — ~67 usages

```tsx
<progress className="progress progress-primary w-56" value="40" max="100" />

// Colors: progress-primary | progress-secondary | progress-accent | etc.
// Indeterminate: omit `value` attribute
```

### Dropdown (`dropdown`) — ~54 usages

```tsx
<div className="dropdown dropdown-end">
  <button tabIndex={0} className="btn btn-ghost btn-sm btn-square">☰</button>
  <div tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52">
    <li><a>Item 1</a></li>
  </div>
</div>

// Positions: dropdown-end | dropdown-top | dropdown-bottom | dropdown-left | dropdown-right
// v5: uses Popover API + Anchor Positioning
```

### Tooltip (`tooltip`) — ~52 usages

```tsx
<div className="tooltip tooltip-bottom" data-tip="Tooltip text">
  <button className="btn">Hover me</button>
</div>

// Positions: tooltip-top | tooltip-bottom | tooltip-left | tooltip-right
// v5: tooltip-content class for richer content
```

### Table (`table`) — ~51 usages

```tsx
<table className="table table-xs sm:table-md">
  <thead>
    <tr><th>Name</th></tr>
  </thead>
  <tbody>
    <tr><td>Row</td></tr>
  </tbody>
</table>

// Sizes: table-xs | table-sm | table-md | table-lg | table-xl
// Variants: table-zebra | table-pin-rows | table-pin-cols
```

### Collapse (`collapse`) — ~49 usages

```tsx
<div className="collapse collapse-arrow bg-base-200">
  <input type="checkbox" />
  <div className="collapse-title text-lg font-medium">Title</div>
  <div className="collapse-content">
    <p>Expanded content</p>
  </div>
</div>

// Variants: collapse-arrow | collapse-plus | collapse-open (no toggle)
```

### Divider (`divider`) — ~44 usages

```tsx
<div className="divider">OR</div>
<div className="divider divider-horizontal" />
// Colors: divider-primary | divider-secondary | etc.
// Positions: divider-start | divider-end
```

### Skeleton (`skeleton`) — ~44 usages

```tsx
<div className="skeleton h-4 w-28" />
<div className="skeleton h-32 w-full" />
```

### Status (`status`) — ~42 usages (new in v5)

```tsx
<span className="status status-success" />
<span className="status status-error" />
<span className="status status-warning" />

// Sizes: status-xs | status-sm | status-md | status-lg | status-xl
// Colors: status-primary | status-secondary | etc.
```

### Chat (`chat`) — ~34 usages

```tsx
<div className="chat chat-start">
  <div className="chat-bubble">Message</div>
  <div className="chat-footer">12:30</div>
</div>

// Positions: chat-start | chat-end
```

### Menu (`menu`) — ~23 usages

```tsx
<ul className="menu bg-base-200 rounded-box w-56">
  <li><a>Item 1</a></li>
  <li className="menu-title">Section</li>
  <li><a>Item 2</a></li>
</ul>

// Sizes: menu-xs | menu-sm | menu-md | menu-lg | menu-xl
// Variants: menu-horizontal | menu-vertical
// v5: menu-disabled | menu-active | menu-focus (replaces disabled/active/focus)
```

### Swap (`swap`) — ~24 usages

```tsx
<label className="swap swap-rotate">
  <input type="checkbox" />
  <Icon className="swap-on" icon="mdi:eye" />
  <Icon className="swap-off" icon="mdi:eye-off" />
</label>

// Variants: swap-rotate | swap-flip
// v5: swap-active for programmatic control
```

### Fieldset (`fieldset`) — ~13 usages (new in v5, replaces `form-control`)

```tsx
<fieldset className="fieldset">
  <legend className="fieldset-legend">Label</legend>
  <input className="input input-bordered" />
  <p className="fieldset-label">Helper text</p>
</fieldset>
```

### Steps (`steps`) — ~48 usages

```tsx
<ul className="steps">
  <li className="step step-primary">Step 1</li>
  <li className="step step-primary">Step 2</li>
  <li className="step">Step 3</li>
</ul>

// Variants: steps-horizontal | steps-vertical
```

### Dock (`dock`) — ~7 usages

```tsx
<div className="dock dock-md bg-base-300">
  <button className="dock-active">
    <Icon icon="mdi:music" />
    <span className="dock-label">Music</span>
  </button>
</div>

// Sizes: dock-xs | dock-sm | dock-md | dock-lg | dock-xl
// v5: replaces btm-nav (btm-nav → dock, btm-nav-label → dock-label)
```

### Drawer (`drawer`) — ~3 usages

```tsx
<div className="drawer">
  <input id="drawer" type="checkbox" className="drawer-toggle" />
  <div className="drawer-content"><!-- Page content --></div>
  <div className="drawer-side">
    <label htmlFor="drawer" className="drawer-overlay" />
    <ul className="menu p-4"><!-- Sidebar --></ul>
  </div>
</div>
```

### Additional Components Used

| Component | Usages | Quick Reference |
|---|---|---|
| Textarea | 31 | `textarea textarea-bordered textarea-sm` |
| Indicator | 29 | `indicator indicator-top indicator-start` |
| Radio | 25 | `radio radio-primary radio-sm` |
| Avatar | 18 | `avatar avatar-online avatar-offline` (v5) |
| Stack | 12 | `stack` (new v5 CSS grid layout) |
| Countdown | 12 | `countdown` |
| Diff | 13 | `diff` |
| Rating | 6 | `rating rating-sm rating-half` |
| Breadcrumb | 7 | `breadcrumb` |
| Timeline | (v5) | New component, not yet used in project |

---

## 5. Project Composition Patterns

These are the way Tailwind + daisyUI classes are combined in murva components.

### Pattern 1: daisyUI Component + Tailwind Sizing

```tsx
// daisyUI gives the component identity, Tailwind gives sizing/positioning
<button className="btn btn-sm btn-ghost btn-square relative">
<select className="select select-bordered select-xs w-full max-w-xs">
<input className="input input-bordered input-sm w-32" />
<table className="table table-xs sm:table-md w-full">
```

### Pattern 2: Responsive daisyUI Sizes

```tsx
// daisyUI sizes can be responsive
<button className="btn btn-xs sm:btn-sm">Action</button>
<input type="range" className="range range-xs sm:range-sm" />
<select className="select select-xs sm:select-sm">
<span className="badge badge-xs sm:badge-sm">

// ⚠️ This is a daisyUI v5 feature — responsive component modifiers
```

### Pattern 3: daisyUI Color + Tailwind Layout

```tsx
// daisyUI: color/identity | Tailwind: grid/flex/width/height/spacing
<div className="card bg-base-100 shadow-sm w-full max-w-md">
<div className="modal-box p-3 lg:p-4 xl:p-5">
  {/* modal-box = daisyUI, p-3 = tailwind, lg:p-4 = responsive tailwind */}
```

### Pattern 4: Join Group (Button Bar)

```tsx
<div className="join">
  <button className="btn btn-xs join-item">1</button>
  <button className="btn btn-xs join-item btn-primary">2</button>
</div>
// Every child must have join-item
// Use shrink-0 on individual items to prevent them from narrowing
```

### Pattern 5: Compact Labels (Icon + Responsive Text)

```tsx
<button className="btn btn-xs join-item">
  <Icon icon={tab.icon} className="w-5 h-5" />
  <span className="hidden sm:inline">{label}</span>       {/* Full text on tablet+ */}
  <span className="sm:hidden">{shortLabel}</span>          {/* Short on mobile */}
</button>
```

### Pattern 6: Base Colors for Sections

```tsx
// Use daisyUI CSS variable colors for section backgrounds
<div className="bg-base-200 rounded-box p-4">
  <div className="bg-base-300 p-2 rounded">Inner</div>
</div>

// Semantic colors for status
<div className="alert alert-error bg-error/10">
<progress className="progress progress-primary" />
<span className="badge badge-success">Online</span>
```

### Pattern 7: Conditional daisyUI Active State

```tsx
// Toggle between active/inactive visual styles
<button className={`btn btn-xs join-item ${active ? "btn-primary" : "btn-ghost"}`}>

<button className={activeTab ? "dock-active" : ""}>

<input className={`checkbox ${enabled ? "checkbox-primary" : ""}`} />
```

### Pattern 8: Touch-Ready Interactive Elements

```tsx
// Always combine with touch-manipulation for musical elements
<button className="btn btn-sm touch-manipulation">
  <Icon icon={instrument.icon} />
</button>

// For instrument surfaces use pointer events + touch-manipulation
<div className="touch-manipulation" onPointerDown={start} onPointerUp={end}>
```

---

## 6. Responsive Design with Tailwind + daisyUI

### Breakpoint Reference (from `responsive-mobile` skill)

| Name | Tailwind Prefix | Width | Typical daisyUI Sizes |
|---|---|---|---|
| Base (mobile) | *(none)* | `< 720px` | `btn-xs`, `select-xs`, `range-xs` |
| Tablet | `sm:` | `≥ 640px` | `btn-sm`, `select-sm` |
| Medium/Tablet-L | `md:` | `≥ 720px` | `btn-md`, `modal` appears |
| Desktop | `lg:` | `≥ 1024px` | `btn-lg`, sidebar expands |
| XL Desktop | `xl:` | `≥ 1280px` | Sidebar + panels |
| 2XL | `2xl:` | `≥ 1536px` | Rarely used |

### Responsive Utility Cheatsheet

```
# Visibility
hidden sm:block          → show only on tablet+
hidden lg:block          → show only on desktop
block sm:hidden          → show only on mobile

# daisyUI size scaling
btn-xs sm:btn-sm         → responsive button size
select-xs sm:select-sm   → responsive select
range-xs sm:range-sm     → responsive range
badge-xs sm:badge-sm     → responsive badge
table-xs sm:table-md     → responsive table

# Layout
flex-col sm:flex-row     → stack → row
grid-cols-1 sm:grid-cols-2 lg:grid-cols-3  → responsive grid
w-full sm:w-auto         → full width → auto
p-2 sm:p-4               → responsive spacing
gap-1 sm:gap-2           → responsive gaps
```

### Dynamic Viewport Height

Always use `dvh` for full-screen mobile layouts (not `vh`):

```tsx
// ✅ Correct
<div className="h-dvh min-h-dvh">

// ❌ Wrong — overflows on mobile
<div className="h-screen min-h-screen">
```

### Container Queries (Tailwind v4)

```html
<div class="@container">
  <div class="@md:grid-cols-2 @lg:grid-cols-3">...</div>
</div>
```

---

## 7. Customizing daisyUI Themes

### Project Overrides via `@utility` (in `index.css`)

Current overrides in this project:

```css
@utility kbd {
  @apply bg-black/10;
  @apply hidden lg:inline-block;
}

@utility card-body {
  @apply p-3;  /* Smaller default card padding */
}

@utility modal-box {
  @apply p-3 lg:p-4 xl:p-5;  /* Responsive modal padding */
}
```

### How to Add New Overrides

When daisyUI defaults don't match the design:

```css
/* Add to app/frontend/src/index.css */

/* Custom button variant */
@utility btn-companion {
  @apply bg-[var(--color-secondary)] text-[var(--color-secondary-content)]
         hover:bg-[var(--color-secondary)]/80;
}

/* Tighter spacing utility for dense UI */
@utility card-body-dense {
  @apply p-2;
}
```

### Using a Specific daisyUI Theme

```css
@plugin "daisyui" {
  themes: light --default, dark --prefersdark;  /* Only these 2 */
  /* OR */
  themes: all;  /* All 30+ themes (current project setting) */
}
```

**Theme switching** is handled by setting `data-theme="themeName"` on `<html>`:

```js
document.documentElement.setAttribute('data-theme', 'dark');
```

---

## 8. Tailwind v4 Arbitrary Values

When you need a one-off value not in the design system:

```tsx
// Sizing
<div className="w-[17rem] h-[calc(100%-2rem)]" />

// Colors with opacity
<div className="bg-[#1a1a2e]/80 text-[var(--color-primary)]" />

// Grid
<div className="grid-cols-[repeat(auto-fill,minmax(200px,1fr))]" />

// Shadows
<div className="shadow-[0_0_20px_rgba(59,130,246,0.5)]" />

// Using daisyUI CSS variables in arbitrary values
<div className="bg-[var(--color-base-200)]" />
<div className="shadow-[var(--depth)]" />

// Custom spacing
<div className="p-[env(safe-area-inset-top)]" />

// Combined
<MobileFloatingHUD className="pt-[calc(44px+env(safe-area-inset-top)+4px)]" />
```

**⚠️ Caution:** If an arbitrary value is used more than 3 times → consider adding it as a `@utility` or `@theme` token.

---

## 9. daisyUI v5 "Soft" and "Dash" Variants (New)

New in v5 — softer visual alternatives to `outline`:

```tsx
<button className="btn btn-soft btn-primary">Soft</button>
<button className="btn btn-dash btn-primary">Dashed</button>

<button className="btn btn-soft btn-error">Soft Error</button>

<span className="badge badge-soft badge-success">Soft</span>
<span className="badge badge-dash badge-warning">Dash</span>

<div className="alert alert-soft alert-info">Soft alert</div>
<div className="alert alert-dash alert-success">Dashed alert</div>
```

**When to use:**
- `btn-soft` — secondary actions that should not draw attention (settings, tools)
- `btn-dash` — add/create actions (weaker than primary, stronger than ghost)
- `btn-outline` — primary emphasis (stronger than dash)

---

## 10. Tooling & Dev Workflow

### Vite HMR

Tailwind v4 Oxide engine recompiles in < 1 second. Vite HMR is near-instant for class changes.

### Inspecting daisyUI Theme Variables

In browser DevTools → Elements → Styles, inspect any element to see the daisyUI CSS variables (`--color-primary`, `--color-base-100`, etc.). These are set by the active theme.

### Build

```bash
bun run --cwd app/frontend dev     # Dev server with HMR
bun run --cwd app/frontend build   # Production build (tree-shaken)
```

### Adding New daisyUI Dependencies

```bash
cd app/frontend
bun add tailwindcss daisyui @tailwindcss/vite
```

---

## 11. Anti-Patterns & Common Mistakes

| # | What | Why It's Wrong | Do This Instead |
|---|---|---|---|
| 1 | **`@apply btn btn-primary` in custom CSS** | Unnecessary abstraction — just use classes in HTML | `className="btn btn-primary"` directly on the element |
| 2 | **Overriding daisyUI with `!important`** | Breaks specificity chain, hard to debug | Use CSS layer order or a more specific daisyUI modifier |
| 3 | **Mixing `join` without `join-item`** | Gaps appear between joined elements | Every child of `.join` must have `.join-item` |
| 4 | **Using `card-bordered` (v4 class name)** | Doesn't work in daisyUI v5 | Use `card-border` |
| 5 | **Using `btm-nav` (v4 class name)** | Removed in daisyUI v5 | Use `dock` component |
| 6 | **Using `form-control` (v4 class name)** | Removed in daisyUI v5 | Use `fieldset` component |
| 7 | **Using `disabled` / `active` / `focus` as direct menu classes (v4)** | Changed in daisyUI v5 | Use `menu-disabled` / `menu-active` / `menu-focus` |
| 8 | **Creating `tailwind.config.js`** | Tailwind v4 is CSS-first — config file is ignored | Everything in `index.css` via `@theme` / `@utility` |
| 9 | **`h-screen` instead of `h-dvh` on mobile** | Overflows on mobile (browser bars not subtracted) | Use `h-dvh min-h-dvh` |
| 10 | **Not using responsive daisyUI sizes** | Mobile gets oversized components | `btn-xs sm:btn-sm`, `range-xs sm:range-sm` |
| 11 | **Using v3 shadow/blur class names** | v4 renamed them | `shadow-sm → shadow-xs`, `blur-sm → blur-xs`, etc. |
| 12 | **Hardcoding colors instead of daisyUI variables** | Breaks theme switching (light/dark) | Use `bg-base-200`, `text-base-content`, etc. |
| 13 | **Copy-pasting component classes without understanding** | Leads to mismatched daisyUI v4/v5 classes | Check this skill's component reference first |
| 14 | **Using `avatar online` class pattern** | v5 changed to `avatar-online` | Use `avatar-online` / `avatar-offline` |
| 15 | **Using `tabs-bordered` / `tabs-lifted` / `tabs-boxed`** | v5 renamed these | Use `tabs-border` / `tabs-lift` / `tabs-box` |

---

## 12. Quick Decision Reference

### Which daisyUI component to use?

| Need | Use |
|---|---|
| Primary action button | `btn btn-primary` |
| Secondary action | `btn btn-outline` or `btn btn-ghost` |
| Destructive action | `btn btn-error` |
| Icon-only button | `btn btn-square` or `btn btn-circle` |
| Button group | `div.join` + `button.btn.join-item` |
| Form input | `input input-bordered` |
| Dropdown select | `select select-bordered` |
| Toggle switch | `toggle toggle-primary` |
| Single checkbox | `checkbox checkbox-primary` |
| Range slider | `range range-primary` |
| Status indicator | `badge` or `status` |
| Card container | `card bg-base-100 card-border` |
| Modal/dialog | `dialog.modal` + `div.modal-box` |
| Alert/notification | `div.alert alert-info` |
| Tooltip on hover | `div.tooltip` with `data-tip` |
| Progress bar | `progress progress-primary` |
| Loading skeleton | `div.skeleton` |
| Bottom navigation | `div.dock` |
| Sidebar drawer | `div.drawer` |
| Data table | `table.table` |
| Expandable section | `div.collapse` |
| Visual separator | `div.divider` |
| Tabs | `div.tabs` + `a.tab` |
| Steps/wizard | `ul.steps` + `li.step` |
| Chat messages | `div.chat` + `div.chat-bubble` |

### When to use Tailwind vs daisyUI?

| Styling Need | Use |
|---|---|
| Layout (flex, grid, position) | **Tailwind** |
| Sizing (w, h, min/max) | **Tailwind** |
| Spacing (p, m, gap) | **Tailwind** |
| Typography (font, text size, weight) | **Tailwind** |
| Colors / backgrounds | **daisyUI variables** (`bg-base-200`) + Tailwind utilities |
| Component identity (button, card, modal) | **daisyUI** component classes |
| Component variant (primary, outline, ghost) | **daisyUI** modifier classes |
| Component size (xs, sm, md, lg) | **daisyUI** size classes |
| Responsive breakpoints | **Tailwind** prefixes (`sm:`, `lg:`) |
| Border radius | **Tailwind** (`rounded`, `rounded-box`) |
| Shadows | **daisyUI** (`shadow-sm`) or Tailwind arbitrary |
| Custom one-off values | **Tailwind** arbitrary (`w-[17rem]`) |

---

## 13. File Reference Map

### Core Configuration

| File | Purpose |
|---|---|
| `app/frontend/src/index.css` | **Single source of truth** — Tailwind import, daisyUI plugin, `@utility` overrides |
| `app/frontend/vite.config.ts` | `@tailwindcss/vite` plugin registration |
| `app/frontend/package.json` | `tailwindcss`, `daisyui`, `@tailwindcss/vite` versions |

### Global Styles

| File | Content |
|---|---|
| `index.css` L1-2 | `@import "tailwindcss"` + `@plugin "daisyui"` |
| `index.css` L393 | `@utility kbd` — KBD display override |
| `index.css` L398 | `@utility card-body` — card padding override |
| `index.css` L402 | `@utility modal-box` — modal responsive padding |
| `index.css` L418 | `.touch-manipulation` — touch-optimized interactive class |
| `index.css` L483 | `.animate-marquee` — custom marquee animation |

### Project Components Using daisyUI Heavily

| Component | daisyUI Components Used |
|---|---|
| `MobileDock.tsx` | `dock`, `dock-active`, `dock-label` |
| `MobileFloatingHUD.tsx` | `btn`, `badge` |
| `SplitTabWorkspaceShell.tsx` | `btn`, `join`, `join-item` |
| `SidebarShell.tsx` | `btn`, `sidebar` |
| `MobileBottomSheet.tsx` | `btn` |
| `ChatBox.tsx` | `btn`, `input`, `chat` |
| `MoveToArrangeModal.tsx` | `btn`, `modal` |
| `InviteDropdown.tsx` | `btn`, `dropdown`, `menu` |
| `UserActionsMenu.tsx` | `btn`, `menu` |

---

## 14. Quick Reference Card

```
TAILWIND CSS v4:
  Config: CSS-first — @import "tailwindcss" in index.css
  No config file: Everything via @theme / @utility / @plugin
  Engine: Oxide (Rust) — <1s HMR
  Content detection: Automatic from .gitignore
  Colors: Prefer OKLCH — oklch(L C H)
  Custom utilities: @utility name { ... }
  Custom variants: @custom-variant name (&:where(...))
  Arbitrary values: w-[17rem] bg-[var(--color-primary)]
  v3→v4: shadow-sm→shadow-xs, blur-sm→blur-xs, outline→outline-hidden

DAISYUI v5:
  Config: @plugin "daisyuri" { themes: all; }
  Zero deps, CSS variables: --color-primary not --p
  v4→v5: btn-group→join, btm-nav→dock, card-bordered→card-border
  v4→v5: form-control→fieldset, tabs-bordered→tabs-border
  v4→v5: avatar online→avatar-online, menu disabled→menu-disabled
  New: soft/dash variants, xl size, filter/status/fieldset/stack components
  New: --depth and --noise effect variables
  Responsive component sizes: md:btn-sm lg:btn-lg

PROJECT-SPECIFIC:
  @utility overrides: kbd, card-body, modal-box (in index.css)
  All daisyUI themes available: themes: all
  Most used components: btn, select, label, range, stat, input, card
  Touch elements: Always add touch-manipulation class
  Mobile: dvh not vh, responsive daisyUI sizes (xs sm:sm)
  Colors: Prefer daisyUI vars (base-100, base-content) over hardcoded colors
  Canvas (Konva): colors come from useCanvasPalette, never hardcoded hex → docs/CANVAS_COLORS.md

RELATED SKILLS:
  responsive-mobile → breakpoints, safe areas, mobile/desktop layouts
```
