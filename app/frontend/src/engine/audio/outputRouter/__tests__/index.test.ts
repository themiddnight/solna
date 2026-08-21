import { describe, it, expect } from "vitest";
import { getOutputRouter } from "../index";

describe("getOutputRouter", () => {
  // The chosen sink is engine-local runtime state living inside the router instance.
  // A factory that minted a fresh router per call would silently drop the user's
  // choice the moment a second caller (audioContextManager vs the AudioOutput cell)
  // asked for one, so the caching is load-bearing, not an optimisation.
  it("returns one process-wide instance so the chosen sink survives", () => {
    expect(getOutputRouter()).toBe(getOutputRouter());
  });
});
