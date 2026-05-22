import type { Plan } from "@/lib/subscriptionPolicy";
import type { PlanSource, TrialState } from "@/lib/subscription/effectivePlan";

export type WatchlistTickerItem = {
  id: string;
  ticker: string;
  companyName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type WatchlistViewModel = {
  guestMode?: boolean;
  plan: Plan;
  planLabel: string;
  basePlan?: Plan;
  effectivePlan?: Plan;
  planSource?: PlanSource;
  trial?: TrialState;
  limit: number | null;
  usage: number;
  items: WatchlistTickerItem[];
};
