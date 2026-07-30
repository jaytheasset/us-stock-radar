"use client";

export async function logoutAndReloadCurrentPage() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("LOGOUT_FAILED");
  }
  window.location.reload();
}
