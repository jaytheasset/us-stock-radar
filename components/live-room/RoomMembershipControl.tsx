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
        title="Loading room membership"
        type="button"
      >
        <Users aria-hidden="true" size={15} />
        <span className={styles.membershipActionLabel}>Loading</span>
      </button>
    );
  }

  return (
    <>
      {joined ? (
        <div className={styles.membershipJoinedGroup}>
          <span
            aria-label="Joined"
            className={styles.membershipJoinedStatus}
            title="Joined"
          >
            <Check aria-hidden="true" size={14} />
            <span className={styles.membershipActionLabel}>Joined</span>
          </span>
          <button
            aria-label="Leave room"
            className={styles.membershipLeaveButton}
            disabled={busy}
            onClick={() => setConfirmingLeave(true)}
            ref={leaveButtonRef}
            title="Leave room"
            type="button"
          >
            <LogOut aria-hidden="true" size={14} />
            <span className={styles.membershipActionLabel}>
              Leave room
            </span>
          </button>
        </div>
      ) : (
        <button
          aria-label="Join room"
          className={styles.membershipButton}
          disabled={busy}
          onClick={join}
          title="Join room"
          type="button"
        >
          {isGuest ? (
            <LogIn aria-hidden="true" size={15} />
          ) : (
            <Users aria-hidden="true" size={15} />
          )}
          <span className={styles.membershipActionLabel}>Join room</span>
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
