import { HttpStorage, type Storage } from "smplr";

/**
 * Some DrumAbuse machine manifests (e.g. korg-kr-55, korg-kpr-77, ace-tone-rhythm-ace-fr-1 —
 * DEV-321) declare a lowercase format ("wav") that every sample URL gets built with, but the
 * actual files hosted on the CDN use a different case or extension (".WAV", ".aif"). GitHub
 * Pages is case-sensitive, so the mismatch 404s and the instrument plays nothing for any note.
 *
 * smplr routes every fetch — manifest JSON and sample audio alike — through this `Storage`
 * hook, so wrapping it here fixes playback without forking the manifest data or patching the
 * library: on a 404 for a ".wav" URL, retry the same path with each fallback extension before
 * giving up. Non-".wav" URLs (JSON manifests) and successful fetches pass straight through.
 */
const SAMPLE_EXTENSION_FALLBACKS = [".WAV", ".aif", ".AIF", ".aiff", ".AIFF"];
const FAILING_EXTENSION = ".wav";

export function createCaseFallbackStorage(baseStorage: Storage = HttpStorage): Storage {
  return {
    async fetch(url) {
      const response = await baseStorage.fetch(url);
      if (response.status !== 404 || !url.endsWith(FAILING_EXTENSION)) {
        return response;
      }

      const base = url.slice(0, -FAILING_EXTENSION.length);
      for (const ext of SAMPLE_EXTENSION_FALLBACKS) {
        const retry = await baseStorage.fetch(`${base}${ext}`);
        if (retry.status === 200) return retry;
      }
      return response;
    },
  };
}
