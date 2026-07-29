"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMMUNITY_ROOM_FOCUS_TAGS,
  COMMUNITY_ROOM_INDUSTRY_OPTIONS,
  COMMUNITY_ROOM_LANGUAGES,
  COMMUNITY_ROOM_STYLES,
  COMMUNITY_ROOM_TOPICS,
  COMMUNITY_ROOM_THEME_OPTIONS,
  getCommunityFocusTagLabel,
  getCommunityLanguageLabel,
  getCommunityRoomIndustryLabel,
  getCommunityRoomStyleLabel,
  getCommunityRoomThemeLabel,
  getCommunityTopicLabel,
  type CommunityRoom,
  type CommunityRoomFocusTag,
  type CommunityRoomIndustry,
  type CommunityRoomTheme,
} from "@/lib/live-room/community";
import {
  COMMUNITY_ROOM_CREATE_LOGIN_HREF,
  type CommunityRoomCreateEligibility,
} from "@/lib/live-room/communityCreateEligibility";
import {
  requestJson,
  toLiveRoomApiError,
} from "@/lib/live-room/apiRepository";
import styles from "./CommunityRooms.module.css";

type FormState = {
  focusTags: CommunityRoomFocusTag[];
  industries: CommunityRoomIndustry[];
  language: string;
  name: string;
  relatedTickers: string;
  roomStyle: string;
  summary: string;
  themes: CommunityRoomTheme[];
  topic: string;
};

const initialForm: FormState = {
  focusTags: [],
  industries: [],
  language: "",
  name: "",
  relatedTickers: "",
  roomStyle: "",
  summary: "",
  themes: [],
  topic: "",
};

export function CommunityRoomCreateDialog({
  openOnLoad = false,
}: {
  openOnLoad?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const eligibilityBusyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [busy, setBusy] = useState(false);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [eligibility, setEligibility] =
    useState<CommunityRoomCreateEligibility | null>(null);
  const [eligibilityError, setEligibilityError] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  busyRef.current = busy;

  const beginCreateFlow = useCallback(async () => {
    if (eligibilityBusyRef.current) return;
    eligibilityBusyRef.current = true;
    setCheckingEligibility(true);
    setEligibilityError(null);
    try {
      const result = await requestJson<CommunityRoomCreateEligibility>(
        "/api/live-room/community/create-eligibility",
      );
      if (result.reason === "COMMUNITY_ROOM_MEMBER_REQUIRED") {
        window.location.assign(
          result.nextActionHref || COMMUNITY_ROOM_CREATE_LOGIN_HREF,
        );
        return;
      }
      setEligibility(result);
      setOpen(true);
    } catch (requestError) {
      setEligibility(null);
      setEligibilityError(toLiveRoomApiError(requestError).message);
      setOpen(true);
    } finally {
      eligibilityBusyRef.current = false;
      setCheckingEligibility(false);
    }
  }, []);

  const openOnLoadHandled = useRef(false);
  useEffect(() => {
    if (!openOnLoad || openOnLoadHandled.current) return;
    openOnLoadHandled.current = true;
    void beginCreateFlow();
  }, [beginCreateFlow, openOnLoad]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusableSelector =
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]";
    const getFocusable = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(focusableSelector),
          )
        : [];
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => {
      const initialFocus =
        dialog?.querySelector<HTMLElement>("input") ??
        dialog?.querySelector<HTMLElement>("a[href], button");
      initialFocus?.focus();
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => openerRef.current?.focus());
    };
  }, [open]);

  const toggleFocusTag = (tag: CommunityRoomFocusTag) => {
    setError(null);
    setForm((current) => {
      const selected = current.focusTags.includes(tag);
      if (selected) {
        return {
          ...current,
          focusTags: current.focusTags.filter((value) => value !== tag),
        };
      }
      if (current.focusTags.length >= 3) return current;
      return { ...current, focusTags: [...current.focusTags, tag] };
    });
  };

  const toggleTheme = (theme: CommunityRoomTheme) => {
    setError(null);
    setForm((current) => {
      const selected = current.themes.includes(theme);
      if (selected) {
        return {
          ...current,
          themes: current.themes.filter((value) => value !== theme),
        };
      }
      if (current.themes.length >= 3) return current;
      return { ...current, themes: [...current.themes, theme] };
    });
  };

  const toggleIndustry = (industry: CommunityRoomIndustry) => {
    setError(null);
    setForm((current) => {
      const selected = current.industries.includes(industry);
      if (selected) {
        return {
          ...current,
          industries: current.industries.filter(
            (value) => value !== industry,
          ),
        };
      }
      if (current.industries.length >= 3) return current;
      return {
        ...current,
        industries: [...current.industries, industry],
      };
    });
  };

  const relatedTickers = parseTickerInput(form.relatedTickers);
  const hasDiscoveryAnchor =
    relatedTickers.length > 0 ||
    form.themes.length > 0 ||
    form.industries.length > 0;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const room = await requestJson<CommunityRoom>(
        "/api/live-room/community",
        {
          method: "POST",
          body: JSON.stringify({
            ...form,
            relatedTickers,
          }),
        },
      );
      router.push(`/live/community/${encodeURIComponent(room.slug)}`);
    } catch (requestError) {
      setError(toLiveRoomApiError(requestError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className={styles.createButton}
        disabled={checkingEligibility}
        onClick={() => void beginCreateFlow()}
        ref={openerRef}
        type="button"
      >
        <Plus aria-hidden="true" size={16} />
        {checkingEligibility ? "Checking eligibility…" : "Create a room"}
      </button>
      {open ? (
        <div className={styles.dialogBackdrop} role="presentation">
          <section
            aria-labelledby="community-room-create-title"
            aria-modal="true"
            className={styles.createDialog}
            ref={dialogRef}
            role="dialog"
          >
            <header>
              <div>
                <span>Member-created discussion</span>
                <h2 id="community-room-create-title">
                  {eligibility?.canCreate
                    ? "Create a Community Room"
                    : "Before you create a room"}
                </h2>
              </div>
              <button
                aria-label="Close create room dialog"
                className={styles.closeButton}
                disabled={busy}
                onClick={() => setOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            {eligibility?.canCreate ? (
              <>
                <p className={styles.dialogIntro}>
                  Choose structured details so people can find the room.
                  Your account meets the current creation limits.
                </p>
                <form className={styles.createForm} onSubmit={submit}>
              <label>
                <span>Room name</span>
                <input
                  maxLength={60}
                  minLength={4}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Macro moves this week"
                  required
                  value={form.name}
                />
                <small>4–60 characters · plain text · no links</small>
              </label>
              <label>
                <span>One-line introduction</span>
                <textarea
                  maxLength={160}
                  minLength={12}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      summary: event.target.value,
                    }))
                  }
                  placeholder="Discuss the data and catalysts moving major indexes."
                  required
                  rows={2}
                  value={form.summary}
                />
                <small>12–160 characters · one line · no links</small>
              </label>
              <div className={styles.formGrid}>
                <label>
                  <span>Topic</span>
                  <select
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        topic: event.target.value,
                      }))
                    }
                    required
                    value={form.topic}
                  >
                    <option value="">Choose one</option>
                    {COMMUNITY_ROOM_TOPICS.map((topic) => (
                      <option key={topic.value} value={topic.value}>
                        {getCommunityTopicLabel(topic.value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Room style</span>
                  <select
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        roomStyle: event.target.value,
                      }))
                    }
                    required
                    value={form.roomStyle}
                  >
                    <option value="">Choose one</option>
                    {COMMUNITY_ROOM_STYLES.map((roomStyle) => (
                      <option key={roomStyle.value} value={roomStyle.value}>
                        {getCommunityRoomStyleLabel(roomStyle.value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Language</span>
                  <select
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        language: event.target.value,
                      }))
                    }
                    required
                    value={form.language}
                  >
                    <option value="">Choose one</option>
                    {COMMUNITY_ROOM_LANGUAGES.map((language) => (
                      <option key={language.value} value={language.value}>
                        {getCommunityLanguageLabel(language.value)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <fieldset className={styles.focusPicker}>
                <legend>
                  Focus tags{" "}
                  <small>{form.focusTags.length}/3 selected</small>
                </legend>
                <p>Choose 1–3. Free-form tags are not supported.</p>
                <div>
                  {COMMUNITY_ROOM_FOCUS_TAGS.map((tag) => (
                    <button
                      aria-pressed={form.focusTags.includes(tag.value)}
                      key={tag.value}
                      onClick={() => toggleFocusTag(tag.value)}
                      type="button"
                    >
                      {getCommunityFocusTagLabel(tag.value)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div
                className={styles.discoveryAnchorNotice}
                id="community-room-discovery-anchor-help"
              >
                <strong>
                  Choose at least one ticker, theme, or industry.
                </strong>
                <span>
                  Related tickers are optional when a market theme or
                  industry is selected.
                </span>
              </div>
              <fieldset
                aria-describedby="community-room-discovery-anchor-help"
                className={styles.taxonomyPicker}
              >
                <legend>
                  Market themes{" "}
                  <small>{form.themes.length}/3 selected</small>
                </legend>
                <p>
                  Choose a broad MAIN theme or a more specific theme.
                </p>
                <div className={styles.taxonomyOptions}>
                  {COMMUNITY_ROOM_THEME_OPTIONS.filter(
                    (option) => option.kind === "main",
                  ).map((mainTheme) => (
                    <section key={mainTheme.value}>
                      <div className={styles.taxonomyGroupHeading}>
                        <strong>{mainTheme.groupLabel}</strong>
                        <span>MAIN theme</span>
                      </div>
                      <div>
                        {COMMUNITY_ROOM_THEME_OPTIONS.filter(
                          (option) =>
                            option.groupSlug === mainTheme.groupSlug,
                        ).map((theme) => {
                          const selected = form.themes.includes(
                            theme.value,
                          );
                          return (
                            <button
                              aria-pressed={selected}
                              disabled={
                                !selected && form.themes.length >= 3
                              }
                              key={theme.value}
                              onClick={() => toggleTheme(theme.value)}
                              type="button"
                            >
                              {theme.kind === "main" ? (
                                <span>MAIN</span>
                              ) : null}
                              {getCommunityRoomThemeLabel(theme.value)}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </fieldset>
              <fieldset
                aria-describedby="community-room-discovery-anchor-help"
                className={styles.taxonomyPicker}
              >
                <legend>
                  Industries{" "}
                  <small>{form.industries.length}/3 selected</small>
                </legend>
                <p>
                  Industry labels use the canonical market taxonomy.
                </p>
                <div className={styles.taxonomyOptions}>
                  {[
                    ...new Set(
                      COMMUNITY_ROOM_INDUSTRY_OPTIONS.map(
                        (option) => option.groupLabel,
                      ),
                    ),
                  ].map((sector) => (
                    <section key={sector}>
                      <div className={styles.taxonomyGroupHeading}>
                        <strong>{sector}</strong>
                      </div>
                      <div>
                        {COMMUNITY_ROOM_INDUSTRY_OPTIONS.filter(
                          (option) => option.groupLabel === sector,
                        ).map((industry) => {
                          const selected = form.industries.includes(
                            industry.value,
                          );
                          return (
                            <button
                              aria-pressed={selected}
                              disabled={
                                !selected &&
                                form.industries.length >= 3
                              }
                              key={industry.value}
                              onClick={() =>
                                toggleIndustry(industry.value)
                              }
                              type="button"
                            >
                              {getCommunityRoomIndustryLabel(
                                industry.value,
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </fieldset>
              <label>
                <span>Related tickers <small>Optional</small></span>
                <input
                  aria-describedby="community-room-discovery-anchor-help"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      relatedTickers: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="AAPL, MSFT"
                  value={form.relatedTickers}
                />
                <small>
                  Up to 5 tickers ({relatedTickers.length}/5 entered).
                  These do not turn this into a Company Live Room.
                </small>
              </label>
              {error ? (
                <p aria-live="polite" className={styles.formError}>
                  {error}
                </p>
              ) : null}
              <footer>
                <button
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className={styles.submitButton}
                  disabled={
                    busy ||
                    form.focusTags.length < 1 ||
                    !hasDiscoveryAnchor
                  }
                  type="submit"
                >
                  {busy ? "Creating…" : "Create Community Room"}
                </button>
              </footer>
                </form>
              </>
            ) : (
              <div
                className={styles.eligibilityPanel}
                role={eligibilityError ? "alert" : "status"}
              >
                <AlertCircle aria-hidden="true" size={20} />
                <div>
                  <strong>
                    {eligibilityError
                      ? "Eligibility could not be checked"
                      : eligibility?.reason ===
                          "COMMUNITY_ROOM_CREATE_DAILY_LIMIT"
                        ? "24-hour creation limit reached"
                        : "Creation cooldown is active"}
                  </strong>
                  <p>
                    {eligibilityError ||
                      eligibility?.message ||
                      "Room creation is temporarily unavailable."}
                  </p>
                  {eligibility?.retryAt ? (
                    <small>
                      Try again after{" "}
                      {new Date(eligibility.retryAt).toLocaleString(
                        "en-US",
                      )}
                      .
                    </small>
                  ) : null}
                  <div className={styles.eligibilityActions}>
                    {eligibility?.nextActionHref &&
                    eligibility.nextActionLabel ? (
                      <Link href={eligibility.nextActionHref}>
                        {eligibility.nextActionLabel}
                      </Link>
                    ) : (
                      <button
                        disabled={checkingEligibility}
                        onClick={() => void beginCreateFlow()}
                        type="button"
                      >
                        {checkingEligibility
                          ? "Checking…"
                          : "Check again"}
                      </button>
                    )}
                    <button onClick={() => setOpen(false)} type="button">
                      Back to directory
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

function parseTickerInput(value: string) {
  return [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((ticker) => ticker.trim())
        .filter(Boolean),
    ),
  ];
}
