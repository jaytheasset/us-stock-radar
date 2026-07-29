"use client";

import { Check, LogIn, LogOut, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./LiveRoom.module.css";

export function RoomMembershipControl({
  busy,
  isGuest,
  joined,
  loginHref,
  onJoin,
  onLeave,
  roomLabel,
}: {
  busy: boolean;
  isGuest: boolean;
  joined: boolean | null;
  loginHref: string;
  onJoin: () => Promise<void>;
  onLeave: () => Promise<void>;
  roomLabel: string;
}) {
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const confirmLeaveButtonRef = useRef<HTMLButtonElement>(null);
  const leaveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmingLeave) return;
    confirmLeaveButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      setConfirmingLeave(false);
      window.requestAnimationFrame(() => leaveButtonRef.current?.focus());
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, confirmingLeave]);

  const join = () => {
    if (isGuest) {
      window.location.assign(loginHref);
      return;
    }
    void onJoin();
  };

  const leave = async () => {
    try {
      await onLeave();
      setConfirmingLeave(false);
    } catch {
      // The room surface owns the visible error message.
    }
  };

  if (joined === null && !isGuest) {
    return (
      <button
        aria-label="Loading room membership"
        className={styles.membershipButton}
        disabled
        type="button"
      >
        <Users aria-hidden="true" size={15} />
        Loading
      </button>
    );
  }

  return (
    <>
      {joined ? (
        <div className={styles.membershipJoinedGroup}>
          <span className={styles.membershipJoinedStatus}>
            <Check aria-hidden="true" size={14} />
            Joined
          </span>
          <button
            className={styles.membershipLeaveButton}
            disabled={busy}
            onClick={() => setConfirmingLeave(true)}
            ref={leaveButtonRef}
            type="button"
          >
            <LogOut aria-hidden="true" size={14} />
            Leave room
          </button>
        </div>
      ) : (
        <button
          className={styles.membershipButton}
          disabled={busy}
          onClick={join}
          type="button"
        >
          {isGuest ? (
            <LogIn aria-hidden="true" size={15} />
          ) : (
            <Users aria-hidden="true" size={15} />
          )}
          Join room
        </button>
      )}
      {confirmingLeave ? (
        <div className={styles.membershipDialogBackdrop}>
          <section
            aria-labelledby="leave-room-confirmation-title"
            aria-modal="true"
            className={styles.membershipDialog}
            role="dialog"
          >
            <strong id="leave-room-confirmation-title">
              Leave {roomLabel}?
            </strong>
            <p>
              This removes the room from My Rooms and stops its unread
              activity. You can still read the room and join again later.
            </p>
            <div>
              <button
                disabled={busy}
                onClick={() => {
                  setConfirmingLeave(false);
                  window.requestAnimationFrame(() =>
                    leaveButtonRef.current?.focus(),
                  );
                }}
                type="button"
              >
                Keep joined
              </button>
              <button
                className={styles.membershipConfirmLeave}
                disabled={busy}
                onClick={() => void leave()}
                ref={confirmLeaveButtonRef}
                type="button"
              >
                {busy ? "Leaving…" : "Leave room"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
