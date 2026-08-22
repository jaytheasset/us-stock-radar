/**
 * Official stock-split calculation reader.
 *
 * The implementation is common with the locked reverse-split reader. Legacy
 * reverse-split imports remain valid from reverseSplitExecution.ts.
 */
export {
  FORWARD_SPLIT_EXECUTION_VERSION,
  readStockSplitExecutions,
  stockSplitExecutionActivationDecision,
  stockSplitExecutionId,
  type ForwardSplitExecution,
  type ForwardSplitExecutionReadResult,
  type StockSplitExecution,
  type StockSplitExecutionReadResult,
} from "./reverseSplitExecution.ts";
