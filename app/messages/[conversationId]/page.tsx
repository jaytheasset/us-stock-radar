import type { Metadata } from "next";
import { DirectMessageClient } from "@/components/direct-messages/DirectMessageClient";

export const metadata: Metadata = {
  description: "Private member conversation in Stock Radar.",
  robots: { follow: false, index: false },
  title: "Member Messages | Stock Radar",
};

type DirectMessagePageProps = {
  params: Promise<{ conversationId: string }>;
};

export default async function DirectMessagePage({
  params,
}: DirectMessagePageProps) {
  const { conversationId } = await params;
  return <DirectMessageClient conversationId={conversationId} />;
}
