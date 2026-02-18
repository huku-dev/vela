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
        setPriceData(prices[assetData.coingecko_id] || null);
      }

      setLoading(false);
    };

    fetchDetail();
  }, [assetId]);

  return { asset, signal, brief, recentBriefs, priceData, signalLookup, loading };
}

const PAGE_SIZE = 50;

export function useTrackRecord() {
  const [trades, setTrades] = useState<(PaperTrade & { asset_symbol?: string })[]>([]);
  const [stats, setStats] = useState<PaperTradeStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const mapTrades = (data: (PaperTrade & { assets?: { symbol: string } })[]) =>
    data.map(t => ({
      ...t,
      source: t.source || ('live' as const),
      asset_symbol: t.assets?.symbol,
    }));

  useEffect(() => {
    const fetchAll = async () => {
      const [tradesRes, statsRes] = await Promise.all([
        supabase
          .from('paper_trades')
          .select('*, assets(symbol)')
          .order('opened_at', { ascending: false })
          .limit(PAGE_SIZE + 1),
        supabase.from('paper_trade_stats').select('*'),
      ]);

      const rows = tradesRes.data || [];
      setHasMore(rows.length > PAGE_SIZE);
      setTrades(mapTrades(rows.slice(0, PAGE_SIZE)));
      setStats(statsRes.data || []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const res = await supabase
      .from('paper_trades')
      .select('*, assets(symbol)')
      .order('opened_at', { ascending: false })
      .range(trades.length, trades.length + PAGE_SIZE);

    const rows = res.data || [];
    setHasMore(rows.length === PAGE_SIZE + 1);
    setTrades(prev => [...prev, ...mapTrades(rows.slice(0, PAGE_SIZE))]);
    setLoadingMore(false);
  }, [trades.length]);

  return { trades, stats, loading, loadingMore, hasMore, loadMore };
}
