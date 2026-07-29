import { LIVE_ROOM_POST_TICKER_LIMIT } from "./postPolicy.ts";

export const LIVE_ROOM_POST_TICKER_SUGGESTION_LIMIT = 6;

const LIVE_ROOM_POST_TICKER_TOKEN_PATTERN =
  /^[A-Z0-9][A-Z0-9.-]{0,14}$/;

export type LiveRoomPostTickerInputContext = {
  atLimit: boolean;
  query: string;
  selectedTickers: string[];
  tokenStart: number;
};

export function parseLiveRoomPostMentionedTickers(value: string) {
  const tickers = value
    .split(/[\s,]+/)
    .map((ticker) => ticker.trim().replace(/^\$/, "").toUpperCase())
    .filter(Boolean);

  return [...new Set(tickers)];
}

export function getLiveRoomPostTickerInputContext(
  value: string,
): LiveRoomPostTickerInputContext {
  const currentToken = value.match(/(?:^|[\s,])(\$?[^\s,]*)$/)?.[1] ?? "";
  const tokenStart = value.length - currentToken.length;
  const selectedTickers = parseLiveRoomPostMentionedTickers(
    value.slice(0, tokenStart),
  );

  return {
    atLimit: selectedTickers.length >= LIVE_ROOM_POST_TICKER_LIMIT,
    query: currentToken.replace(/^\$/, "").trim().toUpperCase(),
    selectedTickers,
    tokenStart,
  };
}

export function replaceLiveRoomPostTickerInputToken(
  value: string,
  ticker: string,
) {
  const normalizedTicker = normalizeTickerToken(ticker);
  if (!normalizedTicker) return value;
  const { tokenStart } = getLiveRoomPostTickerInputContext(value);
  return `${value.slice(0, tokenStart)}$${normalizedTicker}, `;
}

export function selectLiveRoomPostTickerSuggestions<
  TResult extends { ticker: string },
>(
  results: readonly TResult[],
  context: LiveRoomPostTickerInputContext,
  currentTicker?: string,
) {
  if (!context.query || context.atLimit) return [];

  const excluded = new Set(context.selectedTickers);
  const normalizedCurrentTicker = normalizeTickerToken(currentTicker ?? "");
  if (normalizedCurrentTicker) excluded.add(normalizedCurrentTicker);

  const seen = new Set<string>();
  return results
    .filter((result) => {
      const ticker = normalizeTickerToken(result.ticker);
      if (!ticker || excluded.has(ticker) || seen.has(ticker)) return false;
      seen.add(ticker);
      return true;
    })
    .slice(0, LIVE_ROOM_POST_TICKER_SUGGESTION_LIMIT);
}

function normalizeTickerToken(value: string) {
  const ticker = value.trim().replace(/^\$/, "").toUpperCase();
  return LIVE_ROOM_POST_TICKER_TOKEN_PATTERN.test(ticker) ? ticker : null;
}
