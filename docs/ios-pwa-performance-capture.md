# iOS PWA performance capture runbook

This runbook collects evidence for the iPhone PWA freeze without changing playback behavior. Run the long observation without an inspector first; use Safari profiling only for a short, separate capture because the profiler itself adds CPU load, memory pressure, and heat.

> **Development builds only.** The **Project → Diagnostics** row and its panel are compiled out of production builds (`import.meta.env.DEV`), so this runbook applies to a `bun run dev` build served to the device. Production users report problems through **Project → Report a Bug**, which uses incident storage instead.

## What the recorder captures

Open **Project → Diagnostics**. Nothing is scheduled and IndexedDB is not opened merely because the app loaded. Press **Start** to opt in. Closing the panel does not stop the recorder.

The recorder takes one sample per second and retains at most 1,800 samples. It records event-loop lag, animation-frame gaps, selected React render counts, Zustand and `playheadBeat` writes, AudioContext and clock health, live voice/group counts by source, DOM/canvas counts, transport/view state, viewport/DPR, and page visibility. Long Tasks and JavaScript heap are included only when the browser exposes those APIs; their absence on iOS is expected.

The data stays on the device in the separate one-slot `solna-diagnostics` IndexedDB database. It contains no note data, progression content, project name, Drive token, or user identity. A storage failure leaves the in-memory recording running and changes the panel's storage status to unavailable.

## Run 1: long, unprofiled iPhone session

1. Start from a cool iPhone, close unrelated foreground apps, disable Low Power Mode, and note the iPhone/iOS version and whether it is charging.
2. Launch the installed Solna Home Screen app. Use the same project, BPM, meter, visible tab, and screen orientation for every comparison.
3. Open **Project → Diagnostics**, press **Start**, then close the panel.
4. Start the intended loop and let it run for 30–60 minutes. Do not connect Safari Web Inspector during this run. Avoid switching tabs or backgrounding the PWA unless that transition is part of the reproduction.
5. If playback remains responsive, open Diagnostics, press **Stop**, then **Share JSON**. On systems without file sharing support, the same action downloads the JSON file.
6. If the PWA freezes or is killed, reopen it, open Diagnostics, and press **Recover latest**. A session with no `endedAt` is shown as interrupted. Share it before starting another run; the database intentionally keeps only the latest session.
7. Record the approximate wall-clock time of the first audible glitch, frozen control, or OS termination so it can be matched to the JSON's elapsed time.

The collector reports its own cost. Treat a collector p95 of 5 ms or more as an invalid or heavily perturbed run and repeat from a cool device.

## Run 2: short Safari Web Inspector profile

Apple's current setup is:

1. On iPhone, open **Settings → Apps → Safari → Advanced** and enable **Web Inspector**.
2. Connect the iPhone to the Mac with a cable and trust the Mac if prompted.
3. On macOS Safari, open **Safari → Settings → Advanced** and enable **Show features for web developers**.
4. Bring the Home Screen web app to the foreground. In Safari's **Develop** menu, choose the iPhone and then the Solna Home Screen web app. Apple documents that foreground Home Screen web apps appear there.

References: [Inspecting iOS and iPadOS](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios) and [Enabling developer features](https://developer.apple.com/documentation/safari-developer-tools/enabling-developer-features).

For the capture itself:

1. Reproduce the same project, transport state, view, orientation, and charging state as Run 1.
2. Let playback stabilize before recording.
3. In Web Inspector, record only the relevant CPU/JavaScript timeline plus Memory/JavaScript Allocations instruments available in that Safari version. Do not enable every instrument.
4. Capture 60–120 seconds that includes normal playback and, if it occurs quickly enough, the degradation. Stop profiling immediately afterward.
5. Save/export the timeline and note its start time relative to the diagnostics JSON. Disconnect the inspector and let the phone cool before another attempt.

Do not use a 30–60 minute inspector recording. A long profiler session can become the dominant source of memory growth and heat, obscuring the PWA's behavior.

## Reading the evidence

- A steadily rising DOM count, canvas count, logical group count, registered voice count, or physical voice count suggests retained objects or incomplete teardown.
- Stable counts with rising event-loop lag, frame gaps, and clock stalls point more toward CPU saturation, garbage-collection pauses, or browser throttling.
- High `playheadBeat` writes accompanied by high `ChordView`, progression playhead, `PlayheadReadout`, or `TransportBar` renders quantify the current Zustand/render fan-out; this recorder does not change that data flow.
- Clock stall count is cumulative. Use the sampled deltas and `maxStallMs`, not just the final total.
- Missing heap or Long Task values on iOS mean the capability is unavailable, not that no allocation or long task occurred.

Keep the raw JSON and Safari timeline together. The next remediation should be chosen only after comparing the long unprofiled run with the short instrumented run; moving `playheadBeat` out of Zustand is deliberately outside this diagnostic change.
