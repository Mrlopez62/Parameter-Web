/*
 * The site's cookieless tracker: one small beacon per event to /api/track.
 * Sends the page path, the referring page (reduced to its hostname on the
 * server), and the ?company= / utm_source values from Parameter's own links.
 * Joshua's own browser opts out from the /stats page.
 */
import type { EventType } from "../lib/analytics";

export const IGNORE_KEY = "parameter:ignore-analytics";

function ignored(): boolean {
  try {
    return localStorage.getItem(IGNORE_KEY) === "1";
  } catch {
    return false;
  }
}

export function track(type: EventType, extra: { company?: string } = {}): void {
  if (import.meta.env.DEV || ignored()) return; // No functions under astro dev.

  const params = new URLSearchParams(location.search);
  const body = JSON.stringify({
    type,
    path: location.pathname,
    referrer: document.referrer,
    company: extra.company || params.get("company") || undefined,
    utm: params.get("utm_source") || undefined,
  });

  try {
    const sent = navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }));
    if (!sent) void fetch("/api/track", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // Analytics must never break the page.
  }
}
