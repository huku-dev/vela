// src/lib/adminDashboardClient.ts
//
// Fetches the live admin dashboard payload from the backend edge function.
// Types mirror supabase/functions/admin-dashboard-data/types.ts on the backend
// repo. Keep in sync manually — small enough that codegen isn't warranted yet.

export interface Kpis {
  totalUsers: number;
  payingSubscribers: number;
  payingBreakdown: string;
  mrr: number;
  activeTraders7d: number;
  openPositions: number;
  openPositionUsers: number;
  openPositionAssets: number;
  platformAum: number;
}

export interface UserRow {
  displayName: string;
  isSelf: boolean;
  tier: 'premium' | 'standard' | 'free';
  billingCycle: 'monthly' | 'annual' | null;
  subscriptionStatus: string;
  tradingMode: string;
  balance: number;
  openPositions: number;
  trades: number;
  realizedPnl: number;
  unrealizedPnl: number;
  signup: string;
}

export interface ConcentrationRow {
  displayName: string;
  openPositions: number;
  notional: number;
  unrealizedPnl: number;
}

export interface OpenPositionRow {
  displayName: string;
  asset: string;
  side: 'long' | 'short';
  sizeUsd: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  hoursOpen: number;
}

export interface RevenueRow {
  tier: 'premium' | 'standard' | 'free';
  billingCycle: 'monthly' | 'annual' | null;
  subscribers: number;
  monthlyRevenue: number;
  pastDueRevenue: number;
}

export interface CohortRow {
  cohortWeek: string;
  signups: number;
  paid: number;
  deposited: number;
  traded: number;
}

export interface DailyBucket {
  date: string;
  trades: number;
  traders: number;
  pnl: number;
}

export interface HighlightItem {
  direction: 'up' | 'down' | 'flat';
  body: string;
}

export interface CarryoverItem {
  title: string;
  priority: 'High' | 'Medium' | 'Low' | null;
  area: string | null;
  status: string;
  daysStale: number;
  notionUrl: string | null;
}

export interface Curated {
  highlights: HighlightItem[];
  carryoverNextUp: CarryoverItem[];
  carryoverNeedsAttention: CarryoverItem[];
  notes: string;
  updatedAt: string | null;
}

export interface ShippedPr {
  number: number;
  title: string;
  author: string;
  mergedAt: string;
  mergedLabel: string;
  risk: 'low' | 'med' | 'high' | 'unknown';
}

export interface VelocityBucket {
  dayLabel: string;
  isoDate: string;
  count: number;
}

export interface GithubActivity {
  shippedTop: ShippedPr[];
  velocity7d: VelocityBucket[];
  fetchedAt: string;
  errorMessage: string | null;
}

export interface DashboardResponse {
  generatedAt: string;
  kpis: Kpis;
  userOverview: UserRow[];
  positionConcentration: ConcentrationRow[];
  openPositions: OpenPositionRow[];
  revenueBreakdown: RevenueRow[];
  cohortFunnel: CohortRow[];
  pnlSeries30d: DailyBucket[];
  curated: Curated;
  github: GithubActivity;
}

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-dashboard-data`;

export async function fetchAdminDashboard(
  getToken: () => Promise<string | null>
): Promise<DashboardResponse> {
  const token = await getToken();
  if (!token) throw new Error('No auth token');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dashboard fetch failed: ${res.status} ${body}`);
  }
  return res.json();
}
