import type { TickerSearchFlowReadoutState } from "@/lib/tickerSearchFlowObservation";
import styles from "./TickerSearchFlowReadout.module.css";

export function TickerSearchFlowReadout({
  state,
}: {
  state: TickerSearchFlowReadoutState;
}) {
  return (
    <output
      aria-label="Ticker search to stock detail state"
      aria-live="off"
      className={styles.readout}
      data-ticker-flow-active-ticker={state.activeTicker ?? "none"}
      data-ticker-flow-api-ok={stringifyBoolean(state.apiOk)}
      data-ticker-flow-detail-render-state={state.detailRenderState}
      data-ticker-flow-company-identity-state={state.companyIdentityState}
      data-ticker-flow-http-status={state.httpStatus ?? "unknown"}
      data-ticker-flow-query={state.query}
      data-ticker-flow-rendered-count={state.renderedResultCount ?? "unknown"}
      data-ticker-flow-rendered-ticker={state.renderedTicker ?? "none"}
      data-ticker-flow-request-href={state.requestHref}
      data-ticker-flow-request-state={state.requestState}
      data-ticker-flow-response-status={state.responseStatus}
      data-ticker-flow-route-href={state.routeHref}
      data-ticker-flow-route-matches-selection={stringifyBoolean(
        state.routeMatchesSelection,
      )}
      data-ticker-flow-route-ticker={state.routeTicker ?? "none"}
      data-ticker-flow-search-state={state.searchStatus}
      data-ticker-flow-selected-ticker={state.selectedTicker ?? "none"}
      data-ticker-flow-selection-href={state.selectionHref}
      data-ticker-flow-source-count={state.sourceResultCount ?? "unknown"}
      data-ticker-flow-stage={state.stage}
    >
      {state.summary}
    </output>
  );
}

function stringifyBoolean(value: boolean | null) {
  return value === null ? "unknown" : String(value);
}
