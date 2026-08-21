import { describe, it, expect } from "vitest";
import { validateUsername } from "../validateUsername";

describe("validateUsername", () => {
  it("rejects an empty username", () => {
    expect(validateUsername("")).toBe("Username cannot be empty");
  });

  it("rejects a whitespace-only username", () => {
    expect(validateUsername("   ")).toBe("Username cannot be empty");
  });

  it("rejects a 2-character username", () => {
    expect(validateUsername("ab")).toBe("Username must be between 3 and 30 characters");
  });

  it("accepts a 3-character username", () => {
    expect(validateUsername("abc")).toBe("");
  });

  it("rejects a username containing characters outside the regex (a!b)", () => {
    expect(validateUsername("a!b")).toBe(
      "Username can only contain letters, numbers, underscores, and hyphens",
    );
  });

  it("accepts underscores and hyphens (explicitly allowed by the regex)", () => {
    expect(validateUsername("a_b-c")).toBe("");
  });

  it("accepts a 30-character username", () => {
    expect(validateUsername("a".repeat(30))).toBe("");
  });

  it("rejects a 31-character username", () => {
    expect(validateUsername("a".repeat(31))).toBe("Username must be between 3 and 30 characters");
  });

  it("trims surrounding whitespace before validating length and characters", () => {
    expect(validateUsername("  abc  ")).toBe("");
    expect(validateUsername("  a!b  ")).toBe(
      "Username can only contain letters, numbers, underscores, and hyphens",
    );
  });
});
