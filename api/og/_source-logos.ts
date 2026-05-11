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

// Outlet names we have real PNGs for. Each entry corresponds to a file
// at /public/source-logos/<slug>.png. When a source isn't in this set
// the renderer falls back to a monogram square.
//
// Logos were sourced from Google's public favicon service (editorial
// fair-use attribution). To refresh:
//   curl "https://www.google.com/s2/favicons?domain=<host>&sz=128" \
//     -o "public/source-logos/<slug>.png"
// Re-encode any JPEGs to PNG: `sips -s format png <file> --out <file>`.
const LOGO_SLUGS: ReadonlySet<string> = new Set<string>([
  "aljazeera",
  "bbcbusiness",
  "benzinga",
  "blockworks",
  "bloomberg",
  "channelnewsasia",
  "cnbceconomy",
  "cnbcmarkets",
  "coindesk",
  "cointelegraph",
  "decrypt",
  "dlnews",
  "federalreserve",
  "ft",
  "googlenews",
  "investingcom",
  "marketwatch",
  "nikkeiasia",
  "reuters",
  "scmpworld",
  "seekingalpha",
  "semafor",
  "theblock",
  "wsj",
  "wsjmarkets",
]);

function normalizeSourceName(source: string): string {
  return source
    // Strip "(via Google News)" / "(via X)" parenthetical suffixes so
    // aggregated feeds (e.g. "Bloomberg (via Google News)") map to the
    // canonical outlet slug ("bloomberg") rather than a feed-specific one.
    // NOTE: this regex only matches non-nested parens. A source name like
    // "Foo (via X (mirror))" would not normalize fully. None of our
    // current feeds use nested parens; add handling if that changes.
    .replace(/\s*\([^)]*\)\s*/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
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

// Hardcoded month abbreviations — avoids dependency on Vercel runtime's
// ICU implementation for `toLocaleDateString`. Pure-JS array lookup is
// stable across Node version bumps that might strip full-ICU.
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format the article publish time for the meta line. Returns
 * "May 11, 13:42 UTC" format. Returns null when the timestamp is missing
 * or unparseable — caller drops the date suffix in that case.
 */
export function formatArticleTimestamp(publishedAt: string | undefined): string | null {
  if (!publishedAt) return null;
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return null;
  const month = MONTHS_SHORT[d.getUTCMonth()];
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm} UTC`;
}
