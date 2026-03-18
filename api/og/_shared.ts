// api/og/_shared.ts
//
// Shared utilities for Satori-based social card generation.
// Font loading, brand colors, SVG-to-PNG pipeline.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ── Brand Colors (from vela-design-system.css) ────────────────────

export const CREAM = "#FFFBF5";
export const INK = "#0A0A0A";
export const SIGNAL_GREEN = "#0FE68C";
export const SIGNAL_RED = "#FF4757";
export const SIGNAL_GREY = "#EBEBEB";
export const GREY_TEXT = "#9CA3AF";
export const BODY_TEXT = "#374151";

export const BADGE_COLORS: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  green: { bg: SIGNAL_GREEN, text: INK, label: "Buy Signal" },
  red: { bg: SIGNAL_RED, text: CREAM, label: "Sell Signal" },
  grey: { bg: SIGNAL_GREY, text: "#6B7280", label: "Wait" },
};

// ── Card Dimensions ───────────────────────────────────────────────

export const CARD_WIDTH = 1600;
export const CARD_HEIGHT = 900;

// ── Logo Icon (PNG data URI, cached) ─────────────────────────────

let iconDataUri: string | null = null;

export function getVelaIconDataUri(): string {
  if (iconDataUri) return iconDataUri;
  const iconPath = join(process.cwd(), "public", "vela-icon.png");
  const iconBuf = readFileSync(iconPath);
  iconDataUri = `data:image/png;base64,${iconBuf.toString("base64")}`;
  return iconDataUri;
}

// ── Font Loading (cached across invocations) ──────────────────────

let fontsLoaded = false;
let spaceGroteskBold: ArrayBuffer;
let interRegular: ArrayBuffer;
let interMedium: ArrayBuffer;
let interSemiBold: ArrayBuffer;
let interBold: ArrayBuffer;

function loadFonts() {
  if (fontsLoaded) return;

  const fontsDir = join(process.cwd(), "public", "fonts");
  spaceGroteskBold = readFileSync(join(fontsDir, "SpaceGrotesk-Bold.woff"))
    .buffer as ArrayBuffer;
  interRegular = readFileSync(join(fontsDir, "Inter-Regular.woff"))
    .buffer as ArrayBuffer;
  interMedium = readFileSync(join(fontsDir, "Inter-Medium.woff"))
    .buffer as ArrayBuffer;
  interSemiBold = readFileSync(join(fontsDir, "Inter-SemiBold.woff"))
    .buffer as ArrayBuffer;
  interBold = readFileSync(join(fontsDir, "Inter-Bold.woff"))
    .buffer as ArrayBuffer;
  fontsLoaded = true;
}

export function getSatoriFonts() {
  loadFonts();
  return [
    { name: "Space Grotesk", data: spaceGroteskBold, weight: 700 as const },
    { name: "Space Grotesk", data: spaceGroteskBold, weight: 800 as const },
    { name: "Inter", data: interRegular, weight: 400 as const },
    { name: "Inter", data: interMedium, weight: 500 as const },
    { name: "Inter", data: interSemiBold, weight: 600 as const },
    { name: "Inter", data: interBold, weight: 700 as const },
  ];
}

// ── Auth ──────────────────────────────────────────────────────────

export function validateAuth(
  req: VercelRequest,
  res: VercelResponse,
): boolean {
  const secret = process.env.OG_IMAGE_SECRET;
  if (!secret) {
    console.error("[og] OG_IMAGE_SECRET not configured");
    res.status(500).json({ error: "Server misconfigured" });
    return false;
  }

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

// ── SVG to PNG ───────────────────────────────────────────────────

export async function svgToPng(svg: string): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width" as const, value: CARD_WIDTH },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

// ── Helpers ──────────────────────────────────────────────────────

/** Decode common HTML entities that may leak from brief generation */
export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function formatPrice(price: number): string {
  if (price >= 1000) {
    return "$" + price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return "$" + price.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

