"use client";

import { ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { DirectMessageApiRepository } from "@/lib/direct-messages/apiRepository";
import type {
  DirectMessageReceiveMode,
  DirectMessageRequestFilter,
  DirectMessageSettings,
} from "@/lib/direct-messages/types";
import styles from "./DirectMessageSettings.module.css";

const receiveOptions: Array<{
  description: string;
  label: string;
  value: DirectMessageReceiveMode;
}> = [
  {
    value: "mutual_only",
    label: "Mutual follows only",
    description: "Do not receive requests from non-mutual members.",
  },
  {
    value: "people_i_follow",
    label: "People I follow",
    description: "Allow requests when you already follow the sender.",
  },
  {
    value: "followers",
    label: "Followers",
    description: "Allow requests from members who already follow you.",
  },
  {
    value: "everyone",
    label: "Everyone",
    description: "Allow any eligible registered member to request once.",
  },
  {
    value: "nobody",
    label: "Nobody",
    description: "Turn off new requests. Accepted conversations remain.",
  },
];

const filterOptions: Array<{
  description: string;
  label: string;
  value: DirectMessageRequestFilter;
}> = [
  {
    value: "any",
    label: "Any eligible member",
    description: "Apply only your relationship setting above.",
  },
  {
    value: "moderators",
    label: "Moderators and admins",
    description: "Only trusted active Live Room moderation roles.",
  },
  {
    value: "verified",
    label: "Verified social accounts",
    description: "Only members with an approved creator verification.",
  },
  {
    value: "pro_members",
    label: "Pro members",
    description: "Pro, Advanced, or Ultimate membership.",
  },
];

export function DirectMessageSettingsClient() {
  const [repository] = useState(() => new DirectMessageApiRepository());
  const [settings, setSettings] = useState<DirectMessageSettings | null>(
    null,
  );
  const [state, setState] = useState<"error" | "loading" | "ready">(
    "loading",
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void repository
      .readSettings()
      .then((next) => {
        if (controller.signal.aborted) return;
        setSettings(next);
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, [repository]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const next = await repository.writeSettings(settings);
      setSettings(next);
      setNotice("Message privacy settings saved.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Message privacy settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel}>
      <header>
        <span className={styles.eyebrow}>Member messages</span>
        <h1>Message privacy</h1>
        <p>
          Mutual follows can chat immediately. Other registered members may
          send one text request only when these settings allow it.
        </p>
      </header>

      {state === "loading" ? (
        <p aria-busy="true" className={styles.state}>
          Loading message privacy…
        </p>
      ) : state === "error" || !settings ? (
        <p className={styles.state} role="alert">
          Message privacy settings could not be loaded.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset>
            <legend>Who can send a request?</legend>
            <div className={styles.optionList}>
              {receiveOptions.map((option) => (
                <label key={option.value}>
                  <input
                    checked={settings.receiveMode === option.value}
                    name="receive-mode"
                    onChange={() =>
                      setSettings((current) =>
                        current
                          ? { ...current, receiveMode: option.value }
                          : current,
                      )
                    }
                    type="radio"
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {settings.canUseSelectiveFilters ? (
            <fieldset
              disabled={
                settings.receiveMode === "mutual_only" ||
                settings.receiveMode === "nobody"
              }
            >
              <legend>Optional request filter</legend>
              <p className={styles.fieldHelp}>
                This applies only to non-mutual requests that pass the
                relationship setting.
              </p>
              <div className={styles.optionList}>
                {filterOptions.map((option) => (
                  <label key={option.value}>
                    <input
                      checked={settings.requestFilter === option.value}
                      name="request-filter"
                      onChange={() =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                requestFilter: option.value,
                              }
                            : current,
                        )
                      }
                      type="radio"
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <aside className={styles.selectiveFilterNote}>
              Selective request filters are available only to members with
              an approved social verification or an active trusted
              moderator/admin role. Your relationship setting above still
              applies.
            </aside>
          )}

          <aside className={styles.safetyNote}>
            <ShieldCheck aria-hidden="true" size={18} />
            <span>
              These are spam controls. Pro membership, social verification,
              and moderator status do not grant paid investment consulting
              rights or verify investing performance.
            </span>
          </aside>

          {notice ? (
            <p aria-live="polite" className={styles.notice}>
              {notice}
            </p>
          ) : null}
          <button className={styles.saveButton} disabled={saving} type="submit">
            {saving ? "Saving…" : "Save settings"}
          </button>
        </form>
      )}
    </section>
  );
}
