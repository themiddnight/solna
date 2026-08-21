import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACOUSTIC_DRUM_PIECES,
  DEFAULT_ACOUSTIC_DRUMSET_ID,
  VERSILIAN_DRUMSET_KIT,
  getAcousticDrumKitConfig,
  getVersilianDrumKit,
  getVersilianKitInstruments,
  type VersilianDrumKitConfig,
} from "../acousticDrumKits";
import { VersilianAcousticDrumProvider } from "../VersilianAcousticDrumProvider";
import type { AcousticDrumPiece } from "../types";

const constructedInstruments: string[] = [];

vi.mock("smplr", () => {
  class MockVersilian {
    load = Promise.resolve(this);
    start = vi.fn();
    stop = vi.fn();
    disconnect = vi.fn();

    constructor(_context: AudioContext, options: { instrument: string }) {
      constructedInstruments.push(options.instrument);
    }
  }

  return { Versilian: MockVersilian };
});

const remapPieceRegionsToSingleInstrument = (
  instrument: string,
): Record<AcousticDrumPiece, VersilianDrumKitConfig["pieceRegions"][AcousticDrumPiece]> => {
  const result = {} as Record<
    AcousticDrumPiece,
    VersilianDrumKitConfig["pieceRegions"][AcousticDrumPiece]
  >;
  for (const piece of ACOUSTIC_DRUM_PIECES) {
    result[piece] = { piece, instrument, note: 60 };
  }
  return result;
};

describe("acoustic drum kit config", () => {
  beforeEach(() => {
    constructedInstruments.length = 0;
  });

  it("resolves the default kit and selects its provider from config, not a hardcoded key", () => {
    const kit = getAcousticDrumKitConfig(DEFAULT_ACOUSTIC_DRUMSET_ID);

    expect(kit.id).toBe(DEFAULT_ACOUSTIC_DRUMSET_ID);
    expect(kit.providerKey).toBe("versilian-acoustic-drumset");
  });

  it("derives the kit sample list by de-duplicating piece and GM-note instruments", () => {
    const instruments = getVersilianKitInstruments(VERSILIAN_DRUMSET_KIT);

    // No duplicates.
    expect(new Set(instruments).size).toBe(instruments.length);
    // Every referenced instrument is present.
    const referenced = new Set([
      ...ACOUSTIC_DRUM_PIECES.map(
        (piece) => VERSILIAN_DRUMSET_KIT.pieceRegions[piece].instrument,
      ),
      ...Object.values(VERSILIAN_DRUMSET_KIT.gmNoteToRegion).map(
        (region) => region.instrument,
      ),
    ]);
    expect(new Set(instruments)).toEqual(referenced);
  });

  it("loads ONLY the instruments referenced by the selected kit (lazy per-kit load)", async () => {
    const reducedKit: VersilianDrumKitConfig = {
      ...VERSILIAN_DRUMSET_KIT,
      id: "reduced-test-kit",
      pieceRegions: remapPieceRegionsToSingleInstrument("Solo/Instrument"),
      gmNoteToRegion: {
        36: { piece: "kick", instrument: "Solo/Instrument", note: 60 },
      },
    };

    const context = {} as AudioContext;
    const reducedProvider = new VersilianAcousticDrumProvider(context, reducedKit);
    await reducedProvider.load();

    expect(constructedInstruments).toEqual(["Solo/Instrument"]);

    constructedInstruments.length = 0;

    const fullProvider = new VersilianAcousticDrumProvider(
      context,
      VERSILIAN_DRUMSET_KIT,
    );
    await fullProvider.load();

    // The full kit loads more instruments than the reduced kit — proving the
    // provider only fetches the selected kit's samples, not a global union.
    expect(constructedInstruments.length).toBe(
      getVersilianKitInstruments(VERSILIAN_DRUMSET_KIT).length,
    );
    expect(constructedInstruments.length).toBeGreaterThan(1);
  });

  it("narrows an id to a Versilian kit config", () => {
    const kit = getVersilianDrumKit(DEFAULT_ACOUSTIC_DRUMSET_ID);
    expect(kit.providerKey).toBe("versilian-acoustic-drumset");
    expect(kit.gmNoteToRegion[36]).toBeDefined();
  });
});
