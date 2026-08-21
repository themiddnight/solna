/**
 * Production static server for the murva frontend.
 *
 * Replaces `vite preview` (a dev tool, not a production server) so we can inject
 * room-type-specific Open Graph / Twitter Card meta tags into the `/invite/:code`
 * route. Social crawlers do not execute JavaScript, so per-route link previews
 * must be rendered server-side here — `react-helmet` runs in the browser and is
 * invisible to crawlers.
 *
 * Privacy: the preview varies ONLY by room type (perform vs arrange), never by a
 * private room's name/description, and every injected value comes from a fixed
 * in-process map — no untrusted input ever reaches the HTML.
 */
import { RoomType } from '@jam-band/shared';
import { buildContentSecurityPolicy, cspHeaderName } from './src/shared/utils/contentSecurityPolicy';

interface OgMeta {
  title: string;
  description: string;
  /** Path under the site origin, e.g. "/images/og.png". */
  image: string;
}

const ROOT = import.meta.dir;
const DIST = `${ROOT}/dist`;
const PORT = Number(process.env.PORT ?? 3000);

// Prefer Railway internal networking (fast, stays private); fall back to the
// public API base the browser bundle already uses (both are plain env vars at
// runtime, regardless of the VITE_ prefix).
const API_BASE = (
  process.env.BACKEND_INTERNAL_URL ??
  process.env.VITE_API_URL ??
  ''
).replace(/\/$/, '');

const indexHtml = await Bun.file(`${DIST}/index.html`).text();

// ── Security headers (DEV-198) ────────────────────────────────────────────────
// CSP is the real mitigation for XSS-based token theft. The browser-facing API origin (NOT the
// Railway-internal URL used for server-to-server fetches) is what the browser connects to, so
// derive it from VITE_API_URL.
function resolveApiOrigin(): string | null {
  const raw = process.env.VITE_API_URL;
  if (raw === undefined || raw.length === 0) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const CSP_VALUE = buildContentSecurityPolicy({
  apiOrigin: resolveApiOrigin(),
  reportUri: process.env.CSP_REPORT_URI ?? null,
});
// Default Report-Only so the policy can be observed in prod before enforcing; flip with
// CSP_MODE=enforce once the report stream is clean.
const CSP_HEADER = cspHeaderName(process.env.CSP_MODE);

function applySecurityHeaders(headers: Headers): Headers {
  headers.set(CSP_HEADER, CSP_VALUE);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY'); // legacy backstop for CSP frame-ancestors 'none'
  return headers;
}

// Single shared brand image (1200×630 PNG, repo-hosted — renders on every
// platform, unlike webp). To vary the image by room type too, drop in
// og-perform.png / og-arrange.png and point each entry below at its own file.
const OG_IMAGE = '/images/og.png';

const OG_BY_TYPE: Record<RoomType, OgMeta> = {
  [RoomType.PERFORM]: {
    title: 'Join the live jam on murva 🎸',
    description:
      "You're invited to jam live — virtual instruments, step sequencer, and voice chat in real time. Music In Your Hands.",
    image: OG_IMAGE,
  },
  [RoomType.ARRANGE]: {
    title: 'Collaborate on a track on murva 🎹',
    description:
      "You're invited into a collaborative production room — multi-track timeline, piano roll, and recording. Make music together.",
    image: OG_IMAGE,
  },
};

const OG_DEFAULT: OgMeta = {
  title: 'murva — make music together',
  description: 'murva — collaborative music making. Music In Your Hands.',
  image: OG_IMAGE,
};

function htmlHeaders(): Headers {
  const headers = new Headers();
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-cache');
  return applySecurityHeaders(headers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Resolve the room type for an invite code via the backend, or null if unknown. */
async function resolveRoomType(code: string): Promise<RoomType | null> {
  if (API_BASE.length === 0) return null;
  try {
    const res = await fetch(
      `${API_BASE}/api/rooms/invite/${encodeURIComponent(code)}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!isRecord(data)) return null;
    if (data.roomType === RoomType.PERFORM) return RoomType.PERFORM;
    if (data.roomType === RoomType.ARRANGE) return RoomType.ARRANGE;
    return null;
  } catch {
    return null;
  }
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Replace the `content="..."` of a single known meta tag (single- or multi-line). */
function setMeta(
  html: string,
  attr: 'property' | 'name',
  key: string,
  value: string,
): string {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'i');
  return html.replace(re, `$1${escapeHtmlAttr(value)}$2`);
}

function siteOrigin(req: Request, url: URL): string {
  const configured = process.env.PUBLIC_SITE_URL;
  if (configured !== undefined && configured.length > 0) {
    return configured.replace(/\/$/, '');
  }
  const proto =
    req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  return `${proto}://${host}`;
}

function renderInviteHtml(meta: OgMeta, code: string, origin: string): string {
  const image = `${origin}${meta.image}`;
  const pageUrl = `${origin}/invite/${code}`;
  let html = indexHtml.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtmlAttr(meta.title)}</title>`,
  );
  html = setMeta(html, 'property', 'og:title', meta.title);
  html = setMeta(html, 'property', 'og:description', meta.description);
  html = setMeta(html, 'property', 'og:image', image);
  html = setMeta(html, 'property', 'og:image:alt', meta.title);
  html = setMeta(html, 'property', 'og:url', pageUrl);
  html = setMeta(html, 'name', 'twitter:title', meta.title);
  html = setMeta(html, 'name', 'twitter:description', meta.description);
  html = setMeta(html, 'name', 'twitter:image', image);
  html = setMeta(html, 'name', 'twitter:image:alt', meta.title);
  return html;
}

function cacheControlFor(pathname: string): string {
  // Vite emits content-hashed filenames under /assets, safe to cache forever.
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);

    // Block path traversal before touching the filesystem.
    if (pathname.includes('..') || pathname.includes('\0')) {
      return new Response('Bad request', { status: 400, headers: applySecurityHeaders(new Headers()) });
    }

    // Invite links → inject room-type OG tags, then serve the SPA shell so the
    // app still boots normally for real visitors.
    const invite = pathname.match(/^\/invite\/([A-Za-z0-9_-]+)\/?$/);
    if (invite) {
      const code = invite[1];
      if (code !== undefined) {
        const roomType = await resolveRoomType(code);
        const meta = roomType !== null ? OG_BY_TYPE[roomType] : OG_DEFAULT;
        const html = renderInviteHtml(meta, code, siteOrigin(req, url));
        return new Response(html, { headers: htmlHeaders() });
      }
    }

    // Static assets from the Vite build.
    if (pathname !== '/') {
      const file = Bun.file(`${DIST}${pathname}`);
      if (await file.exists()) {
        const headers = new Headers();
        headers.set('cache-control', cacheControlFor(pathname));
        return new Response(file, { headers: applySecurityHeaders(headers) });
      }
    }

    // SPA fallback — every other route boots the client app.
    return new Response(indexHtml, { headers: htmlHeaders() });
  },
});

console.log(`murva frontend server listening on :${PORT}`);
