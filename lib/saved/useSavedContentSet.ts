"use client";

import { useEffect, useMemo, useState } from "react";
import type { SavedContentType } from "@/lib/saved/types";
import {
  getSavedContentOverride,
  subscribeToUserContentChanges,
} from "@/lib/userContentSync";

export function useSavedContentSet(
  contentType: SavedContentType,
  contentIds: readonly string[],
) {
  const normalizedIds = useMemo(
    () =>
      Array.from(new Set(contentIds.map((value) => value.toLowerCase()))).sort(),
    [contentIds],
  );
  const requestKey = normalizedIds.join(",");
  const [authenticated, setAuthenticated] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!requestKey) {
      setSavedIds(new Set());
      return;
    }

    let active = true;
    const search = new URLSearchParams({
      contentIds: requestKey,
      contentType,
    });
    void fetch(`/api/saved?${search.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          authenticated?: boolean;
          savedIds?: string[];
        };
        if (!active || !response.ok) return;
        setAuthenticated(payload.authenticated === true);
        const serverSavedIds = new Set(
          (payload.savedIds || []).map((contentId) => contentId.toLowerCase()),
        );
        setSavedIds(
          new Set(
            requestKey.split(",").filter((contentId) => {
              const override = getSavedContentOverride(contentType, contentId);
              return override ?? serverSavedIds.has(contentId);
            }),
          ),
        );
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [contentType, requestKey]);

  useEffect(
    () =>
      subscribeToUserContentChanges((change) => {
        if (change.kind !== "saved" || change.contentType !== contentType) {
          return;
        }
        setSavedIds((current) => {
          const next = new Set(current);
          if (change.value) next.add(change.contentId.toLowerCase());
          else next.delete(change.contentId.toLowerCase());
          return next;
        });
      }),
    [contentType],
  );

  return { authenticated, savedIds };
}
