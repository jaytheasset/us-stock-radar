"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  COMMUNITY_ROOM_FOCUS_TAGS,
  COMMUNITY_ROOM_LANGUAGES,
  COMMUNITY_ROOM_STYLES,
  COMMUNITY_ROOM_TOPICS,
  getCommunityFocusTagLabel,
  getCommunityLanguageLabel,
  getCommunityRoomStyleLabel,
  getCommunityTopicLabel,
  type CommunityRoom,
  type CommunityRoomFocusTag,
} from "@/lib/live-room/community";
import {
  requestJson,
  toLiveRoomApiError,
} from "@/lib/live-room/apiRepository";
import styles from "./CommunityRooms.module.css";

type FormState = {
  focusTags: CommunityRoomFocusTag[];
  language: string;
  name: string;
  relatedTickers: string;
  roomStyle: string;
  summary: string;
  topic: string;
};

const initialForm: FormState = {
  focusTags: [],
  language: "",
  name: "",
  relatedTickers: "",
  roomStyle: "",
  summary: "",
  topic: "",
};

export function CommunityRoomCreateDialog() {
  const router = useRouter();
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  busyRef.current = busy;

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
      dialog?.querySelector<HTMLElement>("input")?.focus();
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
            relatedTickers: form.relatedTickers
              .split(/[,\s]+/)
              .map((value) => value.trim())
              .filter(Boolean),
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
        onClick={() => setOpen(true)}
        ref={openerRef}
        type="button"
      >
        <Plus aria-hidden="true" size={16} />
        Create room
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
                  Create a Community Room
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
            <p className={styles.dialogIntro}>
              Choose structured details so people can find the room. A
              signed-in member account is required.
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
              <label>
                <span>Related tickers <small>Optional</small></span>
                <input
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
                  Up to 5 tickers. These do not turn this into a Company
                  Live Room.
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
                  disabled={busy || form.focusTags.length < 1}
                  type="submit"
                >
                  {busy ? "Creating…" : "Create Community Room"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
