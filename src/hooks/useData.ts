import { useState, useEffect, useCallback, useRef } from 'react';
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
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const STALE_THRESHOLD = 60 * 1000; // 1 minute — skip refetch if data is younger

export const DEFAULT_POSITION_SIZE = 1000;

// ── Module-level cache so data persists across navigations ──
let cachedDashboard: AssetDashboard[] | null = null;
let cachedDigest: Brief | null = null;
let lastFetchTime = 0;

async function fetchLivePrices(ids: string[]): Promise<Record<string, PriceData>> {
  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    const result: Record<string, PriceData> = {};
    for (const id of ids) {
      if (data[id]) {
        result[id] = { price: data[id].usd, change24h: data[id].usd_24h_change ?? 0 };
      }
    }
    return result;
  } catch {
    return {};
  }
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
      const livePrices = await fetchLivePrices(coingeckoIds);

      const dashboard: AssetDashboard[] = assets.map((asset: Asset) => ({
        asset,
        signal: signals.find((s: Signal) => s.asset_id === asset.id) || null,
        brief: briefs.find((b: Brief) => b.asset_id === asset.id) || null,
        priceData: livePrices[asset.coingecko_id] || null,
      }));

      // Update module cache
      cachedDashboard = dashboard;
      cachedDigest = digestsRes.data?.[0] || null;
      lastFetchTime = Date.now();

      setData(dashboard);
      setDigest(cachedDigest);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: unknown) {
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

    const fetchDetail = async () => {
      const [assetRes, signalRes, briefRes, briefsRes, signalsHistoryRes] = await Promise.all([
        supabase.from('assets').select('*').eq('id', assetId).single(),
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
        supabase
          .from('signals')
          .select('id, signal_color')
          .eq('asset_id', assetId)
          .order('timestamp', { ascending: false })
          .limit(20),
      ]);

      const assetData = assetRes.data;
      setAsset(assetData);
      setSignal(signalRes.data?.[0] || null);
      setBrief(briefRes.data?.[0] || null);
      setRecentBriefs(briefsRes.data || []);

      // Build signal lookup map for brief grouping
      const signalMap: Record<string, string> = {};
      for (const s of signalsHistoryRes.data || []) {
        signalMap[s.id] = s.signal_color;
      }
      setSignalLookup(signalMap);

      if (assetData?.coingecko_id) {
        const prices = await fetchLivePrices([assetData.coingecko_id]);
        const freshPrice = prices[assetData.coingecko_id];
        // Only overwrite cached priceData if we got a valid response —
        // prevents wiping cached change24h on transient CoinGecko failures
        if (freshPrice) {
          setPriceData(freshPrice);
        }
      }

      setLoading(false);
    };

    fetchDetail();
  }, [assetId]);

  return { asset, signal, brief, recentBriefs, priceData, signalLookup, loading };
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
      source: t.source || ('live' as const),
      asset_symbol: t.assets?.symbol,
      asset_coingecko_id: t.assets?.coingecko_id,
    }));

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
          .order('opened_at', { ascending: false })
          .limit(PAGE_SIZE + 1),
        supabase.from('paper_trade_stats').select('*'),
      ]);

      const rows = tradesRes.data || [];
      setHasMore(rows.length > PAGE_SIZE);
      const mapped = mapTrades(rows.slice(0, PAGE_SIZE));
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
        console.error('[useTrackRecord] enrichment failed:', err);
        setTrades(mapped);
      }

      // Fetch live prices for open trade assets
      const openAssetIds = [
        ...new Set(mapped.filter(t => t.status === 'open').map(t => t.asset_coingecko_id)),
      ].filter(Boolean) as string[];

      if (openAssetIds.length > 0) {
        const prices = await fetchLivePrices(openAssetIds);
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
    const mapped = mapTrades(rows.slice(0, PAGE_SIZE));

    try {
      const enriched = await enrichTrades(mapped);
      setTrades(prev => [...prev, ...enriched]);
    } catch {
      setTrades(prev => [...prev, ...mapped]);
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
