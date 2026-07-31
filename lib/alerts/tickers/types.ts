import type { Plan } from "@/lib/subscriptionPolicy";

export type { TickerSearchResult } from "@/lib/tickerSearchContract";

export type AlertTickerItem = {
  id: string;
  ticker: string;
  companyName: string;
  enabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AlertTickersViewModel = {
  guestMode?: boolean;
  plan: Plan;
  planLabel: string;
  limit: number | null;
  usage: number;
  enabledCount: number;
  items: AlertTickerItem[];
};
