import { useState, useEffect, useCallback, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabase';
import type {
  Asset,
  Signal,
  Brief,
  PaperTrade,
  PaperTradeStats,
  AssetDashboard,
  PriceData,
} from '../types';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const HYPERLIQUID_INFO = 'https://api.hyperliquid.xyz/info';
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const STALE_THRESHOLD = 60 * 1000; // 1 minute — skip refetch if data is younger

// Price source toggle: "hyperliquid" (default) or "coingecko".
// Flip via env var in Vercel to switch primary without a code deploy.
const PRICE_PRIMARY: 'hyperliquid' | 'coingecko' =
  import.meta.env.VITE_PRICE_PRIMARY === 'coingecko' ? 'coingecko' : 'hyperliquid';

export const DEFAULT_POSITION_SIZE = 1000;

// ── Module-level cache so data persists across navigations ──
let cachedDashboard: AssetDashboard[] | null = null;
let cachedDigest: Brief | null = null;
let lastFetchTime = 0;
// Cache last known 24h change from CoinGecko so rate-limit failures show stale data, not 0%
const lastKnownChange24h: Record<string, number> = {};

/**
 * Fetch mid-prices from Hyperliquid exchange (primary source).
 * Returns symbol → USD price (e.g. { BTC: 87400.5, ETH: 3200 }).
 */
async function fetchHyperliquidMids(): Promise<Record<string, number>> {
  try {
    const res = await fetch(HYPERLIQUID_INFO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });
    if (!res.ok) return {};
    const data: Record<string, string> = await res.json();
    const result: Record<string, number> = {};
    for (const [sym, priceStr] of Object.entries(data)) {
      const price = parseFloat(priceStr);
      if (!isNaN(price)) result[sym] = price;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Compute 24h price change from Hyperliquid 1-hour candles.
 * Compares the first candle open (24h ago) to the latest candle close.
 * Returns symbol → change% (e.g. { BTC: 2.3, ETH: -1.1 }).
 */
async function fetchHyperliquid24hChanges(
  symbols: string[]
): Promise<Record<string, number>> {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const results = await Promise.all(
    symbols.map(async (symbol): Promise<[string, number | null]> => {
      try {
        const res = await fetch(HYPERLIQUID_INFO, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'candleSnapshot',
            req: { coin: symbol, interval: '1h', startTime: oneDayAgo, endTime: now },
          }),
        });
        if (!res.ok) return [symbol, null];
        const candles = await res.json();
        if (!Array.isArray(candles) || candles.length < 2) return [symbol, null];
        const openPrice = parseFloat(candles[0].o);
        const closePrice = parseFloat(candles[candles.length - 1].c);
        if (openPrice <= 0) return [symbol, null];
        return [symbol, ((closePrice - openPrice) / openPrice) * 100];
      } catch {
        return [symbol, null];
      }
    })
  );

  const out: Record<string, number> = {};
  for (const [sym, change] of results) {
    if (change !== null) out[sym] = change;
  }
  return out;
}

/**
 * Fetch prices + 24h change from CoinGecko (fallback for prices, primary for 24h change).
 */
async function fetchCoinGeckoPrices(ids: string[]): Promise<Record<string, PriceData>> {
  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    const result: Record<string, PriceData> = {};
    for (const id of ids) {
      if (data[id]) {
        const change = data[id].usd_24h_change ?? 0;
        result[id] = {
          price: data[id].usd,
          change24h: change,
          priceSource: 'coingecko',
        };
        // Cache successful 24h change for fallback when CG is rate-limited
        if (change !== 0) lastKnownChange24h[id] = change;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Dual-source price fetching with configurable primary (VITE_PRICE_PRIMARY).
 *
 * Default: Hyperliquid primary (prices + 24h change from candles), CoinGecko fallback.
 * Toggle to "coingecko" to reverse the priority if HL is degraded.
 *
 * @param ids       - CoinGecko asset IDs (e.g. ["bitcoin", "ethereum"])
 * @param symbolMap - Optional mapping of CoinGecko ID → Hyperliquid symbol (e.g. { bitcoin: "BTC" })
 */
async function fetchLivePrices(
  ids: string[],
  symbolMap?: Record<string, string>
): Promise<Record<string, PriceData>> {
  const result: Record<string, PriceData> = {};
  const hlSymbols = symbolMap ? ids.map(id => symbolMap[id]).filter(Boolean) : [];

  if (PRICE_PRIMARY === 'hyperliquid' && hlSymbols.length > 0) {
    // ── Hyperliquid primary: fetch prices + 24h change from HL ──
    const [hlMids, hlChanges] = await Promise.all([
      fetchHyperliquidMids(),
      fetchHyperliquid24hChanges(hlSymbols),
    ]);

    // Track which CG IDs still need data (HL miss)
    const missingIds: string[] = [];

    for (const id of ids) {
      const hlSymbol = symbolMap?.[id];
      const hlPrice = hlSymbol ? hlMids[hlSymbol] : undefined;
      const hlChange = hlSymbol ? hlChanges[hlSymbol] : undefined;

      if (hlPrice !== undefined) {
        const change24h = hlChange ?? lastKnownChange24h[id] ?? 0;
        result[id] = { price: hlPrice, change24h, priceSource: 'hyperliquid' };
        // Cache HL-derived 24h change so it persists across transient failures
        if (hlChange !== undefined) lastKnownChange24h[id] = hlChange;
      } else {
        missingIds.push(id);
      }
    }

    // Fallback to CoinGecko only for assets HL couldn't provide
    if (missingIds.length > 0) {
      const cgPrices = await fetchCoinGeckoPrices(missingIds);
      for (const id of missingIds) {
        if (cgPrices[id]) result[id] = cgPrices[id];
      }
    }
  } else {
    // ── CoinGecko primary (toggle or no symbolMap) ──
    const [cgPrices, hlMids] = await Promise.all([
      fetchCoinGeckoPrices(ids),
      symbolMap ? fetchHyperliquidMids() : Promise.resolve({} as Record<string, number>),
    ]);

    for (const id of ids) {
      const cgData = cgPrices[id];
      const hlSymbol = symbolMap?.[id];
      const hlPrice = hlSymbol ? hlMids[hlSymbol] : undefined;

      if (cgData) {
        // CG price but prefer HL mid-price if available (more accurate for trading)
        result[id] = {
          price: hlPrice ?? cgData.price,
          change24h: cgData.change24h,
          priceSource: hlPrice !== undefined ? 'hyperliquid' : 'coingecko',
        };
      } else if (hlPrice !== undefined) {
        // CG failed entirely, HL fallback
        result[id] = {
          price: hlPrice,
          change24h: lastKnownChange24h[id] ?? 0,
          priceSource: 'hyperliquid',
        };
      }
    }
  }

  return result;
}

export function useDashboard() {
  const [data, setData] = useState<AssetDashboard[]>(cachedDashboard || []);
  const [digest, setDigest] = useState<Brief | null>(cachedDigest);
  const [loading, setLoading] = useState(!cachedDashboard);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    lastFetchTime ? new Date(lastFetchTime) : null
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (force = false) => {
    // Skip if data is fresh and not forced
    if (!force && cachedDashboard && Date.now() - lastFetchTime < STALE_THRESHOLD) {
      setData(cachedDashboard);
      setDigest(cachedDigest);
      setLoading(false);
      return;
    }

    try {
      const [assetsRes, signalsRes, briefsRes, digestsRes] = await Promise.all([
        supabase.from('assets').select('*').eq('enabled', true).order('id'),
        supabase.from('latest_signals').select('*'),
        supabase.from('latest_briefs').select('*'),
        supabase.from('latest_digest').select('*').limit(1),
      ]);

      if (assetsRes.error) throw assetsRes.error;

      const assets = assetsRes.data || [];
      const signals = signalsRes.data || [];
      const briefs = briefsRes.data || [];

      const coingeckoIds = assets.map((a: Asset) => a.coingecko_id);
      // Build CoinGecko ID → Hyperliquid symbol map for dual-source pricing
      const symbolMap: Record<string, string> = {};
      for (const a of assets) {
        symbolMap[a.coingecko_id] = a.symbol;
      }
      const livePrices = await fetchLivePrices(coingeckoIds, symbolMap);

      const dashboard: AssetDashboard[] = assets.map((asset: Asset) => {
        const signal = signals.find((s: Signal) => s.asset_id === asset.id) || null;
        const livePrice = livePrices[asset.coingecko_id];

        // Fall back to signal price when both live sources fail
        const priceData: PriceData | null = livePrice
          ? livePrice
          : signal?.price_at_signal
            ? { price: signal.price_at_signal, change24h: 0, priceSource: 'signal' as const }
            : null;

        return {
          asset,
          signal,
          brief: briefs.find((b: Brief) => b.asset_id === asset.id) || null,
          priceData,
        };
      });

      // Update module cache
      cachedDashboard = dashboard;
      // Defense-in-depth: reject digest rows with fallback/error content.
      // The backend should never persist these (as of 2026-02-28), but if
      // old rows exist or a future bug slips through, don't show garbage.
      const rawDigest: Brief | null = digestsRes.data?.[0] || null;
      const digestText = rawDigest?.summary || rawDigest?.context || '';
      const isValidDigest =
        digestText.length >= 50 &&
        !digestText.toLowerCase().includes('unavailable') &&
        !digestText.toLowerCase().includes('check back later');
      cachedDigest = isValidDigest ? rawDigest : null;
      lastFetchTime = Date.now();

      setData(dashboard);
      setDigest(cachedDigest);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: unknown) {
      Sentry.captureException(err, {
        tags: { flow: 'dashboard' },
        extra: { step: 'fetchData' },
      });
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(() => fetchData(true), REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  return { data, digest, loading, error, lastUpdated, refresh: () => fetchData(true) };
}

export function useAssetDetail(assetId: string) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [recentBriefs, setRecentBriefs] = useState<Brief[]>([]);
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [signalLookup, setSignalLookup] = useState<Record<string, string>>({});
  /** Signals sorted newest-first with timestamps — for timeline-based brief grouping */
  const [signalTimeline, setSignalTimeline] = useState<{ color: string; timestamp: string }[]>([]);
  const [loading, setLoading] = useState(true);
  // Track whether the asset was confirmed missing (vs transient fetch error)
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setNotFound(false);

    // Try to hydrate from cache instantly
    if (cachedDashboard) {
      const cached = cachedDashboard.find(d => d.asset.id === assetId);
      if (cached) {
        setAsset(cached.asset);
        setSignal(cached.signal);
        setBrief(cached.brief);
        setPriceData(cached.priceData);
      }
    }

    const fetchDetail = async (attempt = 1) => {
      try {
        const [assetRes, signalRes, briefRes, briefsRes, signalsHistoryRes] = await Promise.all([
          supabase.from('assets').select('*').eq('id', assetId).eq('enabled', true).single(),
          supabase
            .from('signals')
            .select('*')
            .eq('asset_id', assetId)
            .order('timestamp', { ascending: false })
            .limit(1),
          supabase
            .from('briefs')
            .select('*')
            .eq('asset_id', assetId)
            .neq('brief_type', 'daily_digest')
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('briefs')
            .select('*')
            .eq('asset_id', assetId)
            .neq('brief_type', 'daily_digest')
            .order('created_at', { ascending: false })
            .limit(20),
          // Fetch recent signals for this asset — used to build signal_id → color lookup
          // Include timestamp for timeline-based brief grouping
          supabase
            .from('signals')
            .select('id, signal_color, timestamp')
            .eq('asset_id', assetId)
            .order('timestamp', { ascending: false })
            .limit(20),
        ]);

        if (assetRes.error) {
          // "PGRST116" = .single() found no rows → asset genuinely doesn't exist
          const isRealNotFound = assetRes.error.code === 'PGRST116';
          if (!isRealNotFound && attempt < 2) {
            console.warn(
              `[useAssetDetail] Transient fetch error (attempt ${attempt}), retrying:`,
              assetRes.error.message
            );
            setTimeout(() => fetchDetail(attempt + 1), 1000);
            return;
          }
          console.error('[useAssetDetail] Asset fetch failed:', assetRes.error.message);
          // Only clear asset if we don't already have it from cache
          if (!asset) {
            setNotFound(true);
          }
          setLoading(false);
          return;
        }

        const assetData = assetRes.data;
        setAsset(assetData);
        setSignal(signalRes.data?.[0] || null);
        setBrief(briefRes.data?.[0] || null);
        setRecentBriefs(briefsRes.data || []);

        // Build signal lookup map + timeline for brief grouping
        const signalMap: Record<string, string> = {};
        const timeline: { color: string; timestamp: string }[] = [];
        for (const s of signalsHistoryRes.data || []) {
          signalMap[s.id] = s.signal_color;
          if (s.timestamp) {
            timeline.push({ color: s.signal_color, timestamp: s.timestamp });
          }
        }
        setSignalLookup(signalMap);
        setSignalTimeline(timeline);

        if (assetData?.coingecko_id) {
          const symMap = { [assetData.coingecko_id]: assetData.symbol };
          const prices = await fetchLivePrices([assetData.coingecko_id], symMap);
          const freshPrice = prices[assetData.coingecko_id];
          // Only overwrite cached priceData if we got a valid response —
          // prevents wiping cached change24h on transient CoinGecko failures
          if (freshPrice) {
            setPriceData(freshPrice);
          }
        }
      } catch (err) {
        console.error('[useAssetDetail] Unexpected error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `asset` read in error path is intentionally stale (current cache value)
  }, [assetId]);

  return {
    asset,
    signal,
    brief,
    recentBriefs,
    priceData,
    signalLookup,
    signalTimeline,
    loading,
    notFound,
  };
}

const PAGE_SIZE = 50;

export interface TradeAssetInfo {
  symbol: string;
  coingecko_id: string;
}

/** Enriched trade with brief headlines and reason codes for storytelling */
export type EnrichedTrade = PaperTrade & {
  asset_symbol?: string;
  asset_coingecko_id?: string;
  entry_headline?: string;
  exit_headline?: string;
  entry_reason_code?: string;
  exit_reason_code?: string;
};

export function useTrackRecord() {
  const [trades, setTrades] = useState<EnrichedTrade[]>([]);
  const [stats, setStats] = useState<PaperTradeStats[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, PriceData>>({});
  const [assetMap, setAssetMap] = useState<Record<string, TradeAssetInfo>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Lookup maps persisted across initial + loadMore pages
  const signalMapRef = useRef<Record<string, { reason_code?: string; signal_color?: string }>>({});
  const briefMapRef = useRef<Record<string, string>>({});

  const mapTrades = (
    data: (PaperTrade & { assets?: { symbol: string; coingecko_id: string } })[]
  ) =>
    data.map(t => ({
      ...t,
      source: t.source || ('backtest' as const),
      asset_symbol: t.assets?.symbol,
      asset_coingecko_id: t.assets?.coingecko_id,
    }));

  /**
   * Deduplicate trades that are exact duplicates (same DB row inserted twice).
   * Uses the database primary key (id) — each trade has a unique UUID.
   * Previous fingerprint (asset|direction|hour) was too aggressive and collapsed
   * legitimately distinct trades that opened in the same hour.
   */
  const dedup = (trades: EnrichedTrade[]): EnrichedTrade[] => {
    const seen = new Set<string>();
    return trades.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  };

  /** Batch-fetch signals + briefs for a set of trades and enrich them */
  const enrichTrades = async (rawTrades: EnrichedTrade[]): Promise<EnrichedTrade[]> => {
    const signalIds = [
      ...new Set([
        ...rawTrades.map(t => t.entry_signal_id),
        ...rawTrades.filter(t => t.exit_signal_id).map(t => t.exit_signal_id!),
      ]),
    ].filter(Boolean);

    if (signalIds.length === 0) return rawTrades;

    // Only fetch IDs we haven't seen yet
    const newIds = signalIds.filter(id => !(id in signalMapRef.current));

    if (newIds.length > 0) {
      const [signalsRes, briefsRes] = await Promise.all([
        supabase.from('signals').select('id, reason_code, signal_color').in('id', newIds),
        supabase
          .from('briefs')
          .select('signal_id, headline, brief_type')
          .in('signal_id', newIds)
          .eq('brief_type', 'signal_change'),
      ]);

      for (const s of signalsRes.data ?? []) {
        signalMapRef.current[s.id] = { reason_code: s.reason_code, signal_color: s.signal_color };
      }
      for (const b of briefsRes.data ?? []) {
        if (b.signal_id && !briefMapRef.current[b.signal_id]) {
          briefMapRef.current[b.signal_id] = b.headline;
        }
      }
    }

    return rawTrades.map(t => ({
      ...t,
      entry_headline: briefMapRef.current[t.entry_signal_id] ?? undefined,
      exit_headline: t.exit_signal_id
        ? (briefMapRef.current[t.exit_signal_id] ?? undefined)
        : undefined,
      entry_reason_code: signalMapRef.current[t.entry_signal_id]?.reason_code ?? undefined,
      exit_reason_code: t.exit_signal_id
        ? (signalMapRef.current[t.exit_signal_id]?.reason_code ?? undefined)
        : undefined,
    }));
  };

  useEffect(() => {
    const fetchAll = async () => {
      const [tradesRes, statsRes] = await Promise.all([
        supabase
          .from('paper_trades')
          .select('*, assets(symbol, coingecko_id)')
          .order('opened_at', { ascending: false }),
        supabase.from('paper_trade_stats').select('*'),
      ]);

      const rows = tradesRes.data || [];
      const mapped = dedup(mapTrades(rows));
      setHasMore(false);
      setStats(statsRes.data || []);

      // Build asset map for logos
      const aMap: Record<string, TradeAssetInfo> = {};
      for (const t of mapped) {
        if (t.asset_symbol && t.asset_coingecko_id) {
          aMap[t.asset_id] = { symbol: t.asset_symbol, coingecko_id: t.asset_coingecko_id };
        }
      }
      setAssetMap(aMap);

      // Enrich trades with brief headlines (best-effort, fails silently)
      try {
        const enriched = await enrichTrades(mapped);
        setTrades(enriched);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { flow: 'track-record' },
          extra: { step: 'enrichTrades', tradeCount: mapped.length },
        });
        console.error('[useTrackRecord] enrichment failed:', err);
        setTrades(mapped);
      }

      // Fetch live prices for all known assets (covers both open paper_trades and real positions)
      const allAssetIds = [...new Set(Object.values(aMap).map(a => a.coingecko_id))].filter(
        Boolean
      );

      if (allAssetIds.length > 0) {
        // Build symbolMap so fetchLivePrices uses Hyperliquid real-time feed (not just CoinGecko)
        const symbolMap: Record<string, string> = {};
        for (const a of Object.values(aMap)) {
          symbolMap[a.coingecko_id] = a.symbol;
        }
        const prices = await fetchLivePrices(allAssetIds, symbolMap);
        setLivePrices(prices);
      }

      setLoading(false);
    };
    fetchAll();
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const res = await supabase
      .from('paper_trades')
      .select('*, assets(symbol, coingecko_id)')
      .order('opened_at', { ascending: false })
      .range(trades.length, trades.length + PAGE_SIZE);

    const rows = res.data || [];
    setHasMore(rows.length === PAGE_SIZE + 1);
    const mapped = dedup(mapTrades(rows.slice(0, PAGE_SIZE)));

    try {
      const enriched = await enrichTrades(mapped);
      setTrades(prev => dedup([...prev, ...enriched]));
    } catch {
      setTrades(prev => dedup([...prev, ...mapped]));
    }
    setLoadingMore(false);
  }, [trades.length]);

  // Compute best trade (highest pnl_pct among closed trades)
  const bestTrade = trades.reduce<EnrichedTrade | null>((best, t) => {
    if (t.status !== 'closed' || t.pnl_pct == null) return best;
    if (!best || t.pnl_pct > (best.pnl_pct ?? -Infinity)) return t;
    return best;
  }, null);

  return {
    trades,
    bestTrade,
    stats,
    livePrices,
    assetMap,
    loading,
    loadingMore,
    hasMore,
    loadMore,
  };
}
