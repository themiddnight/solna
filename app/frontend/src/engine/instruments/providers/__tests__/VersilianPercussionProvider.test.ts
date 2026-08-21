import { beforeEach, describe, expect, it, vi } from "vitest";
import { VersilianPercussionProvider } from "../VersilianPercussionProvider";
import { CONGAS_BONGOS_SET } from "../../percussion/percussionSets";

const constructed: string[] = [];
const startSpy = vi.fn();
vi.mock("smplr", () => {
  class MockVersilian {
    load = Promise.resolve(this);
    start = startSpy;
    stop = vi.fn();
    disconnect = vi.fn();

    constructor(_c: AudioContext, o: { instrument: string }) { constructed.push(o.instrument); }
  }
  return { Versilian: MockVersilian };
});

describe("VersilianPercussionProvider", () => {
  beforeEach(() => { constructed.length = 0; startSpy.mockClear(); });

  it("loads only the selected set's instruments", async () => {
    const p = new VersilianPercussionProvider(CONGAS_BONGOS_SET);
    await p.load({ audioContext: {} as AudioContext });
    const expected = new Set(Object.values(CONGAS_BONGOS_SET.gmNoteToRegion).map((r) => r.instrument));
    expect(new Set(constructed)).toEqual(expected);
  });

  it("plays a mapped GM note via its region", async () => {
    const p = new VersilianPercussionProvider(CONGAS_BONGOS_SET);
    await p.load({ audioContext: {} as AudioContext });
    const [gmNote, region] = Object.entries(CONGAS_BONGOS_SET.gmNoteToRegion)[0]!;
    p.play({ note: Number(gmNote), velocity: 100 });
    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ note: region.note }));
  });

  it("no-ops an unmapped GM note", async () => {
    const p = new VersilianPercussionProvider(CONGAS_BONGOS_SET);
    await p.load({ audioContext: {} as AudioContext });
    p.play({ note: 200, velocity: 100 });
    expect(startSpy).not.toHaveBeenCalled();
  });
});
