export const liveFeedRailMinimumScore = 75;

export const liveFeedRailQueries = {
  marketMoving: {
    deliveryLevel: "alert",
    limit: 4,
    marketScopes: ["sector", "theme", "macro"],
    minimumScore: liveFeedRailMinimumScore,
    order: "score.desc,detected_at.desc",
    page: 1,
    sourceGroup: "news",
  },
  highImpactNews: {
    deliveryLevel: "alert",
    limit: 4,
    marketScope: "company",
    minimumScore: liveFeedRailMinimumScore,
    order: "score.desc,detected_at.desc",
    page: 1,
    sourceGroup: "news",
  },
  alertFilings: {
    deliveryLevel: "alert",
    limit: 4,
    minimumScore: liveFeedRailMinimumScore,
    order: "score.desc,detected_at.desc",
    page: 1,
    sourceGroup: "filings",
  },
} as const;
