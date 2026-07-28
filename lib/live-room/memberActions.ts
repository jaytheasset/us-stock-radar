export function createLiveRoomMemberLoginHref(nextPath: string) {
  const safeNextPath =
    nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : "/";
  return `/login?next=${encodeURIComponent(safeNextPath)}`;
}
