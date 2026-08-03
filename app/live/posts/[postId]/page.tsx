import type { Metadata } from "next";
import { PostDetailClient } from "@/components/live-room/PostDetailClient";

export const metadata: Metadata = {
  description: "Read a member post from a Stock Radar Live Room.",
  title: "Live Room Post",
};

export default async function LiveRoomPostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  return <PostDetailClient postId={postId} />;
}
