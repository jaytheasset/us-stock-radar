"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  requestJson,
  toLiveRoomApiError,
} from "@/lib/live-room/apiRepository";
import type { LiveRoomMembershipList } from "@/lib/live-room/types";
import { JoinedRoomsList } from "./JoinedRoomsList";
import styles from "./CommunityRooms.module.css";

const JOINED_ROOMS_LOGIN_HREF =
  "/login?next=%2Flive%3Fview%3Djoined";

export function JoinedRoomsDirectory() {
  const [data, setData] = useState<LiveRoomMembershipList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void requestJson<LiveRoomMembershipList>(
      "/api/live-room/memberships?limit=100",
    )
      .then((result) => {
        if (active) setData(result);
      })
      .catch((requestError) => {
        if (!active) return;
        const apiError = toLiveRoomApiError(requestError);
        if (
          apiError.status === 401 ||
          apiError.code === "LIVE_ROOM_MEMBER_REQUIRED"
        ) {
          window.location.assign(JOINED_ROOMS_LOGIN_HREF);
          return;
        }
        setError(apiError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className={styles.joinedRoomsDirectory}>
      <header>
        <div>
          <span>Room membership</span>
          <h2>Joined rooms</h2>
          <p>
            Company and Community Rooms stay here until you choose Leave
            room from inside that room.
          </p>
        </div>
        <Link href="/live">Browse all rooms</Link>
      </header>
      <JoinedRoomsList
        currentHref=""
        data={data}
        error={error}
        loading={loading}
      />
      {data?.hasMore ? (
        <p className={styles.joinedRoomsLimit}>
          Showing the 100 most recently active joined rooms.
        </p>
      ) : null}
    </section>
  );
}
