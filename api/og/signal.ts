// api/og/signal.ts
//
// GET /api/og/signal?asset=BTC&color=green&price=71000&headline=...&timestamp=...
//
// Generates a 1600x900 PNG signal card matching the neobrutalist design
// from social-cards.ts generateSignalCardSvg().

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
  GREY_TEXT,
  BODY_TEXT,
  BADGE_COLORS,
} from "./_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!validateAuth(req, res)) return;

  const { asset, color, price, headline, timestamp } = req.query;

  if (!asset || !color || !price || !headline) {
    return res
      .status(400)
      .json({ error: "Missing required params: asset, color, price, headline" });
  }

  const assetStr = String(asset).toUpperCase();
  const colorStr = String(color);
  const priceNum = Number(price);
  const headlineStr = String(headline);
  const timestampStr = timestamp ? String(timestamp) : new Date().toISOString();

  const badge = BADGE_COLORS[colorStr] ?? BADGE_COLORS.grey;
  const priceFormatted = formatPrice(priceNum);
  const dateFormatted = formatTimestamp(timestampStr);
  const iconUri = getVelaIconDataUri();

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
          style="display: flex; align-items: center; justify-content: center; padding: 8px 24px; background-color: ${badge.bg}; border: 4px solid ${INK}; font-family: Inter; font-weight: 700; font-size: 26px; letter-spacing: 0.05em; color: ${badge.text};"
        >
          ${badge.label.toUpperCase()}
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

      <!-- Price -->
      <div style="display: flex; padding: 8px 0 0 112px;">
        <span
          style="font-family: Space Grotesk; font-weight: 700; font-size: 48px; color: ${BODY_TEXT};"
          >${priceFormatted}</span
        >
      </div>

      <!-- Headline -->
      <div
        style="display: flex; padding: 24px 112px 0 112px; max-width: 1400px;"
      >
        <span
          style="font-family: Inter; font-weight: 400; font-size: 30px; color: ${BODY_TEXT}; line-height: 1.5;"
          >${headlineStr}</span
        >
      </div>

      <!-- Footer -->
      <div
        style="display: flex; justify-content: space-between; align-items: center; width: 1594px; height: 97px; padding: 0 56px; background-color: ${INK}; position: absolute; bottom: 0; left: 0;"
      >
        <span
          style="font-family: Inter; font-weight: 500; font-size: 26px; color: ${GREY_TEXT};"
          >getvela.xyz</span
        >
        <span
          style="font-family: Inter; font-weight: 600; font-size: 26px; color: #0FE68C;"
          >See full breakdown</span
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
    console.error("[og/signal] Generation failed:", err);
    return res.status(500).json({ error: "Image generation failed" });
  }
}
