import type { ManualKiwoomRow } from "./candidateLink.ts";

// Manually read from the retained image, not fetched/OCR'd in this task.
// These are source-row observations, NOT real SEC candidate or administrator records.
export const retainedNotice = {
  id: "4611",
  sourceHash: "78d820eb08e42b755cf9b8083aa7da13aaa142323848eb10fd0c6d4b78d255f2",
  imageSha256: "8a35b9b094754035c26e366024719c26bd8dc11758b9f470c269252f25c97df2",
  url: "https://bbn.kiwoom.com/bbs/VBbsNoticeBWGCZDetailView?seqid=4611",
};
type Sample = Pick<ManualKiwoomRow, "cells" | "values" | "market" | "event" | "additionalChanges" | "securityType" | "securityClass" | "locator">;
export const manualRows: Record<string, Sample> = {
  psky: {
    locator: "image 1 / 2026 header / 10월6일 / US / 심볼변경 / PSKY",
    cells: { country: "US", event: "심볼변경", symbol: "PSKY", securityName: "파라마운트 스카이댄스", details: "PSKY → SKYD", date: "10월6일" },
    values: { oldTicker: "PSKY", newTicker: "SKYD", effectiveDate: "2026-10-06" },
    market: "US", event: "symbol_change", additionalChanges: [], securityType: null, securityClass: null,
  },
  vaci: {
    locator: "image 1 / 2026 header / 10월2일 / US / 심볼변경 / VACI",
    cells: { country: "US", event: "심볼변경", symbol: "VACI", securityName: "바이킹 애퀴지션 I", details: "VACI → NSTR; 국제표준코드변경(ISIN)", date: "10월2일" },
    values: { oldTicker: "VACI", newTicker: "NSTR", effectiveDate: "2026-10-02" },
    market: "US", event: "symbol_change", additionalChanges: ["ISIN change"], securityType: null, securityClass: null,
  },
  vtak: {
    locator: "image 1 / 2026 header / 10월5일 / US / 액면병합 / VTAK",
    cells: { country: "US", event: "액면병합", symbol: "VTAK", securityName: "캐시터 프리시젼", details: "10 : 1 (10주 → 1주); 심볼변경: VTAK → VJET", date: "10월5일" },
    values: { oldTicker: "VTAK", newTicker: "VJET", effectiveDate: "2026-10-05" },
    market: "US", event: "other", additionalChanges: ["reverse split"], securityType: null, securityClass: null,
  },
  wald: {
    locator: "image 1 / 2026 header / 10월5일 / US / 심볼변경 / WALD (not adjacent WALDW)",
    cells: { country: "US", event: "심볼변경", symbol: "WALD", securityName: "월드캐스트 애퀴지션", details: "WALD → WALDF; 거래소변경: NYSE → OTC", date: "10월5일" },
    values: { oldTicker: "WALD", newTicker: "WALDF", effectiveDate: "2026-10-05" },
    market: "US", event: "symbol_change", additionalChanges: ["exchange change"], securityType: null, securityClass: null,
  },
  waldw: {
    locator: "image 1 / 2026 header / 10월5일 / US / 심볼변경 / WALDW warrant (adjacent to WALD)",
    cells: { country: "US", event: "심볼변경", symbol: "WALDW", securityName: "월드캐스트 애퀴지션 콜 워런트(2027-07-2", details: "WALDW → WALWF; 거래소변경: NYSE → OTC", date: "10월5일" },
    values: { oldTicker: "WALDW", newTicker: "WALWF", effectiveDate: "2026-10-05" },
    market: "US", event: "symbol_change", additionalChanges: ["exchange change"], securityType: "warrant", securityClass: null,
  },
  hongKong: {
    locator: "image 1 / 2026 header / 10월2일 / HK / 액면병합 / 08026",
    cells: { country: "HK", event: "액면병합", symbol: "08026", securityName: "랑화인터내셔널그룹", details: "10 : 1 (10주 → 1주); 08026 → 08583", date: "10월2일" },
    values: { oldTicker: "08026", newTicker: "08583", effectiveDate: "2026-10-02" },
    market: "non_US", event: "other", additionalChanges: ["reverse split"], securityType: null, securityClass: null,
  },
  aeth: {
    locator: "image 1 / 2026 header / 10월5일 / US / 상장폐지 / AETH",
    cells: { country: "US", event: "상장폐지", symbol: "AETH", securityName: "이더리움 비트와이즈 ETF", details: "상장폐지(청산)", date: "10월5일" },
    values: { oldTicker: "AETH", newTicker: null, effectiveDate: "2026-10-05" },
    market: "US", event: "other", additionalChanges: ["liquidation delisting"], securityType: "etf", securityClass: null,
  },
};
