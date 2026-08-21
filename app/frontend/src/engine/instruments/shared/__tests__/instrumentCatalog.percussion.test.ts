import { describe, expect, it } from "vitest";
import { getInstrumentDescriptor } from "../instrumentCatalog";
import { DEFAULT_PERCUSSION_SET_ID } from "../../percussion/constants";

describe("percussion catalog wiring", () => {
  it("produces a versilian-percussion descriptor for a percussion set", () => {
    const d = getInstrumentDescriptor(DEFAULT_PERCUSSION_SET_ID);
    expect(d).not.toBeNull();
    expect(d!.providerKey).toBe("versilian-percussion");
    expect(d!.providerConfig).toEqual({ set: DEFAULT_PERCUSSION_SET_ID });
    expect(d!.capabilities.isPercussion).toBe(true);
  });
});
