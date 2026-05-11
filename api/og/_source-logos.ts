// api/og/_source-logos.ts
//
// Source-name → PNG data-URI map for the news brief image's article block.
// The article block shows a small logo beside the outlet name. Real PNGs go
// here, hosted alongside the renderer (Satori requires PNG data URIs — no
// network fetches at render time).
//
// To add a new source:
//   1. Drop a 56×56 PNG at /public/source-logos/<slug>.png. Slug is
//      computed by `normalizeSourceName`: lowercase, strip whitespace,
//      then strip non-alphanumerics (e.g. "S&P Global" → "spglobal",
//      "Wall Street Journal" → "wallstreetjournal").
//   2. Add the slug to LOGO_SLUGS below.
//
// When a source isn't in the map, the renderer falls back to a dark monogram
// square (first letter of the outlet name). The fallback is deliberately
// distinguishable from a real logo so we can spot which outlets need PNGs.
//
// Source-name normalization is case-insensitive and ignores whitespace —
// "CoinDesk", "Coindesk", "COINDESK", and "Coin Desk" all map to the same
// slug.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const logoCache: Map<string, string | null> = new Map();

// Outlet names we have real PNGs for. Add entries as we collect press-kit
// logos. Empty for now; every source falls back to the monogram treatment
// until real PNGs are dropped into /public/source-logos/.
const LOGO_SLUGS: ReadonlySet<string> = new Set<string>([
  // "bloomberg",
  // "coindesk",
  // "cnbc",
  // "wsj",
  // …
]);

function normalizeSourceName(source: string): string {
  return source.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
}

/**
 * Return a data URI for the source's logo PNG, or null if we don't have one.
 * Caller falls back to a monogram square when null.
 */
export function getSourceLogoDataUri(source: string): string | null {
  const slug = normalizeSourceName(source);
  if (!slug) return null;
  if (logoCache.has(slug)) return logoCache.get(slug) ?? null;
  if (!LOGO_SLUGS.has(slug)) {
    logoCache.set(slug, null);
    return null;
  }
  try {
    const path = join(process.cwd(), "public", "source-logos", `${slug}.png`);
    const buf = readFileSync(path);
    const dataUri = `data:image/png;base64,${buf.toString("base64")}`;
    logoCache.set(slug, dataUri);
    return dataUri;
  } catch (err) {
    console.warn(`[og/news] Source logo not found for ${source} (${slug}):`, err);
    logoCache.set(slug, null);
    return null;
  }
}

/**
 * Format the article publish time for the meta line. Returns
 * "May 11, 13:42 UTC" format. Returns null when the timestamp is missing
 * or unparseable — caller drops the date suffix in that case.
 */
export function formatArticleTimestamp(publishedAt: string | undefined): string | null {
  if (!publishedAt) return null;
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm} UTC`;
}
