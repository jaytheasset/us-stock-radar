"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useState,
  type FocusEvent,
  type PointerEvent,
} from "react";
import {
  formatMarketActivityChange,
  formatMarketActivityElapsed,
  formatMarketActivityValue,
  type MarketActivityPayload,
} from "@/lib/marketActivity";
import styles from "./MarketActivityRail.module.css";

type ActivityTab = "chat" | "indices";
type MarketActivityResponse = { data?: MarketActivityPayload; ok?: boolean };

const emptyPayload: MarketActivityPayload = { chats: [], indices: [] };
let marketActivityRequest: Promise<MarketActivityPayload> | null = null;

export function MarketActivityRail() {
  const pathname = usePathname();
  const hidden = shouldHideMarketActivityRail(pathname);
  const [activeTab, setActiveTab] = useState<ActivityTab>("indices");
  const [data, setData] = useState<MarketActivityPayload | null>(null);
  const [chatIndex, setChatIndex] = useState(0);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (hidden) return;
    let active = true;
    void loadMarketActivity().then((payload) => {
      if (active) setData(payload);
    });
    return () => {
      active = false;
    };
  }, [hidden]);

  const chats = data?.chats ?? [];
  useEffect(() => {
    if (
      activeTab !== "chat" ||
      chats.length < 2 ||
      interactionPaused ||
      reducedMotion
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setChatIndex((current) => (current + 1) % chats.length);
    }, 4_500);
    return () => window.clearInterval(timer);
  }, [activeTab, chats.length, interactionPaused, reducedMotion]);

  useEffect(() => {
    setChatIndex((current) => (chats.length ? current % chats.length : 0));
  }, [chats.length]);

  if (hidden) return null;

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setInteractionPaused(false);
    }
  };
  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") setInteractionPaused(false);
  };

  return (
    <aside aria-label="Market activity" className={styles.rail}>
      <div aria-label="Market activity view" className={styles.tabs} role="tablist">
        <button
          aria-controls="market-activity-indices"
          aria-selected={activeTab === "indices"}
          onClick={() => setActiveTab("indices")}
          role="tab"
          type="button"
        >
          지수
        </button>
        <button
          aria-controls="market-activity-chat"
          aria-selected={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
          role="tab"
          type="button"
        >
          채팅
        </button>
      </div>

      <div
        className={styles.content}
        onBlur={handleBlur}
        onFocus={() => setInteractionPaused(true)}
        onMouseEnter={() => setInteractionPaused(true)}
        onMouseLeave={() => setInteractionPaused(false)}
        onPointerCancel={handlePointerEnd}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") setInteractionPaused(true);
        }}
        onPointerUp={handlePointerEnd}
      >
        {activeTab === "indices" ? (
          <IndexRail
            data={data}
            interactionPaused={interactionPaused}
            reducedMotion={reducedMotion}
          />
        ) : (
          <ChatRail data={data} item={chats[chatIndex] ?? null} />
        )}
      </div>
    </aside>
  );
}

function IndexRail({
  data,
  interactionPaused,
  reducedMotion,
}: {
  data: MarketActivityPayload | null;
  interactionPaused: boolean;
  reducedMotion: boolean;
}) {
  const items = data?.indices ?? [];
  if (!data) return <RailStatus id="market-activity-indices" text="시장 활동을 불러오는 중입니다." />;
  if (!items.length) return <RailStatus id="market-activity-indices" text="시장 지수 정보를 사용할 수 없습니다." />;

  const trackClassName = [
    styles.indexTrack,
    interactionPaused || reducedMotion ? styles.paused : "",
    items.length < 2 ? styles.staticTrack : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      aria-label="Market indices. Focus, hover, or touch to pause."
      className={styles.indexViewport}
      id="market-activity-indices"
      role="tabpanel"
      tabIndex={0}
    >
      <div className={trackClassName}>
        <IndexSet items={items} />
        <IndexSet duplicate items={items} />
      </div>
    </div>
  );
}

function IndexSet({
  duplicate = false,
  items,
}: {
  duplicate?: boolean;
  items: MarketActivityPayload["indices"];
}) {
  return (
    <div aria-hidden={duplicate || undefined} className={`${styles.indexSet}${duplicate ? ` ${styles.duplicate}` : ""}`}>
      {items.map((item) => (
        <span className={styles.indexItem} key={`${duplicate ? "copy" : "main"}-${item.symbol}`}>
          <strong>{item.label}</strong>
          <span>{formatMarketActivityValue(item.value)}</span>
          <b data-tone={item.changePercent > 0 ? "positive" : item.changePercent < 0 ? "negative" : "neutral"}>
            {formatMarketActivityChange(item.changePercent)}
          </b>
        </span>
      ))}
    </div>
  );
}

function ChatRail({
  data,
  item,
}: {
  data: MarketActivityPayload | null;
  item: MarketActivityPayload["chats"][number] | null;
}) {
  if (!data) return <RailStatus id="market-activity-chat" text="공개 대화를 불러오는 중입니다." />;
  if (!item) return <RailStatus id="market-activity-chat" text="오늘 활발한 공개 대화가 아직 없습니다." />;

  return (
    <div className={styles.chatPanel} id="market-activity-chat" role="tabpanel">
      <Link className={styles.chatLink} href={item.href}>
        <span className={styles.roomIdentity}>
          <strong>{item.roomLabel}</strong>
          {item.roomName ? <small>{item.roomName}</small> : null}
        </span>
        <span className={styles.chatMessage}>{item.message}</span>
        <time dateTime={item.createdAt}>{formatMarketActivityElapsed(item.createdAt)}</time>
      </Link>
    </div>
  );
}

function RailStatus({ id, text }: { id: string; text: string }) {
  return (
    <p className={styles.status} id={id} role="tabpanel">
      {text}
    </p>
  );
}

export function shouldHideMarketActivityRail(pathname: string | null) {
  if (!pathname) return false;
  // Conversation surfaces own their viewport and composer geometry. Keeping the
  // rail out of them prevents duplicate live content and fixed-input conflicts.
  return (
    pathname.startsWith("/live/") ||
    pathname.startsWith("/messages/") ||
    pathname === "/account/messages"
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function loadMarketActivity() {
  if (!marketActivityRequest) {
    marketActivityRequest = fetch("/api/market-activity", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const payload = (await response.json()) as MarketActivityResponse;
        return response.ok && payload.ok && payload.data
          ? payload.data
          : emptyPayload;
      })
      .catch(() => emptyPayload);
  }
  return marketActivityRequest;
}
