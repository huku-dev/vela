/**
 * UI Review (24 Feb) — Source-verification + adversarial tests
 *
 * Covers trust-critical changes:
 * - ADX direction-aware coloring (never green for bearish trends)
 * - RSI contextual labels (extremes show contrarian context)
 * - Brief rating persistence (no auto-dismiss timer)
 * - Signal history price display
 * - plainEnglish() new jargon mappings
 * - Tier definitions integrity
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { plainEnglish } from '../lib/helpers';
import { TIER_DEFINITIONS, COMPARISON_FEATURES, getTierConfig } from '../lib/tier-definitions';

const assetDetailSrc = readFileSync(resolve(__dirname, '../pages/AssetDetail.tsx'), 'utf-8');
const helpersSrc = readFileSync(resolve(__dirname, '../lib/helpers.ts'), 'utf-8');

// ── ADX Direction-Aware Coloring ──

describe('ADX-SRC: direction-aware coloring source verification', () => {
  it('cross-references ADX with bullish/bearish trend', () => {
    expect(assetDetailSrc).toContain('isBullishTrend');
    expect(assetDetailSrc).toContain('isBearishTrend');
  });

  it('shows "Strong uptrend" for bullish + high ADX', () => {
    expect(assetDetailSrc).toContain("'Strong uptrend'");
  });

  it('shows "Strong downtrend" for bearish + high ADX', () => {
    expect(assetDetailSrc).toContain("'Strong downtrend'");
  });

  it('shows "Trending (mixed signals)" for mixed + high ADX', () => {
    expect(assetDetailSrc).toContain("'Trending (mixed signals)'");
  });

  it('uses red for bearish strong trend', () => {
    // After bearish check, should assign red
    const adxSection = assetDetailSrc.slice(
      assetDetailSrc.indexOf('const adxLabel'),
      assetDetailSrc.indexOf('const smaLabel')
    );
    expect(adxSection).toContain("'var(--red-dark)'");
  });
});

describe('ADX-ADV: adversarial — ADX never green for bearish', () => {
  it('green ADX requires isBullishTrend guard', () => {
    // Find the adxColor assignment block
    const adxColorStart = assetDetailSrc.indexOf('const adxColor');
    const adxColorEnd = assetDetailSrc.indexOf(';', adxColorStart);
    const adxColorBlock = assetDetailSrc.slice(adxColorStart, adxColorEnd);

    // Green should only appear with bullish guard
    const greenIndex = adxColorBlock.indexOf("'var(--green-dark)'");
    const bullishGuard = adxColorBlock.lastIndexOf('isBullishTrend', greenIndex);
    expect(bullishGuard).toBeGreaterThan(0);
  });

  it('tooltip explains direction-aware logic', () => {
    expect(assetDetailSrc).toContain('price position relative to averages');
  });
});

// ── RSI Contextual Labels ──

describe('RSI-SRC: contextual labels source verification', () => {
  it('oversold label includes bounce context', () => {
    expect(assetDetailSrc).toContain('Oversold \\u2014 potential bounce');
  });

  it('overbought label includes pullback context', () => {
    expect(assetDetailSrc).toContain('Overbought \\u2014 may pull back');
  });

  it('strong buying pressure label for RSI 60-70', () => {
    expect(assetDetailSrc).toContain("'Strong buying pressure'");
  });
});

// ── Brief Rating Persistence ──

describe('RATING-SRC: brief rating persistence', () => {
  it('does NOT have a setTimeout auto-dismiss timer', () => {
    // Extract the BriefFeedback function
    const startIdx = assetDetailSrc.indexOf('function BriefFeedback');
    const endIdx = assetDetailSrc.indexOf('\nfunction ', startIdx + 1);
    const feedbackSrc = assetDetailSrc.slice(startIdx, endIdx > 0 ? endIdx : undefined);

    expect(feedbackSrc).not.toContain('setTimeout(() => setShowThanks(false)');
  });

  it('has no showThanks state', () => {
    const startIdx = assetDetailSrc.indexOf('function BriefFeedback');
    const endIdx = assetDetailSrc.indexOf('\nfunction ', startIdx + 1);
    const feedbackSrc = assetDetailSrc.slice(startIdx, endIdx > 0 ? endIdx : undefined);

    expect(feedbackSrc).not.toContain('setShowThanks');
  });

  it('shows persistent rated state when rating !== null', () => {
    expect(assetDetailSrc).toContain('rating !== null && !showCommentInput');
    expect(assetDetailSrc).toContain('Thanks for your feedback');
  });

  it('has a Skip button for thumbs-down comment', () => {
    // Prettier may split across lines, so check for the text content
    expect(assetDetailSrc).toMatch(/>\s*Skip\s*<\/button>/);
  });

  it('scrolls comment box into view after thumbs-down', () => {
    expect(assetDetailSrc).toContain('scrollIntoView');
  });
});

describe('RATING-ADV: adversarial — no transient feedback', () => {
  it('no thanksTimerRef in BriefFeedback', () => {
    const startIdx = assetDetailSrc.indexOf('function BriefFeedback');
    const endIdx = assetDetailSrc.indexOf('\nfunction ', startIdx + 1);
    const feedbackSrc = assetDetailSrc.slice(startIdx, endIdx > 0 ? endIdx : undefined);

    expect(feedbackSrc).not.toContain('thanksTimerRef');
  });
});

// ── Signal History ──

describe('HISTORY-SRC: signal history enhancements', () => {
  it('shows price at signal trigger', () => {
    expect(assetDetailSrc).toContain('Signal triggered at');
    expect(assetDetailSrc).toContain('priceAtSignal');
  });

  it('has NEW badge prop on SignalHistoryCard', () => {
    expect(assetDetailSrc).toContain('isNew?:');
  });

  it('has progressive disclosure with visibleCount', () => {
    expect(assetDetailSrc).toContain('visibleCount');
    expect(assetDetailSrc).toContain('GROUPS_INCREMENT');
    expect(assetDetailSrc).toContain('View more');
  });

  it('NEW badge shows in both collapsed and expanded states', () => {
    // Collapsed: isNew && !expanded
    expect(assetDetailSrc).toContain('isNew && !expanded');
    // Expanded: isNewEntry badge next to headline
    expect(assetDetailSrc).toContain('isNewEntry');
  });
});

describe('HISTORY-ADV: adversarial — history safeguards', () => {
  it('latestGroupIsNew requires signal_change type', () => {
    expect(assetDetailSrc).toContain("signalGroups[0].type === 'signal_change'");
  });

  it('latestGroupIsNew requires 24h recency window', () => {
    expect(assetDetailSrc).toContain('24 * 60 * 60 * 1000');
  });

  it('price display guards null with != null check', () => {
    expect(assetDetailSrc).toContain('priceAtSignal != null');
  });

  it('view more button uses stopPropagation to not toggle card', () => {
    expect(assetDetailSrc).toContain('e.stopPropagation()');
  });
});

// ── Signal Timestamp Copy ──

describe('COPY-SRC: signal timestamp copy', () => {
  it('says "Signal last changed" not "Signal checked"', () => {
    expect(assetDetailSrc).toContain('Signal last changed');
    expect(assetDetailSrc).not.toContain('Signal checked');
  });
});

// ── plainEnglish Jargon Mappings ──

describe('JARGON-SRC: enriched plainEnglish mappings', () => {
  it('maps oversold levels to plain English', () => {
    expect(helpersSrc).toContain('oversold\\s+levels');
    expect(plainEnglish('oversold levels are low')).toBe('low buying activity are low');
  });

  it('maps overbought levels to plain English', () => {
    expect(plainEnglish('overbought levels signal caution')).toBe(
      'high buying activity signal caution'
    );
  });

  it('maps bullish divergence', () => {
    expect(plainEnglish('a bullish divergence detected')).toBe(
      'a early signs of a turnaround detected'
    );
  });

  it('maps bearish divergence', () => {
    expect(plainEnglish('bearish divergence on the chart')).toBe(
      'early signs of weakness on the chart'
    );
  });

  it('maps consolidation', () => {
    expect(plainEnglish('entering consolidation phase')).toBe('entering sideways movement phase');
  });

  it('maps support and resistance levels', () => {
    expect(plainEnglish('key support level at 90k')).toBe('key price floor at 90k');
    expect(plainEnglish('resistance level ahead')).toBe('price ceiling ahead');
  });

  it('does not produce double-replacement artifacts with RSI', () => {
    // RSI should map to "buying pressure", not "momentum" (avoid double replacement)
    const result = plainEnglish('RSI 14 shows strong momentum shifting upward');
    expect(result).not.toContain('momentum momentum');
    expect(result).toContain('buying pressure');
    expect(result).toContain('pressure changing');
  });
});

// ── Market Context ──

describe('CONTEXT-SRC: market context improvements', () => {
  it('applies plainEnglish to market context values', () => {
    expect(assetDetailSrc).toContain('plainEnglish(value as string)');
    // Verify it's in the market context section, not just signal_breakdown
    const marketSection = assetDetailSrc.slice(
      assetDetailSrc.indexOf('Market context'),
      assetDetailSrc.indexOf('Indicators')
    );
    expect(marketSection).toContain('plainEnglish(value as string)');
  });

  it('sorts dominance keys to end', () => {
    expect(assetDetailSrc).toContain('/dominance/i.test(key');
  });
});

// ── Tier Definitions ──

describe('TIER-SRC: tier definitions integrity', () => {
  it('defines exactly 3 tiers', () => {
    expect(TIER_DEFINITIONS).toHaveLength(3);
  });

  it('free tier has $0 pricing', () => {
    const free = getTierConfig('free');
    expect(free.monthly_price_usd).toBe(0);
    expect(free.annual_price_usd).toBe(0);
  });

  it('annual pricing is monthly × 10 (2 months free)', () => {
    const standard = getTierConfig('standard');
    expect(standard.annual_price_usd).toBe(standard.monthly_price_usd * 10);
    const premium = getTierConfig('premium');
    expect(premium.annual_price_usd).toBe(premium.monthly_price_usd * 10);
  });

  it('free tier is view-only with no position or leverage', () => {
    const free = getTierConfig('free');
    expect(free.features.view_only).toBe(true);
    expect(free.features.semi_auto).toBe(false);
    expect(free.features.auto_mode).toBe(false);
    expect(free.max_position_size_usd).toBe(0);
    expect(free.max_leverage).toBe(0);
  });

  it('standard tier fee is 0.1%', () => {
    const standard = getTierConfig('standard');
    expect(standard.trade_fee_pct).toBe(0.1);
  });

  it('premium tier fee is free (0%)', () => {
    const premium = getTierConfig('premium');
    expect(premium.trade_fee_pct).toBe(0);
  });

  it('premium has full auto mode', () => {
    const premium = getTierConfig('premium');
    expect(premium.features.auto_mode).toBe(true);
  });

  it('all comparison features have getValue that works', () => {
    for (const tier of TIER_DEFINITIONS) {
      for (const feature of COMPARISON_FEATURES) {
        const value = feature.getValue(tier);
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('TIER-ADV: adversarial — tier definitions safety', () => {
  it('free tier shows "—" for position, leverage, and fee', () => {
    const free = getTierConfig('free');
    const positionFeature = COMPARISON_FEATURES.find(f => f.key === 'position')!;
    const leverageFeature = COMPARISON_FEATURES.find(f => f.key === 'leverage')!;
    const feeFeature = COMPARISON_FEATURES.find(f => f.key === 'fee')!;

    expect(positionFeature.getValue(free)).toBe('\u2014');
    expect(leverageFeature.getValue(free)).toBe('\u2014');
    expect(feeFeature.getValue(free)).toBe('\u2014');
  });

  it('premium shows "Unlimited" for assets and position', () => {
    const premium = getTierConfig('premium');
    const assetsFeature = COMPARISON_FEATURES.find(f => f.key === 'assets')!;
    const positionFeature = COMPARISON_FEATURES.find(f => f.key === 'position')!;

    expect(assetsFeature.getValue(premium)).toBe('Unlimited');
    expect(positionFeature.getValue(premium)).toBe('Unlimited');
  });

  it('getTierConfig returns free tier as fallback for unknown tier', () => {
    const fallback = getTierConfig('unknown_tier' as never);
    expect(fallback.tier).toBe('free');
  });

  it('no hardcoded dollar amounts in tier comparison source', () => {
    const sheetSrc = readFileSync(resolve(__dirname, './TierComparisonSheet.tsx'), 'utf-8');
    // Prices should come from TIER_DEFINITIONS, not hardcoded in the component
    expect(sheetSrc).not.toMatch(/\$10|\$20|\$29|\$79|\$100|\$200|\$290|\$790/);
  });
});

// ── Upgrade Flow UI Safety ──

const sheetSrc = readFileSync(resolve(__dirname, './TierComparisonSheet.tsx'), 'utf-8');
const accountSrc = readFileSync(resolve(__dirname, '../pages/Account.tsx'), 'utf-8');

describe('UPGRADE-SRC: upgrade flow source verification', () => {
  it('paid tier buttons are live CTAs wired to checkout', () => {
    // CTAs call onStartCheckout — disabled only while a checkout is in flight
    expect(sheetSrc).toContain('onStartCheckout');
    expect(sheetSrc).toContain('handleCta');
    expect(sheetSrc).toContain("cursor: checkingOutTier !== null ? 'wait' : 'pointer'");
  });

  it('annual billing is the default selection', () => {
    // Users should see the lower annual price first
    expect(sheetSrc).toMatch(/useState.*'annual'/);
  });

  it('has a close button with aria-label', () => {
    expect(sheetSrc).toContain('aria-label="Close"');
  });

  it('overlay uses fixed positioning with high z-index', () => {
    expect(sheetSrc).toContain("position: 'fixed'");
    expect(sheetSrc).toContain('zIndex: 1000');
  });

  it('prices are computed from tier props, not hardcoded', () => {
    // getPrice function derives display from tier.monthly_price_usd / tier.annual_price_usd
    expect(sheetSrc).toContain('tier.annual_price_usd');
    expect(sheetSrc).toContain('tier.monthly_price_usd');
  });

  it('Account page gates sheet behind showTierSheet state', () => {
    expect(accountSrc).toContain('showTierSheet');
    expect(accountSrc).toContain('setShowTierSheet(true)');
    expect(accountSrc).toContain('setShowTierSheet(false)');
  });

  it('Account page passes dynamic currentTier to sheet', () => {
    // currentTier comes from useSubscription hook, not hardcoded
    expect(accountSrc).toContain('currentTier={currentTier}');
    expect(accountSrc).not.toContain('currentTier="free"');
  });
});

describe('UPGRADE-ADV: adversarial — no premature purchase flow', () => {
  it('no Stripe SDK, checkout session, or payment form in comparison sheet', () => {
    // Pre-Stripe: sheet is informational only, no payment processing code
    // (footer mentions "Stripe" in copy — that's fine, we check for code/SDK patterns)
    expect(sheetSrc).not.toContain("from '@stripe");
    expect(sheetSrc).not.toContain('createCheckoutSession');
    expect(sheetSrc).not.toContain('loadStripe');
    expect(sheetSrc).not.toMatch(/<form[\s>]/);
    expect(sheetSrc).not.toContain('credit_card');
    expect(sheetSrc).not.toContain('payment_intent');
  });

  it('paid buttons show contextual label, not "Coming soon"', () => {
    // Labels are dynamic: "Upgrade to X" or "Switch to X"
    expect(sheetSrc).toContain('Upgrade to');
    expect(sheetSrc).toContain('Switch to');
    expect(sheetSrc).not.toContain('Coming soon');
  });

  it('in-flight checkout shows "Redirecting…" and dims other buttons', () => {
    expect(sheetSrc).toContain('Redirecting\u2026');
    expect(sheetSrc).toContain('checkingOutTier !== null ? 0.7 : 1');
  });

  it('sheet cannot render without explicit user action', () => {
    // showTierSheet must be initially false
    expect(accountSrc).toMatch(/useState\(false\)/);
    // Sheet is conditionally rendered, not always mounted
    expect(accountSrc).toContain('showTierSheet &&');
  });

  it('no navigation or redirect to external payment pages', () => {
    expect(sheetSrc).not.toContain('window.location');
    expect(sheetSrc).not.toContain('window.open');
    expect(sheetSrc).not.toMatch(/href=.*stripe|href=.*pay|href=.*checkout/i);
  });

  it('free tier has no CTA button (no upgrade-from-free loop)', () => {
    // Free tier should show "Current plan" label or nothing, not a button
    expect(sheetSrc).toContain('Current plan');
    // The CTA logic: isCurrent shows label, isPaid shows button, free+!current = null
    expect(sheetSrc).toContain('isCurrent');
    expect(sheetSrc).toContain('isPaid');
  });
});
