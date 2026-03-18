// api/og/digest.ts
//
// POST /api/og/digest
// Body: { items: [{ title: string, detail: string }], date?: string }
//
// Generates a 1600x900 PNG digest card matching the neobrutalist design
// from social-cards.ts generateDigestCardSvg().

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
  BODY_TEXT,
} from "./_shared.js";

interface DigestItem {
  title: string;
  detail: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  if (!validateAuth(req, res)) return;

  const body = req.body as { items?: DigestItem[]; date?: string };

  if (!body?.items || !Array.isArray(body.items) || body.items.length === 0) {
    return res
      .status(400)
      .json({ error: "Missing required body: { items: [{ title, detail }] }" });
  }

  const items = body.items.slice(0, 3);
  const dateStr = formatTimestamp(body.date ?? new Date().toISOString());
  const iconUri = getVelaIconDataUri();

  // Build digest items HTML
  const itemsHtml = items
    .map(
      (item, i) => `
      <div style="display: flex; align-items: flex-start; gap: 20px; padding: 0 112px;">
        <span style="font-family: Space Grotesk; font-weight: 800; font-size: 56px; color: ${SIGNAL_GREEN}; min-width: 50px;">${i + 1}</span>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <span style="font-family: Inter; font-weight: 600; font-size: 28px; color: ${INK};">${escapeHtml(decodeHtmlEntities(item.title))}</span>
          <span style="font-family: Inter; font-weight: 400; font-size: 24px; color: ${BODY_TEXT}; line-height: 1.4;">${escapeHtml(decodeHtmlEntities(item.detail))}</span>
        </div>
      </div>
    `,
    )
    .join("");

  // IMPORTANT: Use html() as a function call, NOT as a tagged template literal.
  // Tagged template `html\`...\`` escapes interpolated strings as text content,
  // which causes itemsHtml's <div>/<span> tags to render as "&lt;div&gt;" etc.
  // Calling html(string) parses the entire string as HTML markup.
  // User-provided text is already escaped via escapeHtml() above.
  const markup = html(`
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
          >${dateStr}</span
        >
      </div>

      <!-- Title -->
      <div style="display: flex; padding: 40px 0 0 112px;">
        <span
          style="font-family: Space Grotesk; font-weight: 700; font-size: 48px; color: ${INK};"
          >3 things moving markets today</span
        >
      </div>

      <!-- Items -->
      <div
        style="display: flex; flex-direction: column; gap: 28px; padding-top: 40px;"
      >
        ${itemsHtml}
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
          style="font-family: Inter; font-weight: 600; font-size: 26px; color: #0FE68C;"
          >Read the full digest</span
        >
      </div>
    </div>
  `);

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
    console.error("[og/digest] Generation failed:", err);
    return res.status(500).json({ error: "Image generation failed" });
  }
}
