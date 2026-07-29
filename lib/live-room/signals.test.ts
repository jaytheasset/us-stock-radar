import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeLiveRoomPostDraft } from "./postPolicy.ts";
import {
  LIVE_ROOM_POST_DIRECTIONS,
  LIVE_ROOM_POST_DIRECTION_TAGS,
  LIVE_ROOM_POST_SIGNAL_GROUPS,
  LIVE_ROOM_POST_SIGNAL_VALUES,
  encodeLiveRoomPostMetadataTags,
  getLiveRoomPostSignalLabel,
  readLiveRoomPostDirection,
} from "./postSignals.ts";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("post signal taxonomy is canonical, grouped, and user-facing", () => {
  assert.deepEqual(
    LIVE_ROOM_POST_SIGNAL_VALUES,
    [
      "earnings_beat",
      "earnings_miss",
      "guidance_raised",
      "guidance_cut",
      "short_squeeze",
      "dilution",
      "secondary_offering",
      "mergers_and_acquisitions",
      "buyback",
      "insider_activity",
      "stock_split",
      "reverse_split",
      "regulatory_fda",
      "contract_partnership",
      "positive_catalyst",
      "risk_alert",
      "technical_breakout",
      "technical_breakdown",
    ],
  );
  assert.deepEqual(
    LIVE_ROOM_POST_SIGNAL_GROUPS.map((group) => group.label),
    [
      "Earnings & guidance",
      "Capital & ownership",
      "Catalysts & risks",
      "Technical",
    ],
  );
  assert.equal(
    getLiveRoomPostSignalLabel("mergers_and_acquisitions"),
    "M&A",
  );
  assert.equal(
    getLiveRoomPostSignalLabel("regulatory_fda"),
    "Regulatory / FDA",
  );
  assert.equal(getLiveRoomPostSignalLabel("stock_split"), "Stock split");
  assert.equal(
    getLiveRoomPostSignalLabel("reverse_split"),
    "Reverse split",
  );
});

test("post draft normalization keeps signals optional and direction optional and exclusive", () => {
  const baseDraft = {
    body: "A durable thesis with enough detail for a Live Room post.",
    eventId: null,
    relatedTickers: ["NVDA"],
    title: "AI infrastructure demand",
  };

  assert.deepEqual(normalizeLiveRoomPostDraft(baseDraft).signalLabels, []);
  assert.equal(normalizeLiveRoomPostDraft(baseDraft).direction, null);
  assert.deepEqual(
    normalizeLiveRoomPostDraft({
      ...baseDraft,
      signalLabels: [
        "earnings_beat",
        "guidance_raised",
        "positive_catalyst",
      ],
    }).signalLabels,
    ["earnings_beat", "guidance_raised", "positive_catalyst"],
  );
  for (const direction of LIVE_ROOM_POST_DIRECTIONS) {
    assert.equal(
      normalizeLiveRoomPostDraft({
        ...baseDraft,
        direction: direction.value,
      }).direction,
      direction.value,
    );
  }
  assert.throws(
    () =>
      normalizeLiveRoomPostDraft({
        ...baseDraft,
        signalLabels: [
          "earnings_beat",
          "guidance_raised",
          "positive_catalyst",
          "technical_breakout",
        ],
      }),
    /up to 3 post signals/,
  );
  assert.throws(
    () =>
      normalizeLiveRoomPostDraft({
        ...baseDraft,
        signalLabels: ["earnings_beat", "custom_signal"],
      }),
    /available list/,
  );
  assert.throws(
    () =>
      normalizeLiveRoomPostDraft({
        ...baseDraft,
        signalLabels: ["risk_alert", "risk_alert"],
      }),
    /must be unique/,
  );
  assert.throws(
    () =>
      normalizeLiveRoomPostDraft({
        ...baseDraft,
        direction: "strongly_bullish",
      }),
    /available list/,
  );
});

test("direction round-trips through the existing metadata tag array without consuming a signal slot", () => {
  const signals = [
    "stock_split",
    "earnings_beat",
    "positive_catalyst",
  ] as const;
  const encoded = encodeLiveRoomPostMetadataTags(signals, "bullish");

  assert.deepEqual(encoded, [
    ...signals,
    LIVE_ROOM_POST_DIRECTION_TAGS.bullish,
  ]);
  assert.equal(readLiveRoomPostDirection(encoded), "bullish");
  assert.equal(readLiveRoomPostDirection(signals), null);
});

test("signal migration is bounded, indexed, backward compatible, and service-only", () => {
  const migration = readSource(
    "supabase/migrations/20260729044356_live_room_post_like_activity.sql",
  );

  assert.match(
    migration,
    /create type public\.live_room_post_signal as enum \([\s\S]*'earnings_beat'[\s\S]*'technical_breakdown'[\s\S]*\);/i,
  );
  assert.match(
    migration,
    /add column signal_labels public\.live_room_post_signal\[\][\s\S]*not null[\s\S]*default array\[\]::public\.live_room_post_signal\[\]/i,
  );
  assert.match(
    migration,
    /live_room_posts_signal_labels_check[\s\S]*live_room_post_signals_valid\(signal_labels\)/i,
  );
  assert.match(
    migration,
    /cardinality\(p_values\) <= 3[\s\S]*count\(distinct signal\)/i,
  );
  assert.match(
    migration,
    /live_room_posts_signal_labels_gin_idx[\s\S]*using gin \(signal_labels\)[\s\S]*visibility_status = 'visible'/i,
  );
  assert.match(
    migration,
    /alter function public\.create_live_room_post\([\s\S]*rename to create_live_room_post_without_signals[\s\S]*create function public\.create_live_room_post\([\s\S]*p_signal_labels public\.live_room_post_signal\[\]/i,
  );
  assert.match(
    migration,
    /alter function public\.update_live_room_post\([\s\S]*rename to update_live_room_post_without_signals[\s\S]*create function public\.update_live_room_post\([\s\S]*p_signal_labels public\.live_room_post_signal\[\]/i,
  );
  assert.match(
    migration,
    /revoke usage on type public\.live_room_post_signal[\s\S]*from public, anon, authenticated[\s\S]*grant usage on type public\.live_room_post_signal[\s\S]*to service_role/i,
  );
  for (const functionName of [
    "live_room_post_signals_valid",
    "create_live_room_post",
    "update_live_room_post",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated;[\\s\\S]*?grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role;`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(
    migration,
    /grant\s+(?:select|insert|update|delete|all)[^;]*live_room_posts[^;]*to\s+(?:anon|authenticated)/i,
  );
  assert.doesNotMatch(migration, /security definer/i);
});

test("split and direction metadata migration extends the enum and preserves independent limits", () => {
  const migration = readSource(
    "supabase/migrations/20260729153617_live_room_post_split_direction.sql",
  );

  for (const value of [
    "stock_split",
    "reverse_split",
    ...Object.values(LIVE_ROOM_POST_DIRECTION_TAGS),
  ]) {
    assert.match(
      migration,
      new RegExp(`add value if not exists '${value}'`, "i"),
    );
  }
  assert.match(migration, /cardinality\(p_values\) <= 4/i);
  assert.match(
    migration,
    /where signal::text not in \([\s\S]*'direction_bullish'[\s\S]*\)\s*<= 3/i,
  );
  assert.match(
    migration,
    /where signal::text in \([\s\S]*'direction_neutral'[\s\S]*\)\s*<= 1/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.live_room_post_signals_valid\([\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.live_room_post_signals_valid\([\s\S]*to service_role/i,
  );
  assert.doesNotMatch(migration, /security definer/i);
});

test("signals flow through server selection, mutation, mapping, and browser drafts", () => {
  const repository = readSource("lib/live-room/postServerRepository.ts");
  const timelineRepository = readSource(
    "lib/live-room/serverRepository.ts",
  );
  const browserRepository = readSource("lib/live-room/apiRepository.ts");
  const detailRoute = readSource(
    "app/api/live-room/posts/[postId]/route.ts",
  );

  assert.match(repository, /select:[\s\S]*signal_labels/);
  assert.equal(
    repository.match(
      /p_signal_labels:\s*encodeLiveRoomPostMetadataTags\([\s\S]*?normalized\.direction,[\s\S]*?\)/g,
    )?.length,
    2,
  );
  assert.match(
    repository,
    /signalLabels:\s*Array\.isArray\(row\.signal_labels\)[\s\S]*filter\(isLiveRoomPostSignal\)/,
  );
  assert.match(
    repository,
    /direction:\s*Array\.isArray\(row\.signal_labels\)[\s\S]*readLiveRoomPostDirection\(row\.signal_labels\)/,
  );
  assert.match(timelineRepository, /signal_labels/);
  assert.match(
    browserRepository,
    /update\(postId: string, input: LiveRoomPostDraft\)[\s\S]*JSON\.stringify\(input\)/,
  );
  assert.match(
    detailRoute,
    /request\.json\(\)[\s\S]*updateLiveRoomPost\(/,
  );
});

test("signal UI explains grouped selection and uses the requested display limits", () => {
  const signalUi = readSource("components/live-room/PostSignals.tsx");
  const signalIcons = readSource(
    "components/live-room/postSignalIcons.ts",
  );
  const signalStyles = readSource(
    "components/live-room/PostSignals.module.css",
  );
  const postsPanel = readSource("components/live-room/PostsPanel.tsx");
  const postsStyles = readSource(
    "components/live-room/Posts.module.css",
  );
  const detail = readSource(
    "components/live-room/PostDetailClient.tsx",
  );
  const detailStyles = readSource(
    "components/live-room/PostDetail.module.css",
  );
  const timeline = readSource("components/live-room/ChatTimeline.tsx");

  assert.match(signalUi, /LIVE_ROOM_POST_SIGNAL_GROUPS\.map/);
  assert.match(signalUi, /Optional, choose up to 3/);
  assert.match(signalUi, /Selected \{value\.length\}\/3/);
  assert.match(signalUi, /disabled=\{!checked && atLimit\}/);
  assert.match(
    signalUi,
    /LIVE_ROOM_POST_DIRECTIONS\.map[\s\S]*aria-pressed=\{selected\}[\s\S]*onChange\(selected \? null : option\.value\)/,
  );
  for (const direction of LIVE_ROOM_POST_DIRECTIONS) {
    assert.match(
      signalStyles,
      new RegExp(
        `\\[data-direction="${direction.value}"\\][\\s\\S]*var\\(--sr-color-`,
      ),
    );
  }
  assert.match(
    signalUi,
    /LIVE_ROOM_POST_SIGNAL_ICONS\[signal\][\s\S]*<SignalIcon aria-hidden="true"/,
  );
  assert.match(
    signalUi,
    /LIVE_ROOM_POST_SIGNAL_ICONS\[option\.value\][\s\S]*<SignalIcon aria-hidden="true"/,
  );
  assert.doesNotMatch(signalUi, /import \{ Tag,/);
  for (const signal of LIVE_ROOM_POST_SIGNAL_VALUES) {
    assert.match(
      signalIcons,
      new RegExp(`\\b${signal}:\\s*[A-Z]`),
    );
  }
  assert.match(
    signalIcons,
    /satisfies Record<LiveRoomPostSignal, LucideIcon>/,
  );
  assert.doesNotMatch(signalStyles, /#[0-9a-f]{3,8}|rgba?\(/i);
  assert.match(postsPanel, /<PostSignalSelector[\s\S]*value=\{signalLabels\}/);
  assert.match(
    postsPanel,
    /<PostDirectionSelector[\s\S]*onChange=\{setDirection\}[\s\S]*value=\{direction\}/,
  );
  assert.match(
    postsPanel,
    /direction:\s*post\.direction[\s\S]*signalLabels:\s*post\.signalLabels/,
  );
  assert.match(
    postsPanel,
    /<PostSignalChips[\s\S]*maxVisible=\{2\}[\s\S]*signals=\{post\.signalLabels\}/,
  );
  assert.match(
    detail,
    /<PostSignalSelector[\s\S]*value=\{draft\.signalLabels\}/,
  );
  assert.match(
    detail,
    /<PostDirectionSelector[\s\S]*value=\{draft\.direction\}/,
  );
  assert.match(
    detail,
    /<PostDirectionBadge direction=\{post\.direction\}/,
  );
  assert.match(detail, /<PostSignalChips signals=\{post\.signalLabels\}/);
  assert.match(
    timeline,
    /<PostDirectionBadge direction=\{item\.direction\}[\s\S]*<PostSignalChips[\s\S]*maxVisible=\{1\}[\s\S]*showOverflow=\{false\}[\s\S]*signals=\{item\.signalLabels\}/,
  );
  assert.match(postsStyles, /\.form > label > input/);
  assert.match(detailStyles, /\.editForm > label > input/);
  assert.doesNotMatch(postsStyles, /\.form input,/);
  assert.doesNotMatch(detailStyles, /\.editForm input,/);
  assert.match(
    signalStyles,
    /\.options label\s*\{[\s\S]*position:\s*relative;/,
  );
  assert.match(
    signalStyles,
    /\.options input\s*\{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*opacity:\s*0;/,
  );
  assert.doesNotMatch(
    signalStyles,
    /\.options input\s*\{[\s\S]*clip(?:-path)?:/,
  );
});

test("chat post preview is capped and left-aligned on desktop, then fills mobile width", () => {
  const styles = readSource("components/live-room/LiveRoom.module.css");
  const desktopRule = styles.match(/\.postPreview\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(desktopRule);
  assert.match(desktopRule, /width:\s*min\(100%,\s*680px\)/);
  assert.match(desktopRule, /max-width:\s*100%/);
  assert.match(desktopRule, /justify-self:\s*start/);
  assert.match(
    desktopRule,
    /background-color:\s*var\(--sr-color-event-neutral-surface\)/,
  );
  assert.match(
    desktopRule,
    /border:[^;]*var\(--sr-color-event-neutral\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*?\.postPreview\s*\{[\s\S]*?width:\s*100%/,
  );
});
