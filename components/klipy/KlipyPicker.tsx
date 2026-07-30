"use client";

import Image from "next/image";
import { ImagePlay, LoaderCircle, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import type {
  KlipyMediaAttachment,
  KlipySearchPage,
} from "@/lib/klipy/types";
import styles from "./Klipy.module.css";

type PickerState = {
  error: string | null;
  loading: boolean;
  page: KlipySearchPage | null;
};

const pageCache = new Map<string, KlipySearchPage>();

export function KlipyPicker({
  disabled,
  isGuest,
  loginHref,
  onSelect,
}: {
  disabled: boolean;
  isGuest: boolean;
  loginHref: string;
  onSelect: (media: KlipyMediaAttachment) => void;
}) {
  const id = `klipy-picker-${useId().replace(/:/g, "")}`;
  const openerRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<PickerState>({
    error: null,
    loading: false,
    page: null,
  });
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      openerRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const load = useCallback(async (search: string, cursor?: string | null) => {
    const normalized = search.replace(/\s+/g, " ").trim();
    if (normalized && normalized.length < 2) {
      setState({ error: null, loading: false, page: null });
      return;
    }
    const cacheKey = `${normalized}\n${cursor || ""}`;
    const cached = pageCache.get(cacheKey);
    if (cached) {
      setState((current) => ({
        error: null,
        loading: false,
        page: cursor && current.page
          ? {
              ...cached,
              items: [...current.page.items, ...cached.items],
            }
          : cached,
      }));
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState((current) => ({ ...current, error: null, loading: true }));
    try {
      const params = new URLSearchParams({ limit: "15" });
      if (normalized) params.set("q", normalized);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/media/klipy/search?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        data?: KlipySearchPage;
        message?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.message || "KLIPY GIFs could not be loaded.");
      }
      pageCache.set(cacheKey, payload.data);
      setState((current) => ({
        error: null,
        loading: false,
        page: cursor && current.page
          ? {
              ...payload.data!,
              items: [...current.page.items, ...payload.data!.items],
            }
          : payload.data!,
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setState((current) => ({
        ...current,
        error:
          error instanceof Error
            ? error.message
            : "KLIPY GIFs could not be loaded.",
        loading: false,
      }));
    }
  }, []);

  useEffect(() => {
    if (!open || isGuest) return;
    const timer = window.setTimeout(() => {
      void load(query);
    }, query.trim() ? 425 : 0);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [isGuest, load, open, query]);

  useEffect(() => {
    if (!open || mobile) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        !panelRef.current?.contains(event.target as Node) &&
        !openerRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeAndRestoreFocus, mobile, open]);

  const content = (
    <div className={styles.pickerContent}>
      <label className={styles.searchField}>
        <Search aria-hidden="true" size={16} />
        <span className={styles.visuallyHidden}>Search KLIPY</span>
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search KLIPY"
          ref={inputRef}
          type="search"
          value={query}
        />
        {query ? (
          <button
            aria-label="Clear KLIPY search"
            onClick={() => setQuery("")}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
      </label>
      {query.trim().length === 1 ? (
        <p className={styles.pickerStatus}>Enter at least 2 characters.</p>
      ) : null}
      {state.loading && !state.page ? (
        <div aria-label="Loading KLIPY GIFs" className={styles.skeletonGrid}>
          {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
        </div>
      ) : null}
      {state.error ? (
        <div className={styles.pickerStatus} role="alert">
          <span>{state.error}</span>
          <button onClick={() => void load(query)} type="button">Retry</button>
        </div>
      ) : null}
      {state.page ? (
        <>
          <div aria-label="KLIPY GIF results" className={styles.resultGrid}>
            {state.page.items.map((media) => (
              <button
                aria-label={`Use ${media.alt}`}
                key={media.providerMediaId}
                onClick={() => {
                  onSelect(media);
                  closeAndRestoreFocus();
                }}
                type="button"
              >
                <Image
                  alt={media.alt}
                  height={media.height}
                  src={media.previewUrl}
                  unoptimized
                  width={media.width}
                />
              </button>
            ))}
          </div>
          {!state.page.items.length && !state.loading ? (
            <p className={styles.pickerStatus}>No KLIPY GIFs found.</p>
          ) : null}
          {state.page.nextCursor ? (
            <button
              className={styles.loadMore}
              disabled={state.loading}
              onClick={() => void load(query, state.page?.nextCursor)}
              type="button"
            >
              {state.loading ? (
                <LoaderCircle aria-hidden="true" size={15} />
              ) : null}
              More GIFs
            </button>
          ) : null}
        </>
      ) : null}
      <a
        className={styles.attribution}
        href="https://klipy.com/"
        rel="noopener noreferrer"
        target="_blank"
      >
        Powered by KLIPY
      </a>
    </div>
  );

  return (
    <div className={styles.pickerRoot}>
      <button
        aria-controls={id}
        aria-expanded={open}
        aria-label={isGuest ? "Sign in to add a GIF or meme" : "Add a GIF or meme"}
        className={styles.pickerTrigger}
        disabled={disabled}
        onClick={() => {
          if (isGuest) {
            window.location.assign(loginHref);
            return;
          }
          setOpen((current) => !current);
        }}
        ref={openerRef}
        type="button"
      >
        <ImagePlay aria-hidden="true" size={18} />
        <span>GIF</span>
      </button>
      {open && !mobile ? (
        <div
          aria-label="KLIPY GIF and meme picker"
          className={styles.desktopPicker}
          id={id}
          ref={panelRef}
          role="dialog"
        >
          {content}
        </div>
      ) : null}
      <BottomSheetShell
        aria-label="KLIPY GIF and meme picker"
        closeLabel="Close KLIPY picker"
        id={id}
        isOpen={open && mobile}
        layout="full-scroll"
        onDismiss={() => setOpen(false)}
        openerRef={openerRef}
        overlayLabel="Close KLIPY picker"
      >
        <h2 className={styles.mobileTitle}>GIF / Meme</h2>
        {content}
      </BottomSheetShell>
    </div>
  );
}
