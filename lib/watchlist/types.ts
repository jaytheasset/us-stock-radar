import type { Plan } from "@/lib/subscriptionPolicy";

export type WatchlistTickerItem = {
  id: string;
  ticker: string;
  companyName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type WatchlistViewModel = {
  plan: Plan;
  planLabel: string;
  limit: number | null;
  usage: number;
  items: WatchlistTickerItem[];
};
