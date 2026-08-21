import { describe, it, expect, vi } from "vitest";
import type { Storage, StorageResponse } from "smplr";

import { createCaseFallbackStorage } from "../smplrCaseFallbackStorage";

const response = (status: number): StorageResponse => ({
  status,
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
});

describe("createCaseFallbackStorage", () => {
  it("passes through a successful fetch untouched", async () => {
    const fetch = vi.fn().mockResolvedValue(response(200));
    const storage = createCaseFallbackStorage({ fetch } as Storage);

    const result = await storage.fetch("https://example.test/kick.wav");

    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes through a 404 for a non-.wav URL (manifest JSON) without retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(response(404));
    const storage = createCaseFallbackStorage({ fetch } as Storage);

    const result = await storage.fetch("https://example.test/machine.json");

    expect(result.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 404 .wav URL with uppercase .WAV and returns it on success", async () => {
    const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve(response(url.endsWith(".WAV") ? 200 : 404)));
    const storage = createCaseFallbackStorage({ fetch } as Storage);

    const result = await storage.fetch("https://example.test/KR55CHAT.wav");

    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith("https://example.test/KR55CHAT.WAV");
  });

  it("falls back through .aif when .WAV also 404s", async () => {
    const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve(response(url.endsWith(".aif") ? 200 : 404)));
    const storage = createCaseFallbackStorage({ fetch } as Storage);

    const result = await storage.fetch("https://example.test/CLAVE.wav");

    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenLastCalledWith("https://example.test/CLAVE.aif");
  });

  it("returns the original 404 when no fallback extension works", async () => {
    const fetch = vi.fn().mockResolvedValue(response(404));
    const storage = createCaseFallbackStorage({ fetch } as Storage);

    const result = await storage.fetch("https://example.test/missing.wav");

    expect(result.status).toBe(404);
  });
});
