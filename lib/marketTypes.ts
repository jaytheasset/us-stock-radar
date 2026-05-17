export type PriceRange = "1D" | "5D" | "1M" | "3M" | "1Y";

export type PricePoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
};
