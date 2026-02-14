import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Asset, Signal, Brief, PaperTrade, AssetDashboard } from '../types';

export function useDashboard() {
  const [data, setData] = useState<AssetDashboard[]>([]);
  const [digest, setDigest] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = async () => {
    try {
      // Get enabled assets
      const { data: assets, error: aErr } = await supabase
        .from('assets')
        .select('*')
        .eq('enabled', true)
        .order('id');

      if (aErr) throw aErr;

      // Get latest signal per asset (from the view)
      const { data: signals, error: sErr } = await supabase
        .from('latest_signals')
        .select('*');

      if (sErr) throw sErr;

      // Get latest brief per asset (excluding digests)
      const { data: briefs, error: bErr } = await supabase
        .from('latest_briefs')
        .select('*');

      if (bErr) throw bErr;

      // Get latest daily digest
      const { data: digests, error: dErr } = await supabase
        .from('latest_digest')
        .select('*')
        .limit(1);

      if (dErr) throw dErr;

      // Combine into dashboard data
      const dashboard: AssetDashboard[] = (assets || []).map((asset: Asset) => ({
        asset,
        signal: (signals || []).find((s: Signal) => s.asset_id === asset.id) || null,
        brief: (briefs || []).find((b: Brief) => b.asset_id === asset.id) || null,
      }));

      setData(dashboard);
      setDigest(digests?.[0] || null);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch();
    // Refresh every 5 minutes
    const interval = setInterval(fetch, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { data, digest, loading, error, refresh: fetch };
}

export function useAssetDetail(assetId: string) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [recentBriefs, setRecentBriefs] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);

      const [assetRes, signalRes, briefRes, briefsRes] = await Promise.all([
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
          .limit(10),
      ]);

      setAsset(assetRes.data);
      setSignal(signalRes.data?.[0] || null);
      setBrief(briefRes.data?.[0] || null);
      setRecentBriefs(briefsRes.data || []);
      setLoading(false);
    };

    fetch();
  }, [assetId]);

  return { asset, signal, brief, recentBriefs, loading };
}

export function useTrackRecord() {
  const [trades, setTrades] = useState<(PaperTrade & { asset_symbol?: string })[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const [tradesRes, statsRes] = await Promise.all([
        supabase
          .from('paper_trades')
          .select('*, assets(symbol)')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('paper_trade_stats').select('*'),
      ]);

      const tradesWithSymbol = (tradesRes.data || []).map((t: any) => ({
        ...t,
        asset_symbol: t.assets?.symbol,
      }));

      setTrades(tradesWithSymbol);
      setStats(statsRes.data || []);
      setLoading(false);
    };

    fetch();
  }, []);

  return { trades, stats, loading };
}

export function useSignalHistory(assetId?: string) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      let query = supabase
        .from('signals')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(50);

      if (assetId) query = query.eq('asset_id', assetId);

      const { data } = await query;
      setSignals(data || []);
      setLoading(false);
    };

    fetch();
  }, [assetId]);

  return { signals, loading };
}
