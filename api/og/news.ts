// api/og/news.ts
//
// GET /api/og/news?bullish=HYPE,BTC&bearish=OIL&headline=...&velaRead=...&date=2026-04-30
//
// Generates a 1600x900 PNG news brief card. Per-user: only renders direction
// rows for assets the user holds. Empty `bullish` and `bearish` params produce
// a card with headline + Vela's read only. Vercel's edge cache dedupes by URL,
// so users with identical held-asset intersections share the rendered PNG.
//
// Spec: docs/product-briefs/news-brief-image.md

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
  SIGNAL_RED,
  GREY_TEXT,
  BODY_TEXT,
} from "./_shared.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

function chipHtml(ticker: string, iconDataUri: string | null): string {
  const iconEl = iconDataUri
    ? `<img src="${iconDataUri}" style="width: 68px; height: 68px; border-radius: 34px; border: 3px solid ${INK}; background: #ffffff;" />`
    // Fallback: monogram circle if icon unresolved
    : `<div style="display: flex; align-items: center; justify-content: center; width: 68px; height: 68px; border-radius: 34px; border: 3px solid ${INK}; background: #ffffff; font-family: 'Space Grotesk'; font-weight: 800; font-size: 28px; color: ${INK};">${ticker.charAt(0)}</div>`;
  return (
    `<div style="display: flex; align-items: center; gap: 16px; padding: 14px 32px 14px 14px; border: 4px solid ${INK}; background: #ffffff; height: 100px;">` +
      iconEl +
      `<span style="font-family: 'Space Grotesk'; font-weight: 800; font-size: 38px; color: ${INK}; letter-spacing: -0.01em;">${ticker}</span>` +
    `</div>`
  );
}

function directionRow(label: "Bullish" | "Bearish", chips: string, isLast: boolean): string {
  const bg = label === "Bullish" ? SIGNAL_GREEN : SIGNAL_RED;
  const tx = label === "Bullish" ? INK : CREAM;
  const margin = isLast ? "" : "margin-bottom: 24px;";
  return (
    `<div style="display: flex; align-items: center; gap: 24px; ${margin}">` +
      `<div style="display: flex; align-items: center; height: 100px; padding: 0 32px; border: 4px solid ${INK}; background: ${bg}; color: ${tx}; font-family: 'Inter'; font-weight: 800; font-size: 28px; letter-spacing: 0.06em; text-transform: uppercase;">${label}</div>` +
      chips +
    `</div>`
  );
}

// ── Handler ────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!validateAuth(req, res)) return;

  const { bullish, bearish, headline, velaRead, date } = req.query;

  if (!headline) {
    return res.status(400).json({ error: "Missing required param: headline" });
  }

  const headlineStr = decodeHtmlEntities(String(headline));
  // velaRead is optional. When omitted the read-line span is skipped entirely
  // so the layout collapses cleanly rather than rendering an empty gap.
  const velaReadStr = velaRead ? decodeHtmlEntities(String(velaRead)) : "";
  const dateStr = date
    ? formatTimestamp(String(date))
    : formatTimestamp(new Date().toISOString());

  const bullishTickers = bullish ? String(bullish).split(",").map((t) => t.trim()).filter(Boolean) : [];
  const bearishTickers = bearish ? String(bearish).split(",").map((t) => t.trim()).filter(Boolean) : [];

  const velaIcon = getVelaIconDataUri();

  // Resolve all icons in parallel
  const allTickers = [...bullishTickers, ...bearishTickers];
  const iconPairs = await Promise.all(
    allTickers.map(async (t) => [t.toUpperCase(), await resolveAssetIcon(t)] as const)
  );
  const iconMap = new Map(iconPairs);

  const rows: string[] = [];
  if (bullishTickers.length > 0) {
    const chips = bullishTickers.map((t) => chipHtml(t.toUpperCase(), iconMap.get(t.toUpperCase()) ?? null)).join("");
    rows.push(directionRow("Bullish", chips, bearishTickers.length === 0));
  }
  if (bearishTickers.length > 0) {
    const chips = bearishTickers.map((t) => chipHtml(t.toUpperCase(), iconMap.get(t.toUpperCase()) ?? null)).join("");
    rows.push(directionRow("Bearish", chips, true));
  }

  const markupString =
    `<div style="display: flex; flex-direction: column; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; background: ${CREAM}; border: 6px solid ${INK}; position: relative; font-family: 'Inter';">` +
      // Header
      `<div style="display: flex; justify-content: space-between; align-items: center; padding: 44px 56px 0;">` +
        `<div style="display: flex; align-items: center; gap: 12px;">` +
          `<img src="${velaIcon}" style="width: 36px; height: 36px;" />` +
          `<span style="font-family: 'Space Grotesk'; font-weight: 800; font-size: 44px; letter-spacing: -0.03em; color: ${INK};">vela</span>` +
        `</div>` +
        `<span style="font-family: 'Inter'; font-weight: 500; font-size: 26px; color: ${GREY_TEXT};">${dateStr}</span>` +
      `</div>` +
      // Body — fills space between header and absolute footer.
      // When direction rows present: top-aligned, normal headline/read sizes.
      // When no rows: vertically centered with bumped fonts to fill the canvas.
      // velaRead is optional; the span is omitted entirely when empty so the
      // layout doesn't reserve a blank line.
      (rows.length === 0
        ? `<div style="display: flex; flex-direction: column; flex: 1; padding: 0 112px 88px; justify-content: center;">` +
            `<span style="font-family: 'Space Grotesk'; font-weight: 800; font-size: 96px; line-height: 1.05; letter-spacing: -0.02em; color: ${INK};${velaReadStr ? " margin-bottom: 36px;" : ""}">${headlineStr}</span>` +
            (velaReadStr
              ? `<span style="font-family: 'Inter'; font-weight: 400; font-size: 50px; line-height: 1.4; color: ${BODY_TEXT};">${velaReadStr}</span>`
              : "") +
          `</div>`
        : `<div style="display: flex; flex-direction: column; flex: 1; padding: 64px 112px 88px;">` +
            `<span style="font-family: 'Space Grotesk'; font-weight: 800; font-size: 76px; line-height: 1.05; letter-spacing: -0.02em; color: ${INK}; margin-bottom: ${velaReadStr ? "32px" : "56px"};">${headlineStr}</span>` +
            (velaReadStr
              ? `<span style="font-family: 'Inter'; font-weight: 400; font-size: 40px; line-height: 1.4; color: ${BODY_TEXT}; margin-bottom: 56px;">${velaReadStr}</span>`
              : "") +
            `<div style="display: flex; flex-direction: column;">${rows.join("")}</div>` +
          `</div>`) +
      // Footer
      `<div style="display: flex; position: absolute; bottom: 0; left: 0; width: 1588px; height: 88px; background: ${INK}; padding: 0 56px; justify-content: space-between; align-items: center;">` +
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
