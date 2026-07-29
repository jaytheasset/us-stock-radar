"use client";

import { Tags } from "lucide-react";
import {
  LIVE_ROOM_POST_SIGNAL_GROUPS,
  getLiveRoomPostSignalLabel,
  type LiveRoomPostSignal,
} from "@/lib/live-room/postSignals";
import { LIVE_ROOM_POST_SIGNAL_ICONS } from "./postSignalIcons";
import styles from "./PostSignals.module.css";

export function PostSignalChips({
  maxVisible,
  showOverflow = true,
  signals,
}: {
  maxVisible?: number;
  showOverflow?: boolean;
  signals: readonly LiveRoomPostSignal[];
}) {
  if (!signals.length) return null;

  const visibleSignals =
    maxVisible === undefined ? signals : signals.slice(0, maxVisible);
  const overflowCount = signals.length - visibleSignals.length;

  return (
    <div aria-label="Post signals" className={styles.chips}>
      {visibleSignals.map((signal) => {
        const SignalIcon = LIVE_ROOM_POST_SIGNAL_ICONS[signal];
        return (
          <span className={styles.chip} key={signal}>
            <SignalIcon aria-hidden="true" size={12} />
            {getLiveRoomPostSignalLabel(signal)}
          </span>
        );
      })}
      {showOverflow && overflowCount > 0 ? (
        <span
          aria-label={`${overflowCount} more post ${
            overflowCount === 1 ? "signal" : "signals"
          }`}
          className={styles.overflow}
        >
          +{overflowCount}
        </span>
      ) : null}
    </div>
  );
}

export function PostSignalSelector({
  idPrefix,
  onChange,
  value,
}: {
  idPrefix: string;
  onChange: (value: LiveRoomPostSignal[]) => void;
  value: readonly LiveRoomPostSignal[];
}) {
  const atLimit = value.length >= 3;

  return (
    <fieldset className={styles.selector}>
      <legend>
        <Tags aria-hidden="true" size={16} />
        Post signals <small>Optional, choose up to 3</small>
      </legend>
      <p>
        Choose the labels that best explain the market signal in this post.
      </p>
      <div aria-live="polite" className={styles.selectionCount}>
        Selected {value.length}/3
      </div>
      <div className={styles.groups}>
        {LIVE_ROOM_POST_SIGNAL_GROUPS.map((group) => (
          <fieldset className={styles.group} key={group.label}>
            <legend>{group.label}</legend>
            <p>{group.description}</p>
            <div className={styles.options}>
              {group.options.map((option) => {
                const checked = value.includes(option.value);
                const id = `${idPrefix}-${option.value}`;
                const SignalIcon =
                  LIVE_ROOM_POST_SIGNAL_ICONS[option.value];
                return (
                  <label data-selected={checked} htmlFor={id} key={option.value}>
                    <input
                      checked={checked}
                      disabled={!checked && atLimit}
                      id={id}
                      onChange={() => {
                        onChange(
                          checked
                            ? value.filter((signal) => signal !== option.value)
                            : [...value, option.value],
                        );
                      }}
                      type="checkbox"
                    />
                    <SignalIcon aria-hidden="true" size={12} />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </fieldset>
  );
}
