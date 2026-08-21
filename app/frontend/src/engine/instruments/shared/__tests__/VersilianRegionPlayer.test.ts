import { beforeEach, describe, expect, it, vi } from "vitest";
import { VersilianRegionPlayer } from "../VersilianRegionPlayer";

const constructed: string[] = [];
const startSpy = vi.fn();

vi.mock("smplr", () => {
  class MockVersilian {
    load = Promise.resolve(this);
    start = startSpy;
    stop = vi.fn();
    disconnect = vi.fn();

    constructor(_c: AudioContext, options: { instrument: string }) {
      constructed.push(options.instrument);
    }
  }
  return { Versilian: MockVersilian };
});

describe("VersilianRegionPlayer", () => {
  beforeEach(() => { constructed.length = 0; startSpy.mockClear(); });

  it("loads exactly the instruments it was given", async () => {
    const player = new VersilianRegionPlayer({} as AudioContext, ["A/x", "B/y"]);
    await player.load();
    expect(constructed.sort()).toEqual(["A/x", "B/y"]);
  });

  it("plays a region by starting its instrument at the region note", async () => {
    const player = new VersilianRegionPlayer({} as AudioContext, ["A/x"]);
    await player.load();
    player.play({ instrument: "A/x", note: 60 }, 100);
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ note: 60, velocity: 100 }),
    );
  });

  it("no-ops playing a region whose instrument was not loaded", async () => {
    const player = new VersilianRegionPlayer({} as AudioContext, ["A/x"]);
    await player.load();
    player.play({ instrument: "not-loaded", note: 40 }, 100);
    expect(startSpy).not.toHaveBeenCalled();
  });
});
