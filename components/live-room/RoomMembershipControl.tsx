"use client";

import { Check, ChevronDown, LogIn, LogOut, Users } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./LiveRoom.module.css";

export function RoomMembershipControl({
  busy,
  isGuest,
  joined,
  joiningDisabled = false,
  loginHref,
  onJoin,
  onLeave,
  roomLabel,
}: {
  busy: boolean;
  isGuest: boolean;
  joined: boolean | null;
  joiningDisabled?: boolean;
  loginHref: string;
  onJoin: () => Promise<void>;
  onLeave: () => Promise<void>;
  roomLabel: string;
}) {
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const confirmLeaveButtonRef = useRef<HTMLButtonElement>(null);
  const joinedPopoverId = useId();
  const joinedMenuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!joinedMenuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!confirmingLeave) return;
    confirmLeaveButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      setConfirmingLeave(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
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
        <div className={styles.membershipJoinedGroup} ref={joinedMenuRef}>
          <button
            aria-controls={joinedPopoverId}
            aria-expanded={menuOpen}
            aria-label="Joined room options"
            className={styles.membershipJoinedStatus}
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
            ref={menuButtonRef}
            title="Joined"
            type="button"
          >
            <Check aria-hidden="true" size={14} />
            <span className={styles.membershipActionLabel}>Joined</span>
            <ChevronDown aria-hidden="true" size={13} />
          </button>
          {menuOpen ? (
            <div className={styles.membershipMenu} id={joinedPopoverId}>
              <button
                aria-label="Leave room"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmingLeave(true);
                }}
                type="button"
              >
                <LogOut aria-hidden="true" size={14} />
                Leave room
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <button
          aria-label="Join room"
          className={styles.membershipButton}
          disabled={busy || joiningDisabled}
          onClick={join}
          title={joiningDisabled ? "Room is read-only" : "Join room"}
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
                    menuButtonRef.current?.focus(),
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
