/**
 * Validate ICON_REGISTRY sources against the Iconify API (DEV-250).
 *
 * Guards the bug class where a registry source type-checks and passes lint/unit
 * but does NOT exist on Iconify (e.g. `mdi:drum` — no such glyph → silent blank
 * render). Queries api.iconify.design for every `default`/`pixel` source and
 * FAILS (non-zero exit) if any is reported `not_found`.
 *
 * NETWORK-dependent by design — this is the canonical source-of-truth check
 * against the live Iconify catalogue, complementary to the OFFLINE build-time
 * check in generate-icon-bundle.ts (which validates against the installed
 * @iconify-json/* sets). It is NOT a unit test; run it manually / pre-release:
 *
 *   bun run icons:validate        # from app/frontend
 */
import { ICON_REGISTRY, type IconSource } from "../src/shared/ui/icon/registry";

const API_BASE = "https://api.iconify.design";

interface IconifyApiResponse {
  prefix: string;
  icons?: Record<string, unknown>;
  not_found?: string[];
}

function collectNamesByPrefix(): Map<string, Set<string>> {
  const byPrefix = new Map<string, Set<string>>();
  // `satisfies` narrows away optional `pixel`; widen via assignability (no cast).
  const entries: IconSource[] = Object.values(ICON_REGISTRY);
  for (const entry of entries) {
    const sources = entry.pixel !== undefined ? [entry.default, entry.pixel] : [entry.default];
    for (const source of sources) {
      const colon = source.indexOf(":");
      if (colon <= 0 || colon === source.length - 1) {
        throw new Error(`Invalid Iconify source "${source}" — expected "<prefix>:<name>".`);
      }
      const prefix = source.slice(0, colon);
      const name = source.slice(colon + 1);
      const set = byPrefix.get(prefix) ?? new Set<string>();
      set.add(name);
      byPrefix.set(prefix, set);
    }
  }
  return byPrefix;
}

async function fetchPrefix(prefix: string, names: string[]): Promise<string[]> {
  const url = `${API_BASE}/${prefix}.json?icons=${names.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Iconify API ${res.status} for prefix "${prefix}" (${url})`);
  }
  const data = (await res.json()) as IconifyApiResponse;
  // A prefix the API doesn't know at all returns no `icons` — treat every name
  // as missing so an unknown vendor set is reported, not silently passed.
  if (data.icons === undefined && (data.not_found === undefined || data.not_found.length === 0)) {
    return names.map((n) => `${prefix}:${n}`);
  }
  return (data.not_found ?? []).map((n) => `${prefix}:${n}`);
}

async function main(): Promise<void> {
  const byPrefix = collectNamesByPrefix();
  const total = [...byPrefix.values()].reduce((sum, s) => sum + s.size, 0);
  console.log(`Validating ${total} icon source(s) across ${byPrefix.size} prefix(es) against ${API_BASE} …`);

  const missing: string[] = [];
  for (const [prefix, names] of byPrefix) {
    const notFound = await fetchPrefix(prefix, [...names]);
    missing.push(...notFound);
  }

  if (missing.length > 0) {
    console.error(
      `\n✖ ${missing.length} registry icon(s) were NOT FOUND on Iconify:\n` +
        missing.map((s) => `   - ${s}`).join("\n") +
        `\n\nFix the source in src/shared/ui/icon/registry.ts (the icon may not exist in that set).\n`,
    );
    process.exit(1);
  }

  console.log(`✔ All ${total} registry icon source(s) exist on Iconify.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
