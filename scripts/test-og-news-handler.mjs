// scripts/test-og-news-handler.mjs
//
// Local handler-level test for api/og/news.ts. Bypasses HTTP — imports the
// handler directly and invokes it with a mock req/res. Writes resulting PNGs
// to /tmp for inspection.
//
// Run from /Users/henry/crypto-agent-frontend with: node scripts/test-og-news-handler.mjs

import { writeFileSync } from "node:fs";

// Set env var that validateAuth checks
process.env.OG_IMAGE_SECRET = "test-secret";

// Dynamic import after env set. Run with tsx to resolve the .ts source.
const { default: handler } = await import("../api/og/news.ts");

function makeMockReqRes(query) {
  let pngBuffer = null;
  let statusCode = 200;
  let body = null;
  const headers = {};

  const req = {
    method: "GET",
    headers: { authorization: "Bearer test-secret" },
    query,
  };
  const res = {
    setHeader(k, v) { headers[k] = v; },
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
    send(payload) {
      if (Buffer.isBuffer(payload)) pngBuffer = payload;
      else body = payload;
      return this;
    },
  };
  return { req, res, getResult: () => ({ statusCode, headers, body, pngBuffer }) };
}

async function runCase(label, query, outPath) {
  console.log(`\n[${label}]`);
  console.log("  query:", query);
  const { req, res, getResult } = makeMockReqRes(query);
  await handler(req, res);
  const { statusCode, headers, body, pngBuffer } = getResult();
  console.log(`  status: ${statusCode}`);
  if (pngBuffer) {
    writeFileSync(outPath, pngBuffer);
    console.log(`  PNG (${pngBuffer.length} bytes) -> ${outPath}`);
    console.log(`  Content-Type: ${headers["Content-Type"]}`);
    console.log(`  Cache-Control: ${headers["Cache-Control"]}`);
  } else {
    console.log("  body:", body);
  }
}

// Three cases mirroring the spec's conditional logic
await runCase(
  "single-direction (HYPE + BTC bullish)",
  {
    bullish: "HYPE,BTC",
    bearish: "",
    headline: "UAE leaves OPEC in major blow to oil cartel",
    velaRead: "Adds supply pressure, weakens OPEC's defense of prices.",
    date: "2026-04-30T00:00:00Z",
  },
  "/tmp/og-news-single.png",
);

await runCase(
  "mixed-direction (HYPE bullish, OIL bearish)",
  {
    bullish: "HYPE",
    bearish: "OIL",
    headline: "UAE leaves OPEC in major blow to oil cartel",
    velaRead: "Adds supply pressure, weakens OPEC's defense of prices.",
    date: "2026-04-30T00:00:00Z",
  },
  "/tmp/og-news-mixed.png",
);

await runCase(
  "no exposure (no direction rows)",
  {
    bullish: "",
    bearish: "",
    headline: "UAE leaves OPEC in major blow to oil cartel",
    velaRead: "Adds supply pressure, weakens OPEC's defense of prices.",
    date: "2026-04-30T00:00:00Z",
  },
  "/tmp/og-news-empty.png",
);

await runCase(
  "missing required param (should 400)",
  { bullish: "HYPE" },
  "/tmp/og-news-error.png",
);

await runCase(
  "bad auth (should 401)",
  null,
  "/tmp/og-news-auth.png",
);
