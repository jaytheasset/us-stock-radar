import type { Plan } from "../subscriptionPolicy";
import type {
  StockDilutionActivity,
  StockDilutionInstrument,
  StockDilutionSnapshot,
} from "./stockDilution";

export const DILUTION_PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Vary: "Cookie",
} as const;

export type StockDilutionAccess = {
  canViewActivity: boolean;
  canViewCurrentDetails: boolean;
  canViewHistory: boolean;
};

export type StockDilutionCurrentPreview = Pick<
  StockDilutionInstrument,
  "asOf" | "name" | "status" | "type"
>;

export type StockDilutionMembershipResponse = {
  access: StockDilutionAccess;
  activity: StockDilutionActivity[];
  closed: StockDilutionInstrument[];
  counts: {
    closed: number;
    current: number;
  };
  current: Array<StockDilutionCurrentPreview | StockDilutionInstrument>;
  lastChecked: string;
  metrics: StockDilutionSnapshot["metrics"];
  old: StockDilutionInstrument[];
  symbol: string;
};

type ComparePlanRank = (left: Plan, right: Plan) => number;

export function getStockDilutionAccess(
  plan: Plan,
  comparePlanRank: ComparePlanRank,
): StockDilutionAccess {
  return {
    canViewActivity: comparePlanRank(plan, "advanced") >= 0,
    canViewCurrentDetails: comparePlanRank(plan, "pro") >= 0,
    canViewHistory: comparePlanRank(plan, "advanced") >= 0,
  };
}

export function projectStockDilutionForPlan(
  snapshot: StockDilutionSnapshot,
  plan: Plan,
  comparePlanRank: ComparePlanRank,
): StockDilutionMembershipResponse {
  const access = getStockDilutionAccess(plan, comparePlanRank);

  return {
    access,
    activity: access.canViewActivity
      ? snapshot.activity.map((item) => ({ ...item }))
      : [],
    closed: access.canViewHistory
      ? snapshot.closed.map((instrument) => ({ ...instrument }))
      : [],
    counts: {
      closed: snapshot.closed.length,
      current: snapshot.current.length,
    },
    current: access.canViewCurrentDetails
      ? snapshot.current.map((instrument) => ({ ...instrument }))
      : snapshot.current.slice(0, 2).map(toCurrentPreview),
    lastChecked: snapshot.lastChecked,
    metrics: {
      atmAmount: snapshot.metrics.atmAmount,
      convertibleNotePotentialShares:
        snapshot.metrics.convertibleNotePotentialShares,
      equityLineRemaining: snapshot.metrics.equityLineRemaining,
      floatShares: snapshot.metrics.floatShares,
      freeFloat: snapshot.metrics.freeFloat,
      otherWarrantShares: snapshot.metrics.otherWarrantShares,
      sharesOutstanding: snapshot.metrics.sharesOutstanding,
      sharesOutstandingAsOf: snapshot.metrics.sharesOutstandingAsOf,
      totalWarrantShares: snapshot.metrics.totalWarrantShares,
    },
    old: access.canViewHistory
      ? snapshot.old.map((instrument) => ({ ...instrument }))
      : [],
    symbol: snapshot.symbol,
  };
}

function toCurrentPreview(
  instrument: StockDilutionInstrument,
): StockDilutionCurrentPreview {
  return {
    asOf: instrument.asOf,
    name: instrument.name,
    status: instrument.status,
    type: instrument.type,
  };
}
