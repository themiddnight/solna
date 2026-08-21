/**
 * Playwright driver for the dev-only calibration harness page (DEV-311).
 *
 * `OfflineAudioContext`, smplr and Tone.js are all browser APIs, so the actual render can't
 * happen in this Node script — instead this drives headless Chromium to
 * `CalibrationHarnessPage` (`src/pages/dev/CalibrationHarnessPage.tsx`), which does the real
 * `OfflineAudioContext` render and publishes the result on `window.calibrationResult` (a base64
 * WAV) or `window.calibrationError`. This file polls for whichever one lands and returns the
 * decoded WAV bytes to Task 9's batch orchestrator.
 *
 * Requires `bun run dev` already running (see scripts/calibration/README.md) — this does not
 * start the dev server itself.
 */
import { chromium, type Browser } from "@playwright/test";

import type { InstrumentFamily } from "@/engine/instruments/shared/calibration/trimTable.types";

const DEV_SERVER_URL = process.env.CALIBRATION_DEV_SERVER_URL ?? "http://localhost:5173";

/** The subset of the harness page's window globals this driver reads back out. */
interface CalibrationWindow {
  calibrationResult?: string;
  calibrationError?: string;
}

async function renderOnPage(browser: Browser, instrumentId: string, family: InstrumentFamily): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    const url = `${DEV_SERVER_URL}/dev/calibration-harness?instrumentId=${encodeURIComponent(instrumentId)}&family=${family}`;
    await page.goto(url);

    await page.waitForFunction(
      () => {
        const win = globalThis as typeof globalThis & CalibrationWindow;
        return win.calibrationResult !== undefined || win.calibrationError !== undefined;
      },
      { timeout: 30_000 },
    );

    const { result, error } = await page.evaluate(() => {
      const win = globalThis as typeof globalThis & CalibrationWindow;
      return { result: win.calibrationResult, error: win.calibrationError };
    });

    if (error !== undefined) {
      throw new Error(`Calibration render failed for ${instrumentId}: ${error}`);
    }
    if (result === undefined) {
      throw new Error(`Calibration render produced no result for ${instrumentId}`);
    }

    return Buffer.from(result, "base64");
  } finally {
    await page.close();
  }
}

export interface CalibrationRenderSession {
  render(instrumentId: string, family: InstrumentFamily): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Launches one Chromium instance and reuses it across every `render()` call (a fresh page per
 * instrument, closed after each render). A cold browser launch dominates per-instrument cost —
 * amortizing it across the whole catalog is what makes the Task 9 batch run tractable.
 */
export async function createCalibrationRenderSession(): Promise<CalibrationRenderSession> {
  const browser = await chromium.launch();
  return {
    render: (instrumentId, family) => renderOnPage(browser, instrumentId, family),
    close: () => browser.close(),
  };
}
