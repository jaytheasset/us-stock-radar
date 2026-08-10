import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveRoomVisualFixtureClient } from "./LiveRoomVisualFixtureClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Room local visual fixture",
  robots: { follow: false, index: false },
};

export default function LiveRoomVisualFixturePage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return <LiveRoomVisualFixtureClient />;
}
