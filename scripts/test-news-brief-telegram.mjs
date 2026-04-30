// scripts/test-news-brief-telegram.mjs
//
// Throwaway: render news-brief cards and send to admin Telegram chat.
// Run from /Users/henry/crypto-agent-frontend with: node scripts/test-news-brief-telegram.mjs
//
// Sends 2 messages:
//   1. Single-direction (user holds HYPE + BTC; both bullish)
//   2. Mixed-direction  (user holds HYPE + OIL; bullish + bearish)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import satori from "satori";
import { html } from "satori-html";
import { Resvg } from "@resvg/resvg-js";

// ── Credentials ─────────────────────────────────────────────
const TOKEN = "8709071962:AAEMcEBwx1PNS6vy7mlvRFE-bocHzRxLJGQ";
const CHAT_ID = "950571987";

// ── Brand tokens ────────────────────────────────────────────
const CREAM = "#FFFBF5";
const INK = "#0A0A0A";
const SIGNAL_GREEN = "#0FE68C";
const SIGNAL_RED = "#FF4757";
const GREY_TEXT = "#9CA3AF";
const BODY_TEXT = "#374151";

// ── Story content (shared across both sends) ────────────────
const headline = "UAE leaves OPEC in major blow to oil cartel";
const velaRead = "Adds supply pressure, weakens OPEC's defense of prices.";
const dateLabel = "Apr 30, 2026";
const summaryBody =
  "UAE is leaving OPEC and OPEC+, the second defection after Qatar in 2019. UAE wants " +
  "freedom to pump more oil and capture market share rather than stick to quotas.";

// Real recent news_cache id used for the deep link
const newsId = "f38b116f-87fe-40dd-a0f3-5bcc2113b599";
const briefUrl = `https://app.getvela.xyz/news/${newsId}`;

// ── Asset icon resolution ───────────────────────────────────
const ASSET_ICONS = {
  HYPE: { url: "https://coin-images.coingecko.com/coins/images/50882/small/hyperliquid.jpg" },
  BTC:  { url: "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png" },
  ETH:  { url: "https://coin-images.coingecko.com/coins/images/279/small/ethereum.png" },
  OIL:  { local: "public/icons/oil.png" },
};

// ── Helpers ─────────────────────────────────────────────────
const root = process.cwd();

function fileToDataUri(relPath) {
  const buf = readFileSync(join(root, relPath));
  const ext = relPath.split(".").pop().toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function urlToDataUri(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const lower = url.toLowerCase();
  const mime = lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function resolveAssetIcon(ticker) {
  const cfg = ASSET_ICONS[ticker];
  if (!cfg) throw new Error(`Unknown asset: ${ticker}`);
  return cfg.local ? fileToDataUri(cfg.local) : urlToDataUri(cfg.url);
}

// ── Card renderer ───────────────────────────────────────────
//
// Per-user logic: render direction rows ONLY for assets the user holds.
//   - bullishHeld: user-held assets that the news tags as bullish
//   - bearishHeld: user-held assets that the news tags as bearish
// Empty arrays = no row. Both empty = headline + read line only.
//
async function buildCard({ bullishHeld, bearishHeld, fonts, velaIcon }) {
  const rows = [];

  if (bullishHeld.length > 0) {
    const chips = await Promise.all(
      bullishHeld.map(async (t) => {
        const icon = await resolveAssetIcon(t);
        return (
          `<div style="display: flex; align-items: center; gap: 14px; padding: 12px 24px 12px 12px; border: 4px solid ${INK}; background: #ffffff; height: 76px;">` +
            `<img src="${icon}" style="width: 52px; height: 52px; border-radius: 26px; border: 3px solid ${INK}; background: #ffffff;" />` +
            `<span style="font-family: 'Space Grotesk'; font-weight: 800; font-size: 30px; color: ${INK}; letter-spacing: -0.01em;">${t}</span>` +
          `</div>`
        );
      })
    );
    rows.push(
      `<div style="display: flex; align-items: center; gap: 20px; margin-bottom: 22px;">` +
        `<div style="display: flex; align-items: center; height: 76px; padding: 0 24px; border: 4px solid ${INK}; background: ${SIGNAL_GREEN}; color: ${INK}; font-family: 'Inter'; font-weight: 800; font-size: 22px; letter-spacing: 0.06em; text-transform: uppercase;">Bullish</div>` +
        chips.join("") +
      `</div>`
    );
  }

  if (bearishHeld.length > 0) {
    const chips = await Promise.all(
      bearishHeld.map(async (t) => {
        const icon = await resolveAssetIcon(t);
        return (
          `<div style="display: flex; align-items: center; gap: 14px; padding: 12px 24px 12px 12px; border: 4px solid ${INK}; background: #ffffff; height: 76px;">` +
            `<img src="${icon}" style="width: 52px; height: 52px; border-radius: 26px; border: 3px solid ${INK}; background: #ffffff;" />` +
            `<span style="font-family: 'Space Grotesk'; font-weight: 800; font-size: 30px; color: ${INK}; letter-spacing: -0.01em;">${t}</span>` +
          `</div>`
        );
      })
    );
    rows.push(
      `<div style="display: flex; align-items: center; gap: 20px;">` +
        `<div style="display: flex; align-items: center; height: 76px; padding: 0 24px; border: 4px solid ${INK}; background: ${SIGNAL_RED}; color: ${CREAM}; font-family: 'Inter'; font-weight: 800; font-size: 22px; letter-spacing: 0.06em; text-transform: uppercase;">Bearish</div>` +
        chips.join("") +
      `</div>`
    );
  }

  const markupString =
    `<div style="display: flex; flex-direction: column; width: 1600px; height: 900px; background: ${CREAM}; border: 6px solid ${INK}; position: relative; font-family: 'Inter';">` +
      // Header
      `<div style="display: flex; justify-content: space-between; align-items: center; padding: 44px 56px 0;">` +
        `<div style="display: flex; align-items: center; gap: 12px;">` +
          `<img src="${velaIcon}" style="width: 36px; height: 36px;" />` +
          `<span style="font-family: 'Space Grotesk'; font-weight: 800; font-size: 44px; letter-spacing: -0.03em; color: ${INK};">vela</span>` +
        `</div>` +
        `<span style="font-family: 'Inter'; font-weight: 500; font-size: 26px; color: ${GREY_TEXT};">${dateLabel}</span>` +
      `</div>` +
      // Body
      `<div style="display: flex; flex-direction: column; padding: 64px 112px 0;">` +
        `<span style="font-family: 'Space Grotesk'; font-weight: 800; font-size: 76px; line-height: 1.05; letter-spacing: -0.02em; color: ${INK}; margin-bottom: 32px;">${headline}</span>` +
        `<span style="font-family: 'Inter'; font-weight: 400; font-size: 40px; line-height: 1.4; color: ${BODY_TEXT}; margin-bottom: 56px;">${velaRead}</span>` +
        `<div style="display: flex; flex-direction: column;">${rows.join("")}</div>` +
      `</div>` +
      // Footer
      `<div style="display: flex; position: absolute; bottom: 0; left: 0; width: 1588px; height: 88px; background: ${INK}; padding: 0 56px; justify-content: space-between; align-items: center;">` +
        `<span style="font-family: 'Inter'; font-weight: 500; font-size: 26px; color: ${GREY_TEXT};">getvela.xyz</span>` +
        `<span style="font-family: 'Inter'; font-weight: 600; font-size: 26px; color: ${SIGNAL_GREEN};">Read full brief →</span>` +
      `</div>` +
    `</div>`;

  const svg = await satori(html(markupString), { width: 1600, height: 900, fonts });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1600 } });
  return Buffer.from(resvg.render().asPng());
}

// ── Caption builder ─────────────────────────────────────────
function buildCaption(velaReadLine) {
  return (
    `*${headline}*\n\n` +
    `${summaryBody}\n\n` +
    `*Vela's read:* ${velaReadLine}\n\n` +
    `[Read full brief →](${briefUrl})`
  );
}

// ── Send to Telegram ────────────────────────────────────────
async function sendToTelegram(png, caption, label) {
  const formData = new FormData();
  formData.append("chat_id", CHAT_ID);
  formData.append("caption", caption);
  formData.append("parse_mode", "Markdown");
  formData.append("photo", new Blob([png], { type: "image/png" }), `news-${label}.png`);

  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
    method: "POST",
    body: formData,
  });
  const result = await res.json();
  if (!res.ok || !result.ok) {
    console.error(`Telegram error (${label}):`, JSON.stringify(result, null, 2));
    process.exit(1);
  }
  return result.result.message_id;
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  console.log("[1/4] Loading fonts...");
  const fontsDir = join(root, "public/fonts");
  const fonts = [
    { name: "Space Grotesk", data: readFileSync(join(fontsDir, "SpaceGrotesk-Bold.woff")), weight: 800 },
    { name: "Space Grotesk", data: readFileSync(join(fontsDir, "SpaceGrotesk-Bold.woff")), weight: 700 },
    { name: "Inter", data: readFileSync(join(fontsDir, "Inter-Regular.woff")), weight: 400 },
    { name: "Inter", data: readFileSync(join(fontsDir, "Inter-Medium.woff")), weight: 500 },
    { name: "Inter", data: readFileSync(join(fontsDir, "Inter-Bold.woff")), weight: 700 },
  ];
  const velaIcon = fileToDataUri("public/vela-icon.png");

  console.log("[2/4] Rendering single-direction card (user holds HYPE + BTC)...");
  const png1 = await buildCard({ bullishHeld: ["HYPE", "BTC"], bearishHeld: [], fonts, velaIcon });
  writeFileSync("/tmp/news-brief-single.png", png1);

  console.log("[3/4] Rendering mixed-direction card (user holds HYPE + OIL)...");
  const png2 = await buildCard({ bullishHeld: ["HYPE"], bearishHeld: ["OIL"], fonts, velaIcon });
  writeFileSync("/tmp/news-brief-mixed.png", png2);

  console.log("[4/4] Sending to Telegram...");

  const id1 = await sendToTelegram(
    png1,
    buildCaption("Bullish for your HYPE & BTC longs."),
    "single",
  );
  console.log(`    Single-direction sent · message_id=${id1}`);

  const id2 = await sendToTelegram(
    png2,
    buildCaption(
      "Bullish for your HYPE long, but mildly bearish for your OIL long. We're monitoring closely.",
    ),
    "mixed",
  );
  console.log(`    Mixed-direction sent · message_id=${id2}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
