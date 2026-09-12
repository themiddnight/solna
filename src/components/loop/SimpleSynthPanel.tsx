import React from "react";
import { Sparkles, Sun, Flame, Waves, Compass, type LucideIcon } from "lucide-react";
import { SynthParams } from "@/types";
import { Knob } from "../ui/Knob";
import type { KnobColor } from "../ui/Knob";
import { PanelCard } from "../ui/PanelCard";

interface SimpleSynthPanelProps {
  params: SynthParams;
  onChangeParams: (params: SynthParams) => void;
}

/** What one macro dial reads out: the value it shows and the phrase under it. */
interface MacroReading {
  value: number;
  descriptor: string;
}

/** The Simple view's four readings, keyed by the macro they belong to. */
interface MacroReadings {
  tone: MacroReading;
  space: MacroReading;
  vibe: MacroReading;
  punch: MacroReading;
}

/**
 * The three-band phrase every macro uses: below `low`, below `high`, above.
 *
 * The four macros were four nested ternaries with the same shape, which is
 * exactly the sort of thing where one band's edge drifts and nothing catches
 * it — the phrasing IS the behaviour of this view.
 */
function describe(
  value: number,
  low: number,
  high: number,
  under: string,
  mid: string,
  over: string,
): string {
  if (value < low) return under;
  if (value < high) return mid;
  return over;
}

/**
 * The Simple view's four macro readings.
 *
 * Pure and exported: each macro stands in for a group of Pro-mode parameters
 * with a pair of thresholds, so what this view actually does is decide a value
 * and name it — testable without a DOM, and readable without the markup around
 * it. Each `?? default` is the macro's own resting value for a patch that has
 * never carried that parameter.
 */
export function simpleMacroReadings(params: SynthParams): MacroReadings {
  const cutoffValue = params.filterCutoff ?? 4000;
  const releaseValue = params.release ?? 0.3;
  const detuneValue = params.detune ?? 10;
  const subValue = params.subOscVolume ?? 0.2;

  return {
    tone: {
      value: cutoffValue,
      descriptor: describe(cutoffValue, 1800, 5500, "Deep & Warm", "Balanced Tone", "Bright & Crisp"),
    },
    space: {
      value: releaseValue,
      descriptor: describe(releaseValue, 0.18, 0.8, "Tight & Punchy", "Natural Tail", "Lush & Dreamy"),
    },
    vibe: {
      value: detuneValue,
      descriptor: describe(detuneValue, 8, 25, "Clean & Solid", "Stereo Shimmer", "Wavy & Lush"),
    },
    punch: {
      value: subValue,
      descriptor: describe(subValue, 0.15, 0.5, "Smooth / Light", "Balanced Punch", "Heavy Sub Power"),
    },
  };
}

interface MacroDialCardProps {
  id: string;
  /** The macro's name, shown beside its icon. */
  title: string;
  /**
   * The `module-*` identity token. It tints the icon, the name and the dial at
   * once — the three are one colour, which is why it is a token rather than
   * three class strings that have to agree.
   */
  tone: KnobColor;
  Icon: LucideIcon;
  reading: MacroReading;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

/**
 * One macro dial and its caption. What differs between the four is what they
 * WRITE, and that stays at the call site: Space also moves `sustain`, Vibe
 * also moves `lfoDepth`, Punch clamps `attack` — three different edits that
 * only look alike because each dial happens to be drawn the same way.
 */
function MacroDialCard({
  id,
  title,
  tone,
  Icon,
  reading,
  min,
  max,
  step,
  format,
  onChange,
}: MacroDialCardProps) {
  return (
    <PanelCard inset>
      <div className="card-body p-3 flex flex-col items-center justify-between text-center">
        <div className="flex items-center gap-1 text-xs font-bold text-base-content">
          <Icon className={`w-3.5 h-3.5 ${tone}`} />
          <span>{title}</span>
        </div>

        <div className="my-1.5">
          <Knob
            id={id}
            label=""
            color={tone}
            descriptor={reading.descriptor}
            value={reading.value}
            min={min}
            max={max}
            step={step}
            format={format}
            onChange={onChange}
          />
        </div>
      </div>
    </PanelCard>
  );
}

/**
 * The 1-Click Easy Arpeggiator card.
 *
 * The only macro card that does not go through `PanelCard`: it keeps its own
 * `module-arp` border, and a border colour passed alongside the shell's
 * `border-base-300` would be two utilities setting one property — decided by
 * stylesheet order, not by the order they are written here. It wears the
 * recessed surface by hand instead, so it still sits level with the four
 * beside it inside the Synth section.
 *
 * Its two join-rows are deliberately NOT one component: the rate row's
 * read-out repeats its buttons' own text in a `tabular-nums` cell, the mode
 * row's shows the stored word in a `capitalize` one while the buttons carry
 * arrows, and the mode row's wrapper drops the `my-1.5` the other two carry.
 */
function EasyArpCard({ params, onChangeParams }: SimpleSynthPanelProps) {
  const arpOn =
    "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]";

  return (
    <div
      className="col-span-2 sm:col-span-1 lg:col-span-1 card bg-base-200 border border-module-arp/30"
    >
      <div className="card-body p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-base-300 pb-1.5">
          <span className="text-xs font-bold text-module-arp flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-module-arp" />
            Auto-Arp
          </span>
          <button
            id="btn-simple-toggle-arp"
            onClick={() => {
              onChangeParams({
                ...params,
                arpActive: !params.arpActive,
              });
            }}
            className={`btn btn-xs rounded-full text-[10px] font-bold uppercase ${
              params.arpActive ? arpOn : "btn-outline"
            }`}
          >
            {params.arpActive ? "ON" : "OFF"}
          </button>
        </div>

        {/* Arp Speed Selector */}
        <div className="space-y-1 my-1.5">
          <div className="flex items-center justify-between text-[10px] text-base-content/60">
            <span>Speed:</span>
            <span className="tabular-nums text-module-arp font-bold">
              {params.arpRate === "8n"
                ? "1/8"
                : params.arpRate === "32n"
                  ? "1/32"
                  : "1/16"}
            </span>
          </div>
          <div className="join w-full">
            {(["8n", "16n", "32n"] as const).map((r) => (
              <button
                key={r}
                onClick={() => onChangeParams({ ...params, arpRate: r })}
                className={`btn join-item btn-xs flex-1 text-[10px] font-semibold ${
                  params.arpRate === r ? arpOn : "btn-outline"
                }`}
              >
                {r === "8n" ? "1/8" : r === "16n" ? "1/16" : "1/32"}
              </button>
            ))}
          </div>
        </div>

        {/* Arp Style Selector */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-base-content/60">
            <span>Mode:</span>
            <span className="capitalize text-module-arp font-bold">
              {params.arpMode}
            </span>
          </div>
          <div className="join w-full">
            {(["up", "down", "updown", "random"] as const).map((m) => (
              <button
                key={m}
                onClick={() => onChangeParams({ ...params, arpMode: m })}
                className={`btn join-item btn-xs flex-1 text-[10px] font-semibold ${
                  params.arpMode === m ? arpOn : "btn-outline"
                }`}
                title={`Mode: ${m}`}
              >
                {m === "up"
                  ? "↑"
                  : m === "down"
                    ? "↓"
                    : m === "updown"
                      ? "⇅"
                      : "🎲"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const SimpleSynthPanel = React.memo(
  function SimpleSynthPanel({ params, onChangeParams }: SimpleSynthPanelProps) {
    const macro = simpleMacroReadings(params);
    const set = (patch: Partial<SynthParams>) =>
      onChangeParams({ ...params, ...patch });

    return (
      <div className="space-y-4">
        {/* 2. Four Friendly Macro Dials + 1-Click Arp */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MacroDialCard
            id="simple-macro-tone"
            title="Tone"
            tone="text-module-filter"
            Icon={Sun}
            reading={macro.tone}
            min={300}
            max={12000}
            step={50}
            format={(v) => `${(v / 1000).toFixed(1)}k`}
            onChange={(v) => set({ filterCutoff: v })}
          />

          <MacroDialCard
            id="simple-macro-space"
            title="Space"
            tone="text-module-env-vca"
            Icon={Compass}
            reading={macro.space}
            min={0.05}
            max={2.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={(v) =>
              set({
                release: v,
                sustain: Math.min(1.0, Math.max(0.2, v * 0.4 + 0.3)),
              })
            }
          />

          <MacroDialCard
            id="simple-macro-vibe"
            title="Vibe"
            tone="text-module-lfo"
            Icon={Waves}
            reading={macro.vibe}
            min={0}
            max={50}
            step={1}
            format={(v) => `${v} ct`}
            onChange={(v) => set({ detune: v, lfoDepth: v > 15 ? 0.2 : 0.05 })}
          />

          <MacroDialCard
            id="simple-macro-punch"
            title="Punch"
            tone="text-module-osc"
            Icon={Flame}
            reading={macro.punch}
            min={0}
            max={1}
            step={0.02}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) =>
              set({
                subOscVolume: v,
                attack: v > 0.4 ? 0.01 : Math.max(0.01, params.attack),
              })
            }
          />

          <EasyArpCard params={params} onChangeParams={onChangeParams} />
        </div>
      </div>
    );
  },
);
