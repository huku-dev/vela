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
  // Return on capital deployed: realizedPnl / cumulativeClosedNotional × 100.
  // Null when the user has never closed a trade — frontend renders "—".
  // Optional so pre-#180 backend responses still deserialize cleanly.
  realizedPnlPct?: number | null;
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
  description: string | null;
  priority: 'High' | 'Medium' | 'Low' | null;
  area: string | null;
  status: string;
  daysStale: number;
  targetDate: string | null;
  createdDate: string;
  notionUrl: string | null;
}

export interface Curated {
  highlights: HighlightItem[];
  carryoverNextUp: CarryoverItem[];
  carryoverNeedsAttention: CarryoverItem[];
  // Legacy field names from pre-Notion backend (remove once backend is updated)
  carryoverInProgress?: CarryoverItem[];
  carryoverNeedsStatus?: CarryoverItem[];
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

export interface LlmCostKpis {
  totalSpend: number;
  totalSpendDelta: number | null;
  requests: number;
  requestsDelta: number | null;
  tokenVolume: number;
  tokenVolumeDelta: number | null;
  cacheHitRate: number;
  cacheHitRateDelta: number;
  blendedPer1M: number;
  blendedPer1MDelta: number | null;
}

export interface LlmProviderRow {
  provider: string;
  cost: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCosts {
  kpis: LlmCostKpis;
  providers: LlmProviderRow[];
  errorMessage: string | null;
}

// One point on a per-user or per-asset cumulative-PnL sparkline. `date` is
// ISO ("2026-08-03"); `cumPnl` is running total in dollars.
export interface CumulativePnlPoint {
  date: string;
  cumPnl: number;
}

export interface TraderCumulativePnlRow {
  displayName: string;
  isSelf: boolean;
  tier: 'premium' | 'standard' | 'free';
  subscriptionStatus: string;
  balance: number;
  openPositions: number;
  totalTrades: number;
  totalPnl30d: number;
  peak30d: number;
  trough30d: number;
  lastCloseIso: string | null;
  series: CumulativePnlPoint[];
}

export interface AssetScoreboardRow {
  symbol: string;
  closes: number;
  wins: number;
  winPct: number;
  volume: number;
  netPnl: number;
  avgHoldHours: number;
  series: CumulativePnlPoint[];
}

// One bucket in the Hold-Time Scoreboard. Backend emits all 6 in fixed order
// even when empty. All averages are null when they cannot be meaningfully
// computed (empty bucket, single-side bucket). Do NOT coerce averages to 0
// for display, render an em-dash / '-' instead — coercing prints fake
// measurements ($0 avg size, 0.0h hold).
export interface HoldTimeScoreboardRow {
  bucketKey: 'lt1h' | 'h1_4' | 'h4_12' | 'h12_24' | 'd1_2' | 'd2plus';
  bucketLabel: string;
  closes: number;
  wins: number;
  losses: number;
  winPct: number;
  netPnl: number;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null;
  avgHoldHours: number | null;
  avgSizeUsd: number | null;
}

export interface SubscriptionRisk {
  displayName: string;
  tier: 'premium' | 'standard' | 'free';
  billingCycle: 'monthly' | 'annual' | null;
  monthlyRevenue: number;
  balance: number;
  openPositions: number;
  lastActivityIso: string | null;
  status: 'past_due' | 'cancelling' | 'cancelled';
  signup: string;
  notionalMove: number | null;
}

export interface SubscriptionRisks {
  pastDue: SubscriptionRisk[];
  cancelling: SubscriptionRisk[];
  cancelledLast30d: SubscriptionRisk[];
}

export interface MonthlyReturnRow {
  year: number;
  month: number; // 1-12
  closes: number;
  notional: number;
  grossPnl: number;
  fees: number; // always ≥ 0 (cost)
  funding: number; // signed: positive = received, negative = paid
  netPnl: number; // gross - fees + funding
}

export interface MonthlyReturnsYear {
  year: number;
  months: MonthlyReturnRow[]; // sparse; frontend fills the Jan-Dec grid
  ytdClosesTotal: number;
  ytdNotionalTotal: number;
  ytdGrossPnl: number;
  ytdFees: number;
  ytdFunding: number;
  ytdNetPnl: number;
}

export interface MonthlyReturns {
  years: MonthlyReturnsYear[];
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
  // Backend PR #180 added these. Optional so a pre-#180 response still renders
  // (ChartsSection disables the 7d/90d toggle buttons in that case).
  pnlSeries7d?: DailyBucket[];
  pnlSeries90d?: DailyBucket[];
  // New sections (backend PR #163 added these). Optional so an old backend
  // response missing them still renders the rest of the dashboard.
  traderCumulativePnl30d?: TraderCumulativePnlRow[];
  assetScoreboard30d?: AssetScoreboardRow[];
  // Backend PR #212 added this. Optional so a pre-#212 response still renders.
  holdTimeScoreboard30d?: HoldTimeScoreboardRow[];
  subscriptionRisks?: SubscriptionRisks;
  // Backend PR #165 added this. Optional so a pre-#165 response still renders.
  monthlyReturns?: MonthlyReturns;
  curated: Curated;
  github: GithubActivity;
  llmCosts?: LlmCosts;
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
