"use client";

import { useEffect, useState } from "react";

const referenceRefreshIntervalMs = 60_000;

export function useLiveReferenceDate(initialReferenceDate: string) {
  const [referenceDate, setReferenceDate] = useState(initialReferenceDate);

  useEffect(() => {
    const refreshReferenceDate = () => setReferenceDate(new Date().toISOString());
    refreshReferenceDate();

    const intervalId = window.setInterval(
      refreshReferenceDate,
      referenceRefreshIntervalMs,
    );
    return () => window.clearInterval(intervalId);
  }, []);

  return referenceDate;
}
