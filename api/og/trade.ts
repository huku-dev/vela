// api/og/trade.ts
//
// GET /api/og/trade?asset=BTC&entry=68200&exit=71680&pnlPct=5.1&days=4&timestamp=...
//
// Generates a 1600x900 PNG trade-closed card matching the neobrutalist design.
// P&L is percentage-based (not dollar amounts, which are position-size-dependent).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import satori from "satori";
import { html } from "satori-html";
import {
  validateAuth,
  getSatoriFonts,
  svgToPng,
  formatPrice,
  formatTimestamp,
  getVelaIconDataUri,
  CARD_WIDTH,
  CARD_HEIGHT,
  CREAM,
  INK,
  SIGNAL_GREEN,
  SIGNAL_RED,
  GREY_TEXT,
  BODY_TEXT,
} from "./_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!validateAuth(req, res)) return;

  const { asset, entry, exit, pnlPct, days, timestamp, direction } = req.query;

  if (!asset || !entry || !exit || !pnlPct || !days) {
    return res.status(400).json({
      error: "Missing required params: asset, entry, exit, pnlPct, days",
    });
  }

  const assetStr = String(asset).toUpperCase();
  const entryPrice = Number(entry);
  const exitPrice = Number(exit);
  const pnlPctNum = Number(pnlPct);
  const daysHeld = Number(days);
  const timestampStr = timestamp ? String(timestamp) : new Date().toISOString();
  const directionStr = direction ? String(direction) : (exitPrice > entryPrice ? "Long" : "Short");

  const isProfit = pnlPctNum >= 0;
  const pnlColor = isProfit ? SIGNAL_GREEN : SIGNAL_RED;
  const pnlSign = isProfit ? "+" : "";
  const badgeBg = isProfit ? SIGNAL_GREEN : SIGNAL_RED;
  const badgeText = isProfit ? INK : CREAM;
  const holdText = daysHeld === 1 ? "1 day" : `${daysHeld} days`;
  const dateFormatted = formatTimestamp(timestampStr);
  const iconUri = getVelaIconDataUri();

  // "$1,000 invested would have returned..." — makes percentage tangible
  const hypotheticalReturn = Math.abs(pnlPctNum * 10); // $1,000 * pct/100
  const hypotheticalText = isProfit
    ? `A $1,000 investment would have returned $${hypotheticalReturn.toFixed(0)} in profit`
    : `A $1,000 investment would have lost $${hypotheticalReturn.toFixed(0)}`;

  const badgeLabel = `${directionStr} · Trade Closed · ${pnlSign}${Math.abs(pnlPctNum).toFixed(1)}%`;

  const markup = html`
    <div
      style="display: flex; flex-direction: column; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; background-color: ${CREAM}; border: 6px solid ${INK}; position: relative; font-family: Inter;"
    >
      <!-- Header -->
      <div
        style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 40px 56px 0 56px;"
      >
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${iconUri}" style="width: 36px; height: 36px;" />
          <span
            style="font-family: Space Grotesk; font-weight: 800; font-size: 44px; letter-spacing: -0.03em; color: ${INK};"
            >vela</span
          >
        </div>
        <span
          style="font-family: Inter; font-weight: 500; font-size: 26px; color: ${GREY_TEXT};"
          >${dateFormatted}</span
        >
      </div>

      <!-- Badge -->
      <div style="display: flex; padding: 60px 0 0 112px;">
        <div
          style="display: flex; align-items: center; justify-content: center; padding: 8px 24px; background-color: ${badgeBg}; border: 4px solid ${INK}; font-family: Inter; font-weight: 700; font-size: 22px; letter-spacing: 0.03em; color: ${badgeText};"
        >
          ${badgeLabel.toUpperCase()}
        </div>
      </div>

      <!-- Asset Ticker -->
      <div
        style="display: flex; align-items: baseline; gap: 20px; padding: 40px 0 0 112px;"
      >
        <span
          style="font-family: Space Grotesk; font-weight: 800; font-size: 72px; letter-spacing: -0.02em; color: ${INK};"
          >${assetStr}</span
        >
      </div>

      <!-- Entry / Exit -->
      <div
        style="display: flex; align-items: center; gap: 16px; padding: 16px 0 0 112px;"
      >
        <span
          style="font-family: Inter; font-weight: 500; font-size: 32px; color: ${GREY_TEXT};"
          >Entry</span
        >
        <span
          style="font-family: Space Grotesk; font-weight: 700; font-size: 32px; color: ${BODY_TEXT};"
          >${formatPrice(entryPrice)}</span
        >
        <span
          style="font-family: Inter; font-weight: 400; font-size: 32px; color: ${GREY_TEXT};"
          >-></span
        >
        <span
          style="font-family: Inter; font-weight: 500; font-size: 32px; color: ${GREY_TEXT};"
          >Exit</span
        >
        <span
          style="font-family: Space Grotesk; font-weight: 700; font-size: 32px; color: ${BODY_TEXT};"
          >${formatPrice(exitPrice)}</span
        >
      </div>

      <!-- P&L Percentage (hero number) -->
      <div style="display: flex; padding: 24px 0 0 112px;">
        <span
          style="font-family: Space Grotesk; font-weight: 700; font-size: 48px; color: ${pnlColor};"
          >${pnlSign}${Math.abs(pnlPctNum).toFixed(1)}%</span
        >
      </div>

      <!-- Duration -->
      <div style="display: flex; padding: 12px 0 0 112px;">
        <span
          style="font-family: Inter; font-weight: 500; font-size: 28px; color: ${GREY_TEXT};"
          >Held for ${holdText}</span
        >
      </div>

      <!-- Hypothetical return -->
      <div style="display: flex; padding: 20px 0 0 112px;">
        <span
          style="font-family: Inter; font-weight: 600; font-size: 26px; color: ${pnlColor};"
          >${hypotheticalText}</span
        >
      </div>

      <!-- Footer -->
      <div
        style="display: flex; justify-content: space-between; align-items: center; width: 1594px; height: 97px; padding: 0 56px; background-color: ${INK}; position: absolute; bottom: 0; left: 0;"
      >
        <span
          style="font-family: Inter; font-weight: 500; font-size: 26px; color: ${GREY_TEXT};"
          >Markets never sleep. Neither does Vela.</span
        >
        <span
          style="font-family: Inter; font-weight: 500; font-size: 26px; color: ${GREY_TEXT};"
          >getvela.xyz</span
        >
      </div>
    </div>
  `;

  try {
    const svg = await satori(markup as unknown as React.ReactNode, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts: getSatoriFonts(),
    });

    const png = await svgToPng(svg);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(png);
  } catch (err) {
    console.error("[og/trade] Generation failed:", err);
    return res.status(500).json({ error: "Image generation failed" });
  }
}
