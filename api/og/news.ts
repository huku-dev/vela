// api/og/news.ts
//
// GET /api/og/news?bullish=HYPE,BTC&bearish=OIL&headline=...&velaRead=...
//   &date=2026-04-30&source=Bloomberg&publishedAt=2026-04-30T13:42:00Z
//
// Generates a 1600×900 PNG news brief card. Per-user: renders held + other
// tradeable chips (held first, then other) for the news's classified
// sentiment, capped at MAX_CHIPS_PER_DIR=3 per direction by the broadcast
// layer. Vercel's edge cache dedupes by URL so users with identical chip
// lists share the rendered PNG.
//
// Layout (v9 spec, 2026-05-11):
//   - Top bar: vela mark + date
//   - Body:
//       * When velaRead is present: pill ("Vela's read") + hero (the
//         velaRead synthesis) + bordered article block (logo + article
//         headline + outlet/time) + optional chip row
//       * When velaRead is empty (>12-word overshoot or schema_fail): no
//         pill, no hero. Article headline becomes the central element at
//         larger size with a flat attribution row below, plus the optional
//         chip row.
//   - Bottom bar: getvela.xyz / Read full brief CTA
//
// Spec: docs/product-briefs/news-brief-image.md
// Wireframe: crypto-agent/docs/wireframes/news-brief-image-v9.html

import type { VercelRequest, VercelResponse } from "@vercel/node";
import satori from "satori";
import { html } from "satori-html";
import {
  validateAuth,
  getSatoriFonts,
  svgToPng,
  formatTimestamp,
  getVelaIconDataUri,
  decodeHtmlEntities,
  CARD_WIDTH,
  CARD_HEIGHT,
  CREAM,
  INK,
  SIGNAL_GREEN,
  GREY_TEXT,
} from "./_shared.js";
import { getSourceLogoDataUri, formatArticleTimestamp } from "./_source-logos.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Tokens ─────────────────────────────────────────────────
// Hairline border for the bordered article block. rgba(10,10,10,0.14) at
// production scale renders as a clean 2px hairline against the cream card.
const HAIRLINE = "rgba(10, 10, 10, 0.14)";
const INK_60 = "rgba(10, 10, 10, 0.60)";
// Chip backgrounds are tinted versions of SIGNAL_GREEN / SIGNAL_RED
// (#0FE68C and #FF4757 from _shared.ts). Foreground colors are darker
// desaturated versions for legibility against the tinted bg.
const BULLISH_CHIP_BG = "rgba(15, 230, 140, 0.18)";
const BULLISH_CHIP_FG = "#07854f";
const BEARISH_CHIP_BG = "rgba(255, 71, 87, 0.15)";
const BEARISH_CHIP_FG = "#b3261e";

// ── Asset icon resolution ──────────────────────────────────
// Local PNGs for stocks/commodities; coingecko CDN for crypto. Cached in
// module scope so warm Vercel invocations skip the fetch.

const COINGECKO_ICONS: Record<string, string> = {
  BTC: "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png",
  ETH: "https://coin-images.coingecko.com/coins/images/279/small/ethereum.png",
  HYPE: "https://coin-images.coingecko.com/coins/images/50882/small/hyperliquid.jpg",
  SOL: "https://coin-images.coingecko.com/coins/images/4128/small/solana.png",
};

const LOCAL_ICONS = new Set([
  "AAPL", "AMZN", "GOLD", "GOOGL", "META", "MSFT",
  "MU", "NATGAS", "NVDA", "OIL", "SNDK", "SP500", "TSLA",
]);

const iconCache: Map<string, string> = new Map();

async function resolveAssetIcon(ticker: string): Promise<string | null> {
  const upper = ticker.toUpperCase();
  if (iconCache.has(upper)) return iconCache.get(upper)!;

  let dataUri: string | null = null;

  if (LOCAL_ICONS.has(upper)) {
    try {
      const path = join(process.cwd(), "public", "icons", `${upper.toLowerCase()}.png`);
      const buf = readFileSync(path);
      dataUri = `data:image/png;base64,${buf.toString("base64")}`;
    } catch (err) {
      console.warn(`[og/news] Local icon not found for ${upper}:`, err);
    }
  } else if (COINGECKO_ICONS[upper]) {
    try {
      const res = await fetch(COINGECKO_ICONS[upper]);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = COINGECKO_ICONS[upper].endsWith(".jpg") ? "image/jpeg" : "image/png";
        dataUri = `data:${mime};base64,${buf.toString("base64")}`;
      }
    } catch (err) {
      console.warn(`[og/news] CDN icon fetch failed for ${upper}:`, err);
    }
  }

  if (dataUri) iconCache.set(upper, dataUri);
  return dataUri;
}

// ── Markup builders ────────────────────────────────────────

/**
 * Asset chip — Option B styling. 72px circular asset icon + ticker + direction
 * word, in a rounded pill with a tinted background that signals direction.
 * Compact compared to the legacy full-width direction-row design but with
 * asset icon large enough to survive Telegram mobile compression.
 */
function chipHtml(ticker: string, direction: "bullish" | "bearish", iconDataUri: string | null): string {
  const bg = direction === "bullish" ? BULLISH_CHIP_BG : BEARISH_CHIP_BG;
  const fg = direction === "bullish" ? BULLISH_CHIP_FG : BEARISH_CHIP_FG;
  const iconEl = iconDataUri
    ? `<img src="${iconDataUri}" style="width: 72px; height: 72px; border-radius: 36px; background: #ffffff;" />`
    : `<div style="display: flex; align-items: center; justify-content: center; width: 72px; height: 72px; border-radius: 36px; background: #ffffff; font-family: 'Space Grotesk'; font-weight: 800; font-size: 30px; color: ${INK};">${ticker.charAt(0)}</div>`;
  return (
    `<div style="display: flex; align-items: center; gap: 18px; padding: 8px 28px 8px 8px; border-radius: 999px; background: ${bg}; color: ${fg};">` +
      iconEl +
      `<span style="font-family: 'Inter'; font-weight: 600; font-size: 32px;">${ticker} ${direction}</span>` +
    `</div>`
  );
}

/**
 * Source logo for the article block. Real PNG when we have it in the map;
 * dark monogram square fallback otherwise.
 */
function sourceLogoHtml(source: string): string {
  const dataUri = getSourceLogoDataUri(source);
  if (dataUri) {
    return `<img src="${dataUri}" style="width: 56px; height: 56px; border-radius: 10px;" />`;
  }
  // Monogram fallback — dark ink square with cream initial. Distinguishable
  // from real logos so we can spot outlets that still need PNGs.
  const initial = (source.charAt(0) || "·").toUpperCase();
  return (
    `<div style="display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 10px; background: ${INK}; color: ${CREAM}; font-family: 'Space Grotesk'; font-weight: 700; font-size: 26px;">` +
      initial +
    `</div>`
  );
}

// ── Handler ────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!validateAuth(req, res)) return;

  const { bullish, bearish, headline, velaRead, date, source, publishedAt } = req.query;

  if (!headline) {
    return res.status(400).json({ error: "Missing required param: headline" });
  }

  const headlineStr = decodeHtmlEntities(String(headline));
  // velaRead is optional. When omitted the layout falls back to the
  // headline-prominent mode so the image doesn't ship with an orphan pill.
  const velaReadStr = velaRead
    ? decodeHtmlEntities(String(velaRead)).replace(/^[a-z]/, (c) => c.toUpperCase())
    : "";
  const dateStr = date
    ? formatTimestamp(String(date))
    : formatTimestamp(new Date().toISOString());

  const sourceStr = source ? decodeHtmlEntities(String(source)) : "";
  const publishedAtStr = publishedAt ? String(publishedAt) : "";
  const articleTimeFormatted = formatArticleTimestamp(publishedAtStr || undefined);

  // Defense-in-depth: never render internal classifier tags (_macro, _market)
  // or anything starting with `_` as if it were a tradeable asset. The
  // backend filters these in bucketAssetsForDisplay; this is a second wall.
  const isDisplayableTicker = (t: string) => t.length > 0 && !t.startsWith("_");
  const bullishTickers = bullish ? String(bullish).split(",").map((t) => t.trim()).filter(isDisplayableTicker) : [];
  const bearishTickers = bearish ? String(bearish).split(",").map((t) => t.trim()).filter(isDisplayableTicker) : [];
  const hasChips = bullishTickers.length > 0 || bearishTickers.length > 0;
  const hasVelaRead = velaReadStr.length > 0;

  const velaIcon = getVelaIconDataUri();

  // Resolve all asset icons in parallel
  const allTickers = [...bullishTickers, ...bearishTickers];
  const iconPairs = await Promise.all(
    allTickers.map(async (t) => [t.toUpperCase(), await resolveAssetIcon(t)] as const)
  );
  const iconMap = new Map(iconPairs);

  // Chip row — bullish first, then bearish, inline.
  const chipsMarkup = hasChips
    ? `<div style="display: flex; gap: 20px; margin-top: 36px; flex-wrap: wrap;">` +
        bullishTickers
          .map((t) => chipHtml(t.toUpperCase(), "bullish", iconMap.get(t.toUpperCase()) ?? null))
          .join("") +
        bearishTickers
          .map((t) => chipHtml(t.toUpperCase(), "bearish", iconMap.get(t.toUpperCase()) ?? null))
          .join("") +
      `</div>`
    : "";

  // Article attribution block — logo + headline + outlet/time meta.
  // Used in the velaRead-present layout (bordered) and the headline-prominent
  // fallback layout (flat, no border).
  //
  // Satori requires explicit display:flex on any element with more than one
  // child, so the meta line is a flex container with up to three sibling
  // elements (bold source + dot separator + muted time) rather than a single
  // span with mixed element/text children. A single-text-child span on the
  // outer wrapper would throw at render time.
  const articleMetaLine = sourceStr
    ? `<div style="display: flex; align-items: baseline; font-family: 'Inter'; font-size: 24px;">` +
        `<span style="font-weight: 700; color: ${INK};">${sourceStr}</span>` +
        (articleTimeFormatted
          ? `<span style="font-weight: 500; color: ${INK_60}; margin-left: 10px;">·</span>` +
            `<span style="font-weight: 500; color: ${INK_60}; margin-left: 10px;">${articleTimeFormatted}</span>`
          : "") +
      `</div>`
    : "";

  // Only render the bordered article block when we actually have a source.
  // Without a source, the block would render an orphan monogram square ("·")
  // beside the headline with nothing to attribute — a visual hole. The
  // contract says source is non-optional, but degrade gracefully if it's
  // ever missing.
  const articleBlockBordered = sourceStr
    ? `<div style="display: flex; align-items: flex-start; gap: 22px; border: 2px solid ${HAIRLINE}; border-radius: 20px; padding: 24px 28px;">` +
        sourceLogoHtml(sourceStr) +
        `<div style="display: flex; flex-direction: column; flex: 1;">` +
          `<span style="font-family: 'Inter'; font-weight: 500; font-size: 30px; line-height: 1.35; color: ${INK_60}; margin-bottom: 8px;">${headlineStr}</span>` +
          articleMetaLine +
        `</div>` +
      `</div>`
    : "";

  // Flat attribution row used in the headline-prominent fallback. Logo +
  // outlet name + date on a single row.
  const flatAttributionRow = sourceStr
    ? `<div style="display: flex; align-items: center; gap: 22px; margin-top: 8px;">` +
        sourceLogoHtml(sourceStr) +
        `<span style="font-family: 'Inter'; font-weight: 700; font-size: 30px; color: ${INK};">${sourceStr}</span>` +
        (articleTimeFormatted
          ? `<span style="font-family: 'Inter'; font-weight: 500; font-size: 28px; color: ${INK_60};">· ${articleTimeFormatted}</span>`
          : "") +
      `</div>`
    : "";

  // Body markup, branched on velaRead presence.
  // - With velaRead: pill + hero + article block (+ chips).
  // - Without velaRead: headline-prominent layout (+ chips). Pill is skipped
  //   so we don't render an orphan "Vela's read" label with nothing under it.
  const heroFontSize = hasChips ? 66 : 72;
  const headlineFallbackSize = hasChips ? 60 : 72;
  const bodyInner = hasVelaRead
    ? `<div style="display: flex; align-self: flex-start; background: ${INK}; color: ${CREAM}; padding: 10px 24px; border-radius: 999px; font-family: 'Inter'; font-weight: 700; font-size: 22px; letter-spacing: 0.10em; text-transform: uppercase; margin-bottom: 28px;">Vela's read</div>` +
      `<span style="font-family: 'Space Grotesk'; font-weight: 700; font-size: ${heroFontSize}px; line-height: 1.15; letter-spacing: -0.015em; color: ${INK}; margin-bottom: 32px;">${velaReadStr}</span>` +
      articleBlockBordered +
      chipsMarkup
    : `<span style="font-family: 'Space Grotesk'; font-weight: 700; font-size: ${headlineFallbackSize}px; line-height: 1.15; letter-spacing: -0.015em; color: ${INK}; margin-bottom: 20px;">${headlineStr}</span>` +
      flatAttributionRow +
      chipsMarkup;

  const markupString =
    `<div style="display: flex; flex-direction: column; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; background: ${CREAM}; border: 6px solid ${INK}; position: relative; font-family: 'Inter';">` +
      // Header — unchanged
      `<div style="display: flex; justify-content: space-between; align-items: center; padding: 44px 56px 0;">` +
        `<div style="display: flex; align-items: center; gap: 12px;">` +
          `<img src="${velaIcon}" style="width: 36px; height: 36px;" />` +
          `<span style="font-family: 'Space Grotesk'; font-weight: 800; font-size: 44px; letter-spacing: -0.03em; color: ${INK};">vela</span>` +
        `</div>` +
        `<span style="font-family: 'Inter'; font-weight: 500; font-size: 26px; color: ${GREY_TEXT};">${dateStr}</span>` +
      `</div>` +
      // Body — vertically centered, branched per hasVelaRead above.
      `<div style="display: flex; flex-direction: column; flex: 1; padding: 56px 88px 120px; justify-content: center;">` +
        bodyInner +
      `</div>` +
      // Footer — unchanged
      `<div style="display: flex; position: absolute; bottom: 0; left: 0; width: ${CARD_WIDTH}px; height: 88px; background: ${INK}; padding: 0 56px; justify-content: space-between; align-items: center;">` +
        `<span style="font-family: 'Inter'; font-weight: 500; font-size: 26px; color: ${GREY_TEXT};">getvela.xyz</span>` +
        `<span style="font-family: 'Inter'; font-weight: 600; font-size: 26px; color: ${SIGNAL_GREEN};">Read full brief →</span>` +
      `</div>` +
    `</div>`;

  try {
    const svg = await satori(html(markupString) as unknown as React.ReactNode, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts: getSatoriFonts(),
    });
    const png = await svgToPng(svg);

    res.setHeader("Content-Type", "image/png");
    // Cache aggressively: same params -> same image. 1h CDN cache.
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    return res.send(png);
  } catch (err) {
    console.error("[og/news] Generation failed:", err);
    return res.status(500).json({ error: "Image generation failed" });
  }
}
